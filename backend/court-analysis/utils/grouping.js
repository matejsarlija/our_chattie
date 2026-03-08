/**
 * Groups scraped entries by their normalized case number.
 * Entries with missing/N/A case numbers are treated as separate, individual clusters
 * to avoid conflating unrelated cases that happen to lack metadata.
 *
 * @param {Array<object>} entries - Scraped entries.
 * @returns {Array<{caseNumber: string, entries: Array<object>, isAnonymous: boolean}>} - List of case clusters.
 */
function groupEntriesByCase(entries) {
    if (!entries || !Array.isArray(entries)) {
        return [];
    }

    // We use a Map to group by valid case numbers, but also maintain a sequential result array
    // to preserve the natural sort order (recency) of the first appearance of a case.
    const clustersMap = new Map();
    const result = [];

    for (const entry of entries) {
        // Assume entry.caseNumber is already normalized by courtSearchPuppeteer
        const caseKey = entry.caseNumber;
        
        // Treat missing or N/A case numbers as unique/anonymous clusters
        if (!caseKey || caseKey === 'N/A') {
            result.push({
                caseNumber: 'N/A', // or 'Nepoznat predmet'
                entries: [entry],
                isAnonymous: true
            });
            continue;
        }

        if (!clustersMap.has(caseKey)) {
            const newCluster = {
                caseNumber: caseKey,
                entries: [],
                isAnonymous: false
            };
            clustersMap.set(caseKey, newCluster);
            result.push(newCluster); // Add to result list in order of appearance
        }
        
        // Add entry to the existing cluster
        clustersMap.get(caseKey).entries.push(entry);
    }
    
    return result;
}

module.exports = { groupEntriesByCase };
