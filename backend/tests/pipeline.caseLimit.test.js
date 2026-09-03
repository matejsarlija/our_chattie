const mockSearchAndGetLatestCasesWithDocuments = jest.fn();
const mockInit = jest.fn();
const mockClose = jest.fn();

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

const { runCourtAnalysis, runCourtAnalysisWithExistingAutomator } = require('../court-analysis/pipeline');

describe('runCourtAnalysis caseLimit options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANALYSIS_SCRAPE_LIMIT;
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);
  });

  test('uses default caseLimit when options are omitted and second arg is callback', async () => {
    const progress = jest.fn();
    await expect(runCourtAnalysis('66124057408', progress)).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);
  });

  test('honors options.caseLimit from caller', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 3 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);
  });

  test('clamps options.caseLimit into supported bounds', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 0 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);

    jest.clearAllMocks();
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);

    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 77 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);
  });

  test('uses the balanced-depth entry budget by default', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);
  });

  test('lets a lower ANALYSIS_SCRAPE_LIMIT tighten the entry budget', async () => {
    process.env.ANALYSIS_SCRAPE_LIMIT = '7';
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 7, 3, true, null);
  });

  test('never lets a higher ANALYSIS_SCRAPE_LIMIT widen the entry budget', async () => {
    process.env.ANALYSIS_SCRAPE_LIMIT = '500';
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);
  });

  test('threads the balanced-depth entry budget through an existing automator', async () => {
    const existingAutomator = { searchAndGetLatestCasesWithDocuments: mockSearchAndGetLatestCasesWithDocuments };
    await expect(
      runCourtAnalysisWithExistingAutomator('66124057408', { caseLimit: 5 }, existingAutomator, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null);
  });

  test('resolves scanDepth standard into no tail sampling', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5, scanDepth: 'standard' }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 30, 3, false, null);
  });

  test('resolves scanDepth full into a capped entry scan', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5, scanDepth: 'full' }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 400, Infinity, false, null);
  });
});
