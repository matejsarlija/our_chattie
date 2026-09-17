const mockSearchAndGetLatestCasesWithDocuments = jest.fn();
const mockInit = jest.fn();
const mockClose = jest.fn();
const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockVisualizerCall = jest.fn();
const mockSynthesizeReport = jest.fn();
const mockVerifyReport = jest.fn((report) => Promise.resolve(report));
const mockNormalizeReasoningEvidence = jest.fn((evidencePackage) => ({
  timeline: [],
  claims: [],
  meta: { clusterId: evidencePackage?.clusterId },
}));

jest.mock('../scraper/courtSearchPuppeteer', () => {
  return jest.fn().mockImplementation(() => ({
    init: mockInit,
    close: mockClose,
    searchAndGetLatestCasesWithDocuments: mockSearchAndGetLatestCasesWithDocuments,
  }));
});

jest.mock('../scraper/discoveryClient', () => ({
  createDiscoveryClient: jest.fn(() => ({
    init: mockInit,
    close: mockClose,
    searchAndGetLatestCasesWithDocuments: mockSearchAndGetLatestCasesWithDocuments,
  })),
}));

jest.mock('../court-analysis/agents/download-agent', () => ({
  DownloadDocumentsTool: jest.fn().mockImplementation(() => ({
    _call: mockDownloadCall,
  })),
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
  AnalyzeDocumentsTool: jest.fn().mockImplementation(() => ({
    _call: mockAnalyzeCall,
  })),
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
  VisualizerTool: jest.fn().mockImplementation(() => ({
    _call: mockVisualizerCall,
  })),
}));

jest.mock('../court-analysis/reasoning/synthesizer', () => ({
  synthesizeReport: mockSynthesizeReport,
  normalizeReasoningEvidence: mockNormalizeReasoningEvidence,
}));

jest.mock('../court-analysis/reasoning/verifier', () => ({
  verifyReport: mockVerifyReport,
}));

// Optional reasoning LLM passes (rerank/planner/follow-up) construct Gemini
// clients lazily; stub the SDK so the deterministic path runs without network.
jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    invoke: jest.fn().mockResolvedValue({ content: '[]' }),
  })),
}));

jest.mock('../court-registry/enricher', () => ({
  enrichParticipants: jest.fn().mockImplementation((p) => Promise.resolve(p)),
}));

jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => ({
    getEntries: jest.fn().mockReturnValue([]),
    extractEntryTo: jest.fn(),
  }));
});

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  unlink: jest.fn((path, cb) => cb && cb(null)),
}));

const { runCourtAnalysis } = require('../court-analysis/pipeline');

describe('runCourtAnalysis visualizer defaults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([
      {
        caseInfo: { caseNumber: 'C1', title: 'T1', participants: [] },
        documentLinks: [{ url: 'u1', text: 'doc1' }],
      },
    ]);
    mockDownloadCall.mockResolvedValue([{ filePath: '/tmp/fake_1.pdf', url: 'u1' }]);
    mockAnalyzeCall.mockResolvedValue({ individualAnalyses: [], finalSummary: 'Analysis' });
    mockVisualizerCall.mockResolvedValue('graph TD; A-->B');
    mockSynthesizeReport.mockResolvedValue({
      schemaVersion: '1.0.0',
      narrative: 'Structured report',
      claims: [],
      findings: [],
      openQuestions: [],
      nextSteps: [],
      conflicts: [],
      meta: {},
    });
  });

  test('keeps visualizer enabled when options include only caseLimit', async () => {
    await runCourtAnalysis('66124057408', { caseLimit: 1 }, jest.fn());
    expect(mockVisualizerCall).toHaveBeenCalledTimes(1);
  });

  test('disables visualizer only when explicitly requested', async () => {
    await runCourtAnalysis('66124057408', { caseLimit: 1, enableVisualizer: false }, jest.fn());
    expect(mockVisualizerCall).not.toHaveBeenCalled();
  });

  test('passes structured money-flow data to the visualizer when analyses contain amounts', async () => {
    mockAnalyzeCall.mockResolvedValue({
      individualAnalyses: [
        {
          text: 'diobni_popis.pdf',
          aiResult: {
            summary: 'Isplata drugog višeg isplatnog reda.',
            caseNumber: 'C1',
            amounts: [{ description: 'Isplata drugog višeg isplatnog reda', amount: '1.200.000,00', currency: 'EUR', date: '2025-12-17' }],
          },
        },
      ],
      finalSummary: 'Analysis',
    });

    await runCourtAnalysis('66124057408', { caseLimit: 1 }, jest.fn());

    expect(mockVisualizerCall).toHaveBeenCalledTimes(1);
    expect(mockVisualizerCall).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        moneyFlow: expect.objectContaining({
          count: 1,
          hasMoneyFlow: true,
        }),
      }),
    );
  });
});
