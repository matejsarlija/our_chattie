// backend/court-registry/enricher.js
const apiClient = require('./apiClient');
const logger = require('../services/logger');

// Regex to identify legal entities (Croatian forms)
// Includes both abbreviations and full formal names
const COMPANY_REGEX = /\b(d\.?o\.?o\.?|j\.?d\.?o\.?o\.?|d\.?d\.?|k\.?d\.?|j\.?t\.?d\.?|zadruga|obrt|društvo s ograničenom odgovornošću|jednostavno društvo s ograničenom odgovornošću|dioničko društvo|komanditno društvo|javno trgovačko društvo)\b/i;

// Regex for business status or suffixes that should be stripped for searching
const STATUS_REGEX = /\b(u stečaju|u likvidaciji)\b/i;

// Regex to clean up names for better search matching
const CLEANUP_REGEX = /[^a-zA-Z0-9šđčćžŠĐČĆŽ\s]/g;

/**
 * Normalizes company name for search.
 * Removes legal forms, status suffixes, punctuation, and extra spaces.
 */
function normalizeName(name) {
    if (!name) return '';
    let normalized = name.toLowerCase();

    // Remove legal forms and status suffixes to search by the core name
    normalized = normalized.replace(COMPANY_REGEX, '');
    normalized = normalized.replace(STATUS_REGEX, '');

    // Remove special chars and extra whitespace
    normalized = normalized.replace(CLEANUP_REGEX, ' ').replace(/\s+/g, ' ').trim();

    return normalized;
}

/**
 * Determines if a participant string represents a legal entity.
 */
function isLegalEntity(participantName) {
    if (!participantName) return false;
    return COMPANY_REGEX.test(participantName);
}

/**
 * Maps raw API data to our pipeline schema.
 */
function mapCompanyData(apiData) {
    if (!apiData) return null;

    // Calculate last GFI year from the 'gfi' array if available
    let lastGfiYear = null;
    if (Array.isArray(apiData.gfi) && apiData.gfi.length > 0) {
        // Filter for valid numeric years and find the max
        // API v3 uses 'godina_izvjestaja'
        const years = apiData.gfi
            .map(r => parseInt(r.godina_izvjestaja || r.godina, 10))
            .filter(y => !isNaN(y));
        if (years.length > 0) {
            lastGfiYear = Math.max(...years);
        }
    }

    // Resolve company name from various possible fields
    const nameObj = apiData.tvtka || apiData.tvrtka || apiData.naziv || apiData.ime || apiData.skracena_tvrtka;
    let finalName = null;

    if (typeof nameObj === 'string') {
        finalName = nameObj;
    } else if (nameObj && typeof nameObj === 'object') {
        // Handle object wrapper (e.g. { ime: "..." }) seen in API responses
        finalName = nameObj.ime || nameObj.naziv || nameObj.tvtka || nameObj.val || nameObj.text || nameObj.content;
    }

    return {
        officialName: finalName ? String(finalName).trim() : null,
        mbs: apiData.mbs,
        oib: apiData.oib,
        legalForm: (apiData.pravni_oblik && apiData.pravni_oblik.vrsta_pravnog_oblika && apiData.pravni_oblik.vrsta_pravnog_oblika.naziv) || apiData.pravni_oblik_tekst || (apiData.pravni_oblik && apiData.pravni_oblik.naziv) || apiData.pravni_oblik,
        status: apiData.status, // 1 = Active, 5 = Deleted
        registeredSeat: apiData.sjediste ? `${apiData.sjediste.ulica}, ${apiData.sjediste.naziv_naselja || apiData.sjediste.mjesto?.naziv || apiData.sjediste.mjesto || ''}` : null,
        directors: Array.isArray(apiData.zastupnici)
            ? apiData.zastupnici.map(p => `${p.ime} ${p.prezime}`).join(', ')
            : null,
        founders: Array.isArray(apiData.osnivaci)
            ? apiData.osnivaci.map(p => `${p.ime} ${p.prezime}`).join(', ')
            : null,
        lastFinancialReportYear: lastGfiYear,
        capital: Array.isArray(apiData.temeljni_kapitali) && apiData.temeljni_kapitali.length > 0
            ? apiData.temeljni_kapitali.map(k => `${k.iznos} ${k.valuta?.naziv || ''}`).join(', ')
            : (apiData.temeljni_kapitals || apiData.temeljni_kapital),
        lastChange: apiData.datum_zadnje_promjene
    };
}

/**
 * Heuristically checks if two names are likely the same company.
 * 1. Exact match (case-insensitive)
 * 2. Scraped name is contained in API name (or vice-versa)
 * @returns {boolean} true if acceptable match
 */
function verifyNameMatch(scrapedName, apiName) {
    if (!scrapedName || !apiName) return false;
    
    // Normalize both names for comparison
    const normScraped = normalizeName(scrapedName);
    const normApi = normalizeName(apiName);
    
    // 1. Direct equality
    if (normScraped === normApi) return true;
    
    // 2. Containment (defensive)
    // We only allow this if the name is sufficiently long to avoid false positives (like "A" matching "Apple")
    if (normScraped.length > 3 && normApi.includes(normScraped)) return true;
    if (normApi.length > 3 && normScraped.includes(normApi)) return true;
    
    return false;
}

