const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockSynthesizeReport = jest.fn();
const mockVerifyReport = jest.fn((report) => Promise.resolve(report));
const mockNormalizeReasoningEvidence = jest.fn((evidencePackage) => ({
    timeline: [],
    claims: [],
    meta: { clusterId: evidencePackage?.clusterId }
}));

jest.mock('../court-analysis/agents/download-agent', () => ({
    DownloadDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockDownloadCall
    }))
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
    AnalyzeDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockAnalyzeCall
    })),
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation(p => Promise.resolve(p))
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
    VisualizerTool: jest.fn()
}));

jest.mock('../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport
}));

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        invoke: jest.fn().mockResolvedValue({ content: '[]' }),
    })),
}));

jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(() => ({
        getEntries: jest.fn().mockReturnValue([]),
        extractEntryTo: jest.fn()
    }));
});

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    unlink: jest.fn((filePath, cb) => cb && cb(null))
}));

const { processScrapedCases } = require('../court-analysis/pipeline');

describe('processScrapedCases stage-counter emission', () => {
    beforeEach(() => {
        mockDownloadCall.mockReset();
        mockAnalyzeCall.mockReset();

        mockDownloadCall.mockImplementation(({ documentLinks, progressCallback }) => {
            (documentLinks || []).forEach((link, index) => {
                progressCallback?.({
                    step: 'downloading',
                    message: `Downloaded: fake_${index}.pdf`,
                    completed: index + 1,
                    total: documentLinks.length,
                });
            });
            return Promise.resolve(documentLinks.map((link, index) => ({
                filePath: `/tmp/fake_${index}.pdf`,
                url: link.url
            })));
        });

        mockAnalyzeCall.mockResolvedValue({
            individualAnalyses: [],
            finalSummary: 'Analysis'
        });
        mockSynthesizeReport.mockResolvedValue({
            schemaVersion: '1.0.0',
            narrative: 'Structured report',
            claims: [],
            findings: [],
            openQuestions: [],
            nextSteps: [],
            conflicts: [],
            meta: {}
        });
    });

    test('announces the discovering denominator once discovery completes', async () => {
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');
        const events = [];

        await processScrapedCases(
            fixture.casesToProcess,
            (event) => events.push(event),
            {
                caseLimit: 3,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        const announcements = events.filter(
            (event) => event?.metadata?.kind === 'stage-counter' && event?.metadata?.stage === 'discovering'
        );

        expect(announcements).toHaveLength(1);
        expect(announcements[0].metadata).toEqual(expect.objectContaining({
            done: 0,
            total: 8,
            unit: 'objava',
        }));
    });

    test('emits downloading counters per completed pack', async () => {
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');
        const events = [];

        await processScrapedCases(
            fixture.casesToProcess,
            (event) => events.push(event),
            {
                caseLimit: 3,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        const counters = events.filter(
            (event) => event?.metadata?.kind === 'stage-counter' && event?.metadata?.stage === 'downloading'
        );

        expect(counters.length).toBeGreaterThan(0);
        for (const counter of counters) {
            expect(counter.metadata).toEqual(expect.objectContaining({ unit: 'datoteka' }));
            expect(counter.metadata.total).toBeGreaterThan(0);
            expect(counter.metadata.done).toBeLessThanOrEqual(counter.metadata.total);
        }
        const last = counters[counters.length - 1];
        expect(last.metadata.done).toBe(last.metadata.total);
    });

    test('counts a real download failure via the explicit `failed` flag, not message text', async () => {
        // Regression guard: the counter used to infer a failure by checking
        // `event.message.startsWith('Failed:')`, coupling the counter to
        // download-agent's exact wording. It now reads an explicit boolean
        // (`event.failed === true`) that download-agent sets directly.
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');
        const events = [];

        mockDownloadCall.mockImplementation(({ documentLinks, progressCallback }) => {
            (documentLinks || []).forEach((link, index) => {
                if (index === 0) {
                    progressCallback?.({
                        step: 'downloading',
                        message: `Failed: ${link.text || 'doc'}`,
                        completed: index + 1,
                        total: documentLinks.length,
                        failed: true,
                    });
                } else {
                    progressCallback?.({
                        step: 'downloading',
                        message: `Downloaded: fake_${index}.pdf`,
                        completed: index + 1,
                        total: documentLinks.length,
                    });
                }
            });
            return Promise.resolve(
                documentLinks.slice(1).map((link, index) => ({
                    filePath: `/tmp/fake_${index}.pdf`,
                    url: link.url,
                }))
            );
        });

        await processScrapedCases(
            fixture.casesToProcess,
            (event) => events.push(event),
            {
                caseLimit: 3,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        const counters = events.filter(
            (event) => event?.metadata?.kind === 'stage-counter' && event?.metadata?.stage === 'downloading'
        );

        expect(counters.length).toBeGreaterThan(0);
        // The failed count must reach (and stay at) 1 once the failed event is
        // processed, and never regress back to 0 on subsequent successes.
        const failedCounts = counters.map((c) => c.metadata.failed);
        expect(Math.max(...failedCounts)).toBe(1);
        expect(counters[counters.length - 1].metadata.failed).toBe(1);
    });

    test('emits extracting counters with null totals until the file count is known', async () => {
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');
        const events = [];

        await processScrapedCases(
            fixture.casesToProcess,
            (event) => events.push(event),
            {
                caseLimit: 3,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        const counters = events.filter(
            (event) => event?.metadata?.kind === 'stage-counter' && event?.metadata?.stage === 'extracting'
        );

        expect(counters.length).toBeGreaterThan(0);
        expect(counters.some((c) => c.metadata.total === null)).toBe(true);
        const last = counters[counters.length - 1];
        expect(last.metadata.total).toBeGreaterThanOrEqual(0);
        expect(last.metadata.done).toBe(last.metadata.total);
    });
});
