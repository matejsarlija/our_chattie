jest.mock('../scraper/courtSearchPuppeteer', () => {
    return jest.fn().mockImplementation(() => ({
        init: jest.fn(),
        searchAndGetLatestCasesWithDocuments: jest.fn().mockResolvedValue(null),
        searchAndGetLatestCases: jest.fn().mockResolvedValue(null),
        close: jest.fn()
    }));
});

const { runCourtAnalysis, runCourtDiscovery } = require('../court-analysis/pipeline');

jest.setTimeout(30000); // Increase timeout for slow browser tests

describe('runCourtAnalysis error/edge cases', () => {
    it('throws for missing search term', async () => {
        await expect(runCourtAnalysis(undefined)).rejects.toThrow();
    });

    it('throws for no results with documents', async () => {
        await expect(runCourtAnalysis('66124057408')).rejects.toThrow(/nijedan predmet|no results/i);
    });

    it('throws when discovery returns no results', async () => {
        await expect(runCourtDiscovery('66124057408')).rejects.toThrow();
    });
});
