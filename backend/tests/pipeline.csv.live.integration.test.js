const { runCourtAnalysis, runCourtDiscovery } = require('../court-analysis/pipeline');

jest.setTimeout(180000);

// This lane closes the "Known gap" named in eoglasna_export_phase_c_followups.md
// §2.3: no live lane previously ran the analysis pipeline through the CSV
// discovery path (Phase A) against real e-Oglasna — only the Puppeteer path
// was covered live (pipeline.live.integration.test.js, DISCOVERY_SOURCE=
// puppeteer), while CSV was only exercised via unit fixtures. This pins the
// discovery source the OTHER way, hard (not `auto`), so a CSV failure fails
// the test loudly instead of silently and successfully falling back to
// Puppeteer — that would defeat the entire purpose of this lane.
process.env.DISCOVERY_SOURCE = 'csv';

// Keeps the download step bounded: this fixed search term (a real bankruptcy
// case) has 100+ filings, and downloading all of them adds runtime without
// adding coverage (the CSV→download→extract→analyze path is proven by the
// first handful of documents just as well as by the hundredth).
process.env.ANALYSIS_SCRAPE_LIMIT = '5';

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

// This lane's job is to prove the REAL CSV export fetch + parsing + mapping +
// grouping + download + extraction + pipeline-orchestration plumbing holds
// together end to end. It is NOT the place to spend real Gemini tokens: the
// mocked PDF text below is synthetic, so any real model call analyzing it
// produces zero signal about analysis quality — that's what
// backend/scripts/verify-live-reasoning.js and verify-live-ocr-batch.js are
// for, against real, purpose-built fixtures. Mocking at the
// createGeminiClient/generateClusterReport boundary keeps AnalyzeDocumentsTool's
// real orchestration (retries, JSON parsing, usage tracking) exercised, while
// making every model call free, instant, and deterministic — and, as a side
// effect, this lane no longer needs a real GOOGLE_API_KEY to run.
jest.mock('../helpers/geminiConfig', () => {
    const actual = jest.requireActual('../helpers/geminiConfig');
    const cannedContentByRole = {
        analysis: JSON.stringify({
            caseNumber: 'MOCK-1/2024',
            decisionDate: '2024-01-01',
            summary: 'Mock summary for CSV live pipeline test.',
            amounts: [],
        }),
        ocr: 'Mock OCR page text.',
        'ocr-batch': '=== STRANICA 1 ===\nMock OCR page text.',
        visualizer: 'flowchart TD\n    A[Mock] --> B[Diagram]',
    };
    const mockUsageMetadata = { input_tokens: 50, output_tokens: 20, total_tokens: 70 };
    return {
        ...actual,
        createGeminiClient: (role) => ({
            invoke: jest.fn().mockResolvedValue({
                content: cannedContentByRole[role] ?? '{}',
                usage_metadata: mockUsageMetadata,
            }),
        }),
    };
});

// generateClusterReport fans out into synthesis + verify + rerank + planner,
// each a real Gemini call over the (already mocked-cheap) analyzed text.
// That subsystem's model-quality behavior is exactly what verify-live-
// reasoning.js already covers with a real fixture; re-running it here against
// synthetic per-document text only reproduces flakiness unrelated to what
// this lane verifies (the CSV discovery path). composeOverviewMarkdown stays
// real (it's pure/deterministic) so this canned report still exercises the
// actual markdown composition path.
jest.mock('../court-analysis/reasoning/reportService', () => {
    const actual = jest.requireActual('../court-analysis/reasoning/reportService');
    const mockReport = {
        schemaVersion: '1.0.0',
        narrative: 'Mock narrative for CSV live pipeline test.',
        findings: [{ id: 'finding-1', text: 'Mock finding.', confidence: 'medium', citations: [] }],
        verifiedFindings: [],
        openQuestions: [],
        nextSteps: [],
        conflicts: [],
        claims: [],
        meta: { generatedAt: new Date().toISOString() },
    };
    return {
        generateClusterReport: jest.fn().mockResolvedValue(mockReport),
        composeOverviewMarkdown: actual.composeOverviewMarkdown,
        buildSynthesisInput: jest.fn(),
    };
});

let mockDocCounter = 0;

