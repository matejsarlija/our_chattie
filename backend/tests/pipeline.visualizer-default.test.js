const mockSearchAndGetLatestCasesWithDocuments = jest.fn();
const mockInit = jest.fn();
const mockClose = jest.fn();
const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockVisualizerCall = jest.fn();

jest.mock('../scraper/courtSearchPuppeteer', () => {
  return jest.fn().mockImplementation(() => ({
    init: mockInit,
    close: mockClose,
    searchAndGetLatestCasesWithDocuments: mockSearchAndGetLatestCasesWithDocuments,
  }));
});

jest.mock('../court-analysis/agents/download-agent', () => ({
  DownloadDocumentsTool: jest.fn().mockImplementation(() => ({
    _call: mockDownloadCall,
  })),
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
  AnalyzeDocumentsTool: jest.fn().mockImplementation(() => ({
    _call: mockAnalyzeCall,
  })),
  generateComparativeAnalysis: jest.fn().mockResolvedValue('Comparative Analysis'),
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
  VisualizerTool: jest.fn().mockImplementation(() => ({
    _call: mockVisualizerCall,
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
  });

  test('keeps visualizer enabled when options include only caseLimit', async () => {
    await runCourtAnalysis('66124057408', { caseLimit: 1 }, jest.fn());
    expect(mockVisualizerCall).toHaveBeenCalledTimes(1);
  });

  test('disables visualizer only when explicitly requested', async () => {
    await runCourtAnalysis('66124057408', { caseLimit: 1, enableVisualizer: false }, jest.fn());
    expect(mockVisualizerCall).not.toHaveBeenCalled();
  });
});
