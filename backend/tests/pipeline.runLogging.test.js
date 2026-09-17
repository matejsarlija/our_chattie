const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockSynthesizeReport = jest.fn();
const mockVerifyReport = jest.fn((report) => Promise.resolve(report));
const mockNormalizeReasoningEvidence = jest.fn((evidencePackage) => ({
    timeline: [],
    claims: [],
    meta: { clusterId: evidencePackage?.clusterId }
}));

const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../helpers/logger', () => ({
    info: (...args) => mockLoggerInfo(...args),
    warn: (...args) => mockLoggerWarn(...args),
    error: (...args) => mockLoggerError(...args),
    debug: jest.fn(),
    redact: (value) => String(value),
    redactSecrets: (value) => String(value),
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

const { processScrapedCases, PartialAnalysisError } = require('../court-analysis/pipeline');

const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');

function baseOptions(overrides = {}) {
    return {
        caseLimit: 3,
        enableVisualizer: false,
        query: fixture.query,
        discoveryMetadata: fixture.discoveryMetadata,
        ...overrides,
    };
}

function resetMocks() {
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();

    mockDownloadCall.mockReset();
    mockDownloadCall.mockImplementation(({ documentLinks }) => Promise.resolve(
        (documentLinks || []).map((link, index) => ({ filePath: `/tmp/fake_${index}.pdf`, url: link.url }))
    ));

    mockAnalyzeCall.mockReset();
    mockAnalyzeCall.mockResolvedValue({
        individualAnalyses: [
            {
                text: 'doc1.pdf',
                filePath: '/tmp/fake_0.pdf',
                aiResult: {
                    caseNumber: 'ST-100/2023',
                    decisionDate: '2024-01-10',
                    summary: 'Tražbina od 100 EUR.',
                    amounts: [{ description: 'Polog', amount: 100, currency: 'EUR', quote: 'Polog od 100 EUR', grounded: true }],
                    propertyFlow: [],
                },
            },
        ],
        coverage: { analyzed: 1, failed: 0, total: 1, coverageRatio: 1, complete: true, failedFiles: [], groundedClaims: 1, totalClaims: 1 },
    });

    mockSynthesizeReport.mockReset();
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
}

function allLoggerCalls() {
    return [
        ...mockLoggerInfo.mock.calls.map((args) => ({ level: 'info', args })),
        ...mockLoggerWarn.mock.calls.map((args) => ({ level: 'warn', args })),
        ...mockLoggerError.mock.calls.map((args) => ({ level: 'error', args })),
    ];
}

describe('pipeline run logging (runId correlation + run summary)', () => {
    beforeEach(resetMocks);

    test('threads the same runId through every logger.* call', async () => {
        await processScrapedCases(fixture.casesToProcess, jest.fn(), baseOptions({ runId: 'run-123' }));

        const calls = allLoggerCalls();
        expect(calls.length).toBeGreaterThan(0);
        const metas = calls.map(({ args }) => args[2]);
        expect(metas.every((meta) => typeof meta === 'object' && meta !== null)).toBe(true);
        expect(new Set(metas.map((meta) => meta.runId))).toEqual(new Set(['run-123']));
        // Report-service stages are part of the same run.
        const scopes = calls.map(({ args }) => args[0]);
        expect(scopes).toEqual(expect.arrayContaining([
            'pipeline.processScrapedCases',
            'reportService.retrieve',
            'reportService.synthesize',
            'reportService.verify',
        ]));
    });

    test('omitting runId never throws and logs null cleanly', async () => {
        await expect(
            processScrapedCases(fixture.casesToProcess, jest.fn(), baseOptions())
        ).resolves.toBeDefined();

        const calls = allLoggerCalls();
        expect(calls.length).toBeGreaterThan(0);
        for (const { args } of calls) {
            expect(args[2]?.runId).toBeNull();
        }
    });

    test('success path emits the run summary exactly once with expected fields', async () => {
        const result = await processScrapedCases(fixture.casesToProcess, jest.fn(), baseOptions({ runId: 'run-123' }));

        const summaries = mockLoggerInfo.mock.calls.filter((args) => args[1] === 'Run summary');
        expect(summaries).toHaveLength(1);
        const meta = summaries[0][2];
        expect(meta).toEqual(expect.objectContaining({
            runId: 'run-123',
            status: 'complete',
            query: { type: 'text', value: 'KERUM' },
            discoveryMode: expect.any(String),
            processedCases: result.processedCases.length,
            documentsAnalyzed: 1,
            documentsFailed: 0,
            groundedClaims: 1,
            totalClaims: 1,
            propertyFlowEntries: expect.any(Number),
            propertyConflicts: expect.any(Number),
            usage: expect.objectContaining({ totalTokens: expect.any(Number), calls: expect.any(Number) }),
            durationMs: expect.any(Number),
            reportError: null,
        }));
        expect(meta.scanDepth !== undefined).toBe(true);
    });

    test('failure path emits a failed run summary and still throws PartialAnalysisError', async () => {
        await expect(
            processScrapedCases([], jest.fn(), baseOptions({ runId: 'run-9' }))
        ).rejects.toThrow(PartialAnalysisError);

        const summaries = mockLoggerError.mock.calls.filter((args) => args[1] === 'Run summary');
        expect(summaries).toHaveLength(1);
        expect(summaries[0][2]).toEqual(expect.objectContaining({
            runId: 'run-9',
            status: 'failed',
            processedCases: 0,
            error: expect.any(String),
        }));
        // No success summary on the failure path.
        expect(mockLoggerInfo.mock.calls.filter((args) => args[1] === 'Run summary')).toHaveLength(0);
    });
});
