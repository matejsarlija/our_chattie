// backend/court-registry/enricher.js
const apiClient = require('./apiClient');

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
async function enrichParticipants(participants) {
    if (!process.env.COURT_REGISTRY_CLIENT_ID) {
        console.warn('[Enricher] Missing API credentials. Skipping enrichment.');
        return participants;
    }

    const enrichedList = [];

    for (const p of participants) {
        // Clone to avoid mutation side-effects
        const newP = { ...p };

        // 1. Check if it's a company
        if (isLegalEntity(newP.name)) {
            try {
                let match = null;
                const participantOib = newP.oib ? String(newP.oib).trim() : null;
                const searchName = normalizeName(newP.name);

                // Strategy 1: Search by OIB using dedicated endpoint (most reliable)
                if (participantOib) {
                    // ... (Strategy 1 remains the same)
                    console.log(`[Enricher] Searching by OIB (detalji_subjekta): ${participantOib} (Name: "${newP.name}")`);
                    const oibMatch = await apiClient.searchByOib(participantOib);

                    if (oibMatch) {
                        console.log(`[Enricher] ✓ Found exact OIB match via ID endpoint: MBS ${oibMatch.mbs}`);
                        match = oibMatch;
                    } else {
                        console.log(`[Enricher] OIB ${participantOib} not found via direct lookup.`);
                    }
                }

                // Strategy 2: Fallback to name search + OIB filter
                if (!match) {
                    console.log(`[Enricher] Fallback: Searching for "${searchName}" (OIB: ${participantOib || 'None'})...`);
                    const searchResult = await apiClient.searchCompany(searchName, { includeInactive: true });

                    if (participantOib && searchResult && Array.isArray(searchResult)) {
                        console.log(`[Enricher] Filtering ${searchResult.length} results by OIB ${participantOib}...`);
                        match = searchResult.find(r => String(r.oib) === participantOib);
                        if (match) console.log(`[Enricher] ✓ Found OIB match in name results: MBS ${match.mbs}`);
                        else console.log(`[Enricher] ⚠ No result matched OIB ${participantOib}.`);

                    } else if (!participantOib && searchResult && Array.isArray(searchResult) && searchResult.length > 0) {
                        // Strategy 3: Name-only search (Defensive Verification)
                        // Old code: match = searchResult[0];

                        // New Defensive Code:
                        console.log(`[Enricher] Validating ${searchResult.length} name candidates against "${newP.name}"...`);
                        
                        match = searchResult.find(r => {
                            // API result might have different name fields
                            const apiName = r.tvtka || r.naziv || r.ime || r.skracena_tvrtka;
                            const isMatch = verifyNameMatch(newP.name, apiName);
                            if (isMatch) {
                                console.log(`[Enricher] ✓ Accepted match: "${apiName}" (MBS: ${r.mbs})`);
                            } else {
                                // console.log(`[Enricher] ✗ Rejected candidate: "${apiName}"`);
                            }
                            return isMatch;
                        });

                        if (!match) {
                            console.log(`[Enricher] ⚠ All candidates rejected. Search term "${searchName}" yielded results, but none matched sufficiently.`);
                        }
                    }
                }
                
                // ... (rest of logic)

                if (match) {
                    // If we got the match from searchByOib, it's already full details.
                    // If we got it from searchCompany (list), we might need to fetch details.

                    let finalData = match;

                    // Strategy 2 (list search) returns 'subjekti' objects which lack detailed data like GFI.
                    // If GFI is missing, we fetch full details by MBS.
                    if (!finalData.gfi || (Array.isArray(finalData.gfi) && finalData.gfi.length === 0)) {
                        console.log(`[Enricher] GFI data missing in initial match. Fetching full details for MBS ${match.mbs}...`);
                        const details = await apiClient.getCompanyDetails(match.mbs);
                        if (details) finalData = details;
                    }

                    newP.companyData = mapCompanyData(finalData);
                    newP.enrichmentStatus = 'enriched';

                    // Log enrichment details
                    const cd = newP.companyData;
                    console.log(`[Enricher] Whole Company Data: ${JSON.stringify(cd)}`);
                    console.log(`[Enricher] ✓ Enriched "${newP.name}"`);
                    console.log(`[Enricher]   → MBS: ${cd.mbs || 'N/A'}, OIB: ${cd.oib || 'N/A'}`);
                    console.log(`[Enricher]   → Official Name: ${cd.officialName || 'N/A'}`);
                    console.log(`[Enricher]   → Status: ${cd.status === 1 ? 'Active' : cd.status === 5 ? 'Deleted' : cd.status || 'N/A'}`);
                    if (cd.lastFinancialReportYear) console.log(`[Enricher]   → Last GFI: ${cd.lastFinancialReportYear}`);
                    if (cd.founders) console.log(`[Enricher]   → Founders: ${cd.founders}`);
                    if (cd.registeredSeat) console.log(`[Enricher]   → Seat: ${cd.registeredSeat}`);
                } else {
                    newP.enrichmentStatus = 'not_found';
                    console.log(`[Enricher] ✗ No match found for "${newP.name}"`);
                }
            } catch (error) {
                console.error(`[Enricher] Error processing "${newP.name}": ${error.message}`);
                newP.enrichmentStatus = 'error';
            }
        } else {
            newP.enrichmentStatus = 'skipped_person';
        }

        enrichedList.push(newP);
    }

    return enrichedList;
}

module.exports = { enrichParticipants, verifyNameMatch };