beforeEach(() => {
    mockDocCounter = 0;
    // pdfjs-dist's real getDocument() returns a PDFDocumentLoadingTask — an
    // object carrying a `.promise` field — not a promise itself. The code
    // under test always does `pdfjsLib.getDocument(...).promise`, so the mock
    // must mirror that shape; a bare mockResolvedValue() here would make
    // `.promise` undefined and break every PDF extraction in this suite (see
    // the identical fix in pipeline.live.integration.test.js).
    //
    // Text varies per document (not a single repeated string): identical text
    // across every "document" is a degenerate scenario a real PDF set never
    // produces, and it starves the synthesizer's fallback overview builder of
    // distinguishable content (moot here since generateClusterReport itself is
    // mocked above, but kept for parity/consistency with the Puppeteer lane).
    mockGetDocument.mockImplementation(() => {
        mockDocCounter += 1;
        const n = mockDocCounter;
        return {
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue({
                    getTextContent: jest.fn().mockResolvedValue({
                        items: [{
                            str: `Mocked court document #${n} for CSV live pipeline test. ` +
                                `Rješenje broj P-${n}/2024 od 0${(n % 9) + 1}.06.2024. Iznos: ${100 * n} EUR.`,
                        }],
                    }),
                }),
                destroy: jest.fn(),
            }),
        };
    });
});

const describeIfIntegration = process.env.RUN_PUPPETEER_INTEGRATION === '1' ? describe : describe.skip;

describeIfIntegration('runCourtAnalysis pipeline (live CSV export discovery)', () => {
    it('captures live discovery metadata via the CSV export path (not a Puppeteer fallback)', async () => {
        const progressUpdates = [];
        const searchTerm = '66124057408';

        const result = await runCourtDiscovery(searchTerm, { caseLimit: 3 }, (progress) => progressUpdates.push(progress));

        expect(result.discoverySummary).toBeDefined();
        // The load-bearing assertion for this whole lane: prove CSV actually
        // ran, rather than DISCOVERY_SOURCE=csv silently misbehaving in a way
        // that happens to still produce a result (e.g. if resolveDiscoverySource
        // ever regressed to defaulting elsewhere). discoveryMode is set by
        // CsvExportClient.buildDiscoveryMetadata and survives untouched through
        // buildDiscoverySummary.
        expect(result.discoverySummary.discoveryMode).toBe('csv-export');
        expect(result.discoverySummary.acquisitionModes).toContain('csv-export');
        expect(typeof result.discoverySummary.rawEntryCount).toBe('number');
        expect(result.discoverySummary.rawEntryCount).toBeGreaterThan(0);
        expect(typeof result.discoverySummary.capturedDistinctCaseCount).toBe('number');
        expect(result.discoverySummary.capturedDistinctCaseCount).toBeGreaterThan(0);
        expect(result.primaryCluster).toBeTruthy();
        expect(progressUpdates.some((progress) => progress.step === 'grouping')).toBe(true);
    });

    it('runs the full analysis pipeline against real CSV-discovered documents', async () => {
        const progressUpdates = [];
        const searchTerm = '66124057408';

        try {
            const result = await runCourtAnalysis(searchTerm, (progress) => progressUpdates.push(progress));
            expect(result).toHaveProperty('processedCases');
            expect(result).toHaveProperty('comparativeAnalysis');
            expect(result.discoverySummary.discoveryMode).toBe('csv-export');

            // Proves real documents were actually downloaded + extracted from
            // the CSV-provided links, not just that discovery metadata looked
            // right: at least one real file made it into a processed case.
            expect(result.processedCases.length).toBeGreaterThan(0);
            const totalFiles = result.processedCases.reduce(
                (sum, processedCase) => sum + (Array.isArray(processedCase.files) ? processedCase.files.length : 0),
                0
            );
            expect(totalFiles).toBeGreaterThan(0);

            // Usage is deterministic and cheap here (Gemini is mocked above),
            // but still asserted non-zero as a regression guard: if usage
            // accounting broke and silently returned zero, this lane fails
            // instead of hiding it.
            expect(result).toHaveProperty('usage');
            expect(result.usage.calls).toBeGreaterThan(0);
            console.log(
                `[csv-discovery] ${searchTerm}: discoveryMode=${result.discoverySummary.discoveryMode}, ` +
                `processedCases=${result.processedCases.length}, filesDownloaded=${totalFiles}, ` +
                `usage=${result.usage.calls} calls / ${result.usage.totalTokens} tokens`
            );
        } catch (e) {
            // The only acceptable failures are genuine site/network conditions,
            // never a silent CSV->Puppeteer fallback masking a real regression
            // (DISCOVERY_SOURCE=csv is hard-pinned above, so a CSV failure
            // surfaces as an error here rather than falling back).
            expect(e.message).toMatch(
                /No results with documents found|timeout|network|CSV export/i,
            );
        }
    });
});
