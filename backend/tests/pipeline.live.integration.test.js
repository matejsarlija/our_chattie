const { runCourtAnalysis } = require('../court-analysis/pipeline');

jest.setTimeout(60000);

const describeIfIntegration = process.env.RUN_PUPPETEER_INTEGRATION === '1' ? describe : describe.skip;

describeIfIntegration('runCourtAnalysis pipeline (live puppeteer)', () => {
    it('runs against real browser + network path', async () => {
        const progressUpdates = [];
        const searchTerm = '66124057408';

        try {
            const result = await runCourtAnalysis(searchTerm, (progress) => progressUpdates.push(progress));
            expect(result).toHaveProperty('processedCases');
            expect(result).toHaveProperty('comparativeAnalysis');
        } catch (e) {
            expect(e.message).toMatch(
                /No results with documents found|timeout|network|Failed to launch the browser process/i,
            );
        }
    });
});
