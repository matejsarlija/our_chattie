const {
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_STANDARD_ENTRIES,
    SCAN_DEPTH_TAIL_ENTRIES,
    SCAN_DEPTH_MAX_ENTRIES,
    resolveScanDepthEntries
} = require('../court-analysis/utils/scanDepth');
const { computeRawScrapeLimit, resolveScanDepth } = require('../court-analysis/pipeline');

describe('resolveScanDepthEntries', () => {
    test('maps Standardno to the newest 30 court entries without a tail', () => {
        expect(resolveScanDepthEntries('standard')).toEqual({
            scanDepth: 'standard',
            forwardEntries: 30,
            tailEntries: 0,
            maxEntries: 30
        });
    });

    test('maps Uravnoteženo to the newest 30 plus the oldest 10 court entries', () => {
        expect(resolveScanDepthEntries('balanced')).toEqual({
            scanDepth: 'balanced',
            forwardEntries: 30,
            tailEntries: 10,
            maxEntries: 40
        });
    });

    test('caps Sve dostupne at exactly 400 court entries', () => {
        expect(resolveScanDepthEntries('full')).toEqual({
            scanDepth: 'full',
            forwardEntries: 400,
            tailEntries: 0,
            maxEntries: 400
        });
    });

    test('falls back to balanced for unrecognized or absent input', () => {
        const balanced = resolveScanDepthEntries('balanced');

        expect(resolveScanDepthEntries('deep')).toEqual(balanced);
        expect(resolveScanDepthEntries(undefined)).toEqual(balanced);
        expect(resolveScanDepthEntries(null)).toEqual(balanced);
    });

    test('publishes the entry-count building blocks', () => {
        expect(COURT_ENTRIES_PER_PAGE).toBe(10);
        expect(SCAN_DEPTH_STANDARD_ENTRIES).toBe(30);
        expect(SCAN_DEPTH_TAIL_ENTRIES).toBe(10);
        expect(SCAN_DEPTH_MAX_ENTRIES).toBe(400);
    });
});

describe('resolveScanDepth', () => {
    test('derives Puppeteer page budgets from forward-entry counts', () => {
        expect(resolveScanDepth('standard')).toEqual({
            scanDepth: 'standard',
            maxPagesScanned: 3,
            tailSample: false,
            maxEntries: 30
        });
        expect(resolveScanDepth('balanced')).toEqual({
            scanDepth: 'balanced',
            maxPagesScanned: 3,
            tailSample: true,
            maxEntries: 40
        });
        expect(resolveScanDepth('full')).toEqual({
            scanDepth: 'full',
            maxPagesScanned: Infinity,
            tailSample: false,
            maxEntries: 400
        });
    });

    test('keeps the historical balanced fallback', () => {
        expect(resolveScanDepth('deep')).toEqual(resolveScanDepth('balanced'));
    });
});

describe('computeRawScrapeLimit', () => {
    const originalLimit = process.env.ANALYSIS_SCRAPE_LIMIT;

    afterEach(() => {
        if (originalLimit === undefined) {
            delete process.env.ANALYSIS_SCRAPE_LIMIT;
        } else {
            process.env.ANALYSIS_SCRAPE_LIMIT = originalLimit;
        }
    });

    test('uses the scan-depth entry cap when no env safety valve is set', () => {
        delete process.env.ANALYSIS_SCRAPE_LIMIT;

        expect(computeRawScrapeLimit(40)).toBe(40);
        expect(computeRawScrapeLimit(400)).toBe(400);
    });

    test('lets a lower ANALYSIS_SCRAPE_LIMIT tighten the cap further', () => {
        process.env.ANALYSIS_SCRAPE_LIMIT = '7';

        expect(computeRawScrapeLimit(40)).toBe(7);
        expect(computeRawScrapeLimit(400)).toBe(7);
    });

    test('never lets a higher ANALYSIS_SCRAPE_LIMIT widen the scan-depth cap', () => {
        process.env.ANALYSIS_SCRAPE_LIMIT = '500';

        expect(computeRawScrapeLimit(40)).toBe(40);
        expect(computeRawScrapeLimit(400)).toBe(400);
    });
});
