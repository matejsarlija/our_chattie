const { runCourtAnalysis } = require('../court-analysis/pipeline');

jest.setTimeout(30000); // Increase timeout for slow browser tests

describe('runCourtAnalysis error/edge cases', () => {
    it('throws for missing search term', async () => {
        await expect(runCourtAnalysis(undefined)).rejects.toThrow();
    });

    it('throws for no results with documents', async () => {
        // Mock automator to return no results
        jest.mock('../scraper/courtSearchPuppeteer', () => {
            return jest.fn().mockImplementation(() => ({
                init: jest.fn(),
                searchFirstWithDocuments: jest.fn().mockResolvedValue(null),
                close: jest.fn()
            }));
        });
        const { runCourtAnalysis } = require('../court-analysis/pipeline');
        await expect(runCourtAnalysis('no-docs')).rejects.toThrow(/no results/i);
    });
});