/**
 * Main function to enrich a list of participants.
 * @param {Array} participants - Array of objects { name: "...", role: "..." }
 * @returns {Promise<Array>} - Enriched participants
 */
const REGISTRY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_CONCURRENCY = 3;

function cacheKeyFor(participant) {
    const digits = String(participant.oib || '').replace(/\D+/g, '');
    if (/^\d{11}$/.test(digits)) return `oib:${digits}`;
    const name = normalizeName(participant.name);
    return name ? `name:${name}` : null;
}

async function enrichOne(participant, store) {
    const newP = { ...participant };
    if (!isLegalEntity(newP.name)) return { ...newP, enrichmentStatus: 'skipped_person' };

    const key = cacheKeyFor(newP);
    if (key && store?.getRegistryCache) {
        try {
            const cached = store.getRegistryCache(key);
            if (cached && typeof cached === 'object') return { ...newP, ...cached };
        } catch (error) {
            logger.warn('court-registry.enricher', `Registry cache read failed: ${error.message}`);
        }
    }

    try {
        let match = null;
        const participantOib = newP.oib ? String(newP.oib).trim() : null;
        const searchName = normalizeName(newP.name);
        if (participantOib) {
            logger.agent.log(`[Enricher] Searching by OIB (detalji_subjekta): ${participantOib} (Name: "${newP.name}")`);
            match = await apiClient.searchByOib(participantOib);
            if (match) logger.agent.log(`[Enricher] ✓ Found exact OIB match via ID endpoint: MBS ${match.mbs}`);
        }

        if (!match) {
            logger.agent.log(`[Enricher] Fallback: Searching for "${searchName}" (OIB: ${participantOib || 'None'})...`);
            const searchResult = await apiClient.searchCompany(searchName, { includeInactive: true });
            if (participantOib && Array.isArray(searchResult)) {
                match = searchResult.find((result) => String(result.oib) === participantOib);
            } else if (!participantOib && Array.isArray(searchResult)) {
                match = searchResult.find((result) => {
                    const apiName = result.tvtka || result.naziv || result.ime || result.skracena_tvrtka;
                    return verifyNameMatch(newP.name, apiName);
                });
            }
        }

        if (match) {
            let finalData = match;
            if (!finalData.gfi || (Array.isArray(finalData.gfi) && finalData.gfi.length === 0)) {
                const details = await apiClient.getCompanyDetails(match.mbs);
                if (details) finalData = details;
            }
            newP.companyData = mapCompanyData(finalData);
            newP.enrichmentStatus = 'enriched';
            const cd = newP.companyData;
            logger.agent.log(`[Enricher] Whole Company Data: ${JSON.stringify(cd)}`);
            logger.agent.log(`[Enricher] ✓ Enriched "${newP.name}"`);
            logger.agent.log(`[Enricher]   → MBS: ${cd.mbs || 'N/A'}, OIB: ${cd.oib || 'N/A'}`);
            logger.agent.log(`[Enricher]   → Official Name: ${cd.officialName || 'N/A'}`);
            logger.agent.log(`[Enricher]   → Status: ${cd.status === 1 ? 'Active' : cd.status === 5 ? 'Deleted' : cd.status || 'N/A'}`);
            if (cd.lastFinancialReportYear) logger.agent.log(`[Enricher]   → Last GFI: ${cd.lastFinancialReportYear}`);
            if (cd.founders) logger.agent.log(`[Enricher]   → Founders: ${cd.founders}`);
            if (cd.registeredSeat) logger.agent.log(`[Enricher]   → Seat: ${cd.registeredSeat}`);
        } else {
            newP.enrichmentStatus = 'not_found';
            logger.agent.log(`[Enricher] ✗ No match found for "${newP.name}"`);
        }

        if (key && store?.putRegistryCache) {
            try {
                store.putRegistryCache(key, {
                    companyData: newP.companyData || null,
                    enrichmentStatus: newP.enrichmentStatus,
                }, REGISTRY_CACHE_TTL_MS);
            } catch (error) {
                logger.warn('court-registry.enricher', `Registry cache write failed: ${error.message}`);
            }
        }
    } catch (error) {
        logger.agent.error(`[Enricher] Error processing "${newP.name}": ${error.message}`);
        newP.enrichmentStatus = 'error';
    }
    return newP;
}

async function enrichParticipants(participants, options = {}) {
    if (!process.env.COURT_REGISTRY_CLIENT_ID) {
        logger.warn('court-registry.enricher', 'Missing API credentials. Skipping enrichment.');
        return participants;
    }

    const source = Array.isArray(participants) ? participants : [];
    const enriched = new Array(source.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < source.length) {
            const index = nextIndex++;
            enriched[index] = await enrichOne(source[index], options.store);
        }
    }
    await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, source.length) }, () => worker()));
    return enriched;
}

module.exports = { enrichParticipants, verifyNameMatch, REGISTRY_CACHE_TTL_MS, LOOKUP_CONCURRENCY };
