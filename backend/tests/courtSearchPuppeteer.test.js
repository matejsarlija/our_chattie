const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');

jest.setTimeout(60000); // Increase timeout for slow browser tests

const KERUM_OIB = '66124057408';
const describeIfPuppeteer = process.env.RUN_PUPPETEER_INTEGRATION === '1' ? describe : describe.skip;

describeIfPuppeteer('CourtSearchPuppeteer (live browser)', () => {
    let automator;
    beforeAll(async () => {
        automator = new CourtSearchPuppeteer();
        await automator.init();
    });
    afterAll(async () => {
        await automator.close();
    });

    it('should return results for a known OIB', async () => {
        const result = await automator.searchAndGetLatestCases(KERUM_OIB);
        expect(result).toHaveProperty('casesToProcess');
        expect(Array.isArray(result.casesToProcess)).toBe(true);
    });

    it('should return cases with documents or empty result', async () => {
        const result = await automator.searchAndGetLatestCasesWithDocuments(KERUM_OIB);
        expect(result).toHaveProperty('casesToProcess');
        expect(Array.isArray(result.casesToProcess)).toBe(true);
        expect(result).toHaveProperty('discoveryMetadata');
    });

    it('should find the first case with documents or null', async () => {
        const result = await automator.searchAndGetFirstCaseWithDocuments(KERUM_OIB);
        expect(result === null || (result.caseInfo && Array.isArray(result.documentLinks))).toBe(true);
    });
});
