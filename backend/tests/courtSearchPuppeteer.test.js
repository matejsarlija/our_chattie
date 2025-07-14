const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');

jest.setTimeout(30000); // Increase timeout for slow browser tests

describe('CourtSearchPuppeteer', () => {
    let automator;
    beforeAll(async () => {
        automator = new CourtSearchPuppeteer();
        await automator.init();
    });
    afterAll(async () => {
        await automator.close();
    });

    it('should return results for a known OIB', async () => {
        const result = await automator.searchByOIB('66124057408');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
    });

    it('should return first result with documents or null', async () => {
        const result = await automator.searchFirstWithDocuments('66124057408');
        expect(result === null || (result.hasDocuments && Array.isArray(result.documentLinks))).toBe(true);
    });

    it('should return results for a known case number', async () => {
        const result = await automator.searchByCaseNumber('St-2/2013');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
    });

    it('should return results for a known subject name', async () => {
        const result = await automator.searchBySubjectName('Kerum');
        expect(result).toHaveProperty('results');
        expect(Array.isArray(result.results)).toBe(true);
    });
});
