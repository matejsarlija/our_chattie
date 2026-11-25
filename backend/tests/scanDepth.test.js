const {
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_POLICIES,
    resolveScanDepthEntries
} = require('../court-analysis/utils/scanDepth');
const { computeRawScrapeLimit, resolveScanDepth } = require('../court-analysis/pipeline');

const originalScrapeLimit = process.env.ANALYSIS_SCRAPE_LIMIT;
const originalFullMaxEntries = process.env.ANALYSIS_FULL_MAX_ENTRIES;

afterEach(() => {
    if (originalScrapeLimit === undefined) delete process.env.ANALYSIS_SCRAPE_LIMIT;
    else process.env.ANALYSIS_SCRAPE_LIMIT = originalScrapeLimit;
    if (originalFullMaxEntries === undefined) delete process.env.ANALYSIS_FULL_MAX_ENTRIES;
    else process.env.ANALYSIS_FULL_MAX_ENTRIES = originalFullMaxEntries;
});

describe('SCAN_DEPTH_POLICIES', () => {
    test('declares the balanced and full budgets', () => {
        expect(Object.keys(SCAN_DEPTH_POLICIES)).toEqual(['balanced', 'full']);
        expect(SCAN_DEPTH_POLICIES.balanced).toEqual({
            maxEntries: 100,
            allocation: 'stratified',
            poolCap: 400
        });
        expect(SCAN_DEPTH_POLICIES.full).toEqual({
            maxEntries: null,
            allocation: 'all',
            poolCap: Number(process.env.ANALYSIS_FULL_MAX_ENTRIES) || 1000
        });
    });

    test('uses ANALYSIS_FULL_MAX_ENTRIES as the full-discovery cap', () => {
        process.env.ANALYSIS_FULL_MAX_ENTRIES = '1250';
        let policy;
        jest.isolateModules(() => {
            policy = require('../court-analysis/utils/scanDepth').SCAN_DEPTH_POLICIES.full;
        });
        expect(policy.poolCap).toBe(1250);
    });
});

describe('resolveScanDepthEntries', () => {
    test('resolves full and balanced, defaulting unknown and absent values to balanced', () => {
        expect(resolveScanDepthEntries('balanced')).toEqual({
            scanDepth: 'balanced',
            ...SCAN_DEPTH_POLICIES.balanced
        });
        expect(resolveScanDepthEntries('full')).toEqual({
            scanDepth: 'full',
            ...SCAN_DEPTH_POLICIES.full
        });
        expect(resolveScanDepthEntries('standard')).toEqual(resolveScanDepthEntries('balanced'));
        expect(resolveScanDepthEntries(undefined)).toEqual(resolveScanDepthEntries('balanced'));
        expect(resolveScanDepthEntries(null)).toEqual(resolveScanDepthEntries('balanced'));
    });

    test('retains page-based compatibility only for the Puppeteer fallback', () => {
        expect(COURT_ENTRIES_PER_PAGE).toBe(10);
        expect(resolveScanDepth('balanced')).toEqual({
            scanDepth: 'balanced',
            ...SCAN_DEPTH_POLICIES.balanced,
            maxPagesScanned: 3,
            tailSample: true
        });
        expect(resolveScanDepth('full')).toEqual({
            scanDepth: 'full',
            ...SCAN_DEPTH_POLICIES.full,
            maxPagesScanned: Infinity,
            tailSample: false
        });
    });
});

describe('computeRawScrapeLimit', () => {
    test('uses the discovery pool cap and lets the environment only tighten it', () => {
        delete process.env.ANALYSIS_SCRAPE_LIMIT;
        expect(computeRawScrapeLimit(SCAN_DEPTH_POLICIES.balanced.poolCap)).toBe(400);
        expect(computeRawScrapeLimit(SCAN_DEPTH_POLICIES.full.poolCap)).toBe(SCAN_DEPTH_POLICIES.full.poolCap);

        process.env.ANALYSIS_SCRAPE_LIMIT = '275';
        expect(computeRawScrapeLimit(400)).toBe(275);
        process.env.ANALYSIS_SCRAPE_LIMIT = '1500';
        expect(computeRawScrapeLimit(400)).toBe(400);
    });
});
