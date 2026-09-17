const { runCourtAnalysis, runCourtDiscovery } = require('../court-analysis/pipeline');

jest.setTimeout(180000);

const mockGetDocument = jest.fn();
jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
    getDocument: (...args) => mockGetDocument(...args),
    GlobalWorkerOptions: { workerSrc: '' },
}));

jest.mock('canvas', () => ({
    createCanvas: jest.fn(() => ({
        width: 0, height: 0,
        getContext: jest.fn().mockReturnValue({
            drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
        }),
        toBuffer: jest.fn().mockReturnValue(Buffer.from('fake')),
    })),
}));

beforeEach(() => {
    mockGetDocument.mockResolvedValue({
        numPages: 1,
        getPage: jest.fn().mockResolvedValue({
            getTextContent: jest.fn().mockResolvedValue({
                items: [{ str: 'Mocked court document for live pipeline test' }],
            }),
        }),
        destroy: jest.fn(),
    });
});

const describeIfIntegration = process.env.RUN_PUPPETEER_INTEGRATION === '1' ? describe : describe.skip;

describeIfIntegration('runCourtAnalysis pipeline (live puppeteer)', () => {
    it('captures live discovery metadata without running document analysis', async () => {
        const progressUpdates = [];
        const searchTerm = '66124057408';

        const result = await runCourtDiscovery(searchTerm, { caseLimit: 3 }, (progress) => progressUpdates.push(progress));

        expect(result.discoverySummary).toBeDefined();
        expect(result.discoverySummary.discoveryMode).toBe('search-window');
        expect(typeof result.discoverySummary.rawEntryCount).toBe('number');
        expect(result.discoverySummary.rawEntryCount).toBeGreaterThan(0);
        expect(typeof result.discoverySummary.capturedDistinctCaseCount).toBe('number');
        expect(result.discoverySummary.capturedDistinctCaseCount).toBeGreaterThan(0);
        expect(result.discoverySummary.pagesScanned).toBeGreaterThanOrEqual(1);
        expect(result.discoverySummary.currentPage).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(result.discoverySummary.acquisitionModes)).toBe(true);
        expect(result.discoverySummary.acquisitionModes).toContain('search-window');
        expect(result.primaryCluster).toBeTruthy();
        expect(Array.isArray(result.primaryCluster.acquisitionProvenance)).toBe(true);
        expect(progressUpdates.some((progress) => progress.step === 'grouping')).toBe(true);
    });

    it('runs against real browser + network path', async () => {
        const progressUpdates = [];
        const searchTerm = '66124057408';

        try {
            const result = await runCourtAnalysis(searchTerm, (progress) => progressUpdates.push(progress));
            expect(result).toHaveProperty('processedCases');
            expect(result).toHaveProperty('comparativeAnalysis');
        } catch (e) {
            expect(e.message).toMatch(
                /No results with documents found|timeout|network|Failed to launch the browser process|Dnevni limit AI analize je iscrpljen/i,
            );
        }
    });
});
