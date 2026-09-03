// court-analysis/utils/scanDepth.js
//
// Single source of truth for scan depth in *court entries*. One court entry is
// one e-Oglasna announcement row (equivalently, one CSV row or one Puppeteer
// search-result item). A single court case or cluster can span many court
// entries, so "court entry" must not be called a "case", "case entry", or
// "cluster" anywhere in code, comments, or variable names.
//
// Including tail entries under the public limit is what makes
// `SCAN_DEPTH_MAX_ENTRIES` a true total: balanced mode returns at most 30
// newest court entries plus at most 10 oldest court entries, for 40 total.

const COURT_ENTRIES_PER_PAGE = 10;
const SCAN_DEPTH_STANDARD_ENTRIES = 30;
const SCAN_DEPTH_TAIL_ENTRIES = 10;
const SCAN_DEPTH_MAX_ENTRIES = 400;

function balancedScanDepth() {
    return {
        scanDepth: 'balanced',
        forwardEntries: SCAN_DEPTH_STANDARD_ENTRIES,
        tailEntries: SCAN_DEPTH_TAIL_ENTRIES,
        maxEntries: SCAN_DEPTH_STANDARD_ENTRIES + SCAN_DEPTH_TAIL_ENTRIES
    };
}

/**
 * Resolves the scan-depth dial into court-entry counts.
 *
 * @param {string} scanDepth - standard | balanced | full
 * @returns {{ scanDepth: string, forwardEntries: number, tailEntries: number, maxEntries: number }}
 */
function resolveScanDepthEntries(scanDepth) {
    const mode = typeof scanDepth === 'string' ? scanDepth.trim().toLowerCase() : '';

    if (mode === 'standard') {
        return {
            scanDepth: 'standard',
            forwardEntries: SCAN_DEPTH_STANDARD_ENTRIES,
            tailEntries: 0,
            maxEntries: SCAN_DEPTH_STANDARD_ENTRIES
        };
    }

    if (mode === 'full') {
        return {
            scanDepth: 'full',
            forwardEntries: SCAN_DEPTH_MAX_ENTRIES,
            tailEntries: 0,
            maxEntries: SCAN_DEPTH_MAX_ENTRIES
        };
    }

    // Unknown or absent input stays on the long-standing balanced default.
    return balancedScanDepth();
}

module.exports = {
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_STANDARD_ENTRIES,
    SCAN_DEPTH_TAIL_ENTRIES,
    SCAN_DEPTH_MAX_ENTRIES,
    resolveScanDepthEntries
};
