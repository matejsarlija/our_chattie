// court-analysis/utils/scanDepth.js
//
// Single source of truth for scan-depth analysis and discovery budgets.

const COURT_ENTRIES_PER_PAGE = 10;

// Retained for the legacy Puppeteer page window until R100-008.
const SCAN_DEPTH_BALANCED_FORWARD_ENTRIES = 30;
const SCAN_DEPTH_TAIL_ENTRIES = 10;
const SCAN_DEPTH_MAX_ENTRIES = 400;

const SCAN_DEPTH_POLICIES = Object.freeze({
    balanced: Object.freeze({
        maxEntries: 100,
        allocation: 'stratified',
        poolCap: 400
    }),
    full: Object.freeze({
        maxEntries: null,
        allocation: 'all',
        poolCap: Number(process.env.ANALYSIS_FULL_MAX_ENTRIES) || 1000
    })
});

function resolveScanDepthEntries(scanDepth) {
    const mode = typeof scanDepth === 'string' ? scanDepth.trim().toLowerCase() : '';
    const normalized = mode === 'full' ? 'full' : 'balanced';
    return { scanDepth: normalized, ...SCAN_DEPTH_POLICIES[normalized] };
}

module.exports = {
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_BALANCED_FORWARD_ENTRIES,
    SCAN_DEPTH_TAIL_ENTRIES,
    SCAN_DEPTH_MAX_ENTRIES,
    SCAN_DEPTH_POLICIES,
    resolveScanDepthEntries
};
