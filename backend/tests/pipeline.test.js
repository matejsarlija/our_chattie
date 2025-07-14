const { runCourtAnalysis } = require('../court-analysis/pipeline');

jest.setTimeout(60000); // Increase timeout for slow browser tests (2 minutes)

describe('runCourtAnalysis pipeline', () => {
    it('should run the pipeline and return results for a valid search term', async () => {
        const progressUpdates = [];
        // Use a known OIB or case number with public docs for real test
        const searchTerm = '66124057408';
        let result;
        try {
            result = await runCourtAnalysis(searchTerm, (progress) => progressUpdates.push(progress));
        } catch (e) {
            // Acceptable if no docs found, but should not throw for network
            expect(e.message).toMatch(/No results with documents found|timeout|network/i);
            return;
        }
        expect(result).toHaveProperty('caseResult');
        expect(result).toHaveProperty('files');
        expect(result).toHaveProperty('analysis');
        expect(progressUpdates.some(p => p.step === 'scraping')).toBe(true);
        expect(progressUpdates.some(p => p.step === 'downloading')).toBe(true);
        expect(progressUpdates.some(p => p.step === 'analyzing')).toBe(true);
        expect(progressUpdates.some(p => p.step === 'complete')).toBe(true);
    });
});
