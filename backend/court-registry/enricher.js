// backend/court-registry/enricher.js
const apiClient = require('./apiClient');

// Regex to identify legal entities (Croatian forms)
const COMPANY_REGEX = /\b(d\.?o\.?o\.?|j\.?d\.?o\.?o\.?|d\.?d\.?|k\.?d\.?|j\.?t\.?d\.?|zadruga|obrt)\b/i;

// Regex to clean up names for better search matching
const CLEANUP_REGEX = /[^a-zA-Z0-9šđčćžŠĐČĆŽ\s]/g;

/**
 * Normalizes company name for search.
 * Removes "d.o.o.", punctuation, and extra spaces.
 */
function normalizeName(name) {
    if (!name) return '';
    let normalized = name.toLowerCase();
    
    // Remove legal suffixes to search by the core name
    normalized = normalized.replace(COMPANY_REGEX, '');
    
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

    return {
        officialName: apiData.tvtka || apiData.naziv || apiData.ime,
        mbs: apiData.mbs,
        oib: apiData.oib,
        legalForm: apiData.pravni_oblik, // e.g., "Društvo s ograničenom odgovornošću"
        status: apiData.status, // 1 = Active, 5 = Deleted
        registeredSeat: apiData.sjediste ? `${apiData.sjediste.ulica}, ${apiData.sjediste.mjesto}` : null,
        directors: Array.isArray(apiData.zastupnici) 
            ? apiData.zastupnici.map(p => `${p.ime} ${p.prezime}`).join(', ') 
            : null,
        capital: apiData.temeljni_kapital,
        lastChange: apiData.datum_zadnje_promjene
    };
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
                const searchName = normalizeName(newP.name);
                console.log(`[Enricher] Searching for entity: "${searchName}" (Original: "${newP.name}")`);

                // 2. Search API
                const searchResult = await apiClient.searchCompany(searchName);

                // 3. Heuristic Matching
                const match = searchResult && Array.isArray(searchResult) && searchResult.length > 0
                    ? searchResult[0] // Simple heuristic: take top result
                    : null;

                if (match) {
                    // 4. Fetch Details
                    const details = await apiClient.getCompanyDetails(match.mbs);
                    
                    const finalData = details || match; // Fallback to search result if details fail
                    
                    newP.companyData = mapCompanyData(finalData);
                    newP.enrichmentStatus = 'enriched';
                    console.log(`[Enricher] matched "${newP.name}" to MBS ${finalData.mbs}`);
                } else {
                    newP.enrichmentStatus = 'not_found';
                    console.log(`[Enricher] No match found for "${newP.name}"`);
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

module.exports = { enrichParticipants };
