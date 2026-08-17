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

const { runCourtAnalysis } = require('../court-analysis/pipeline');

describe('runCourtAnalysis caseLimit options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANALYSIS_SCRAPE_LIMIT;
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);
  });

  test('uses default caseLimit when options are omitted and second arg is callback', async () => {
    const progress = jest.fn();
    await expect(runCourtAnalysis('66124057408', progress)).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, true);
  });

  test('honors options.caseLimit from caller', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 3 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, true);
  });

  test('clamps options.caseLimit into supported bounds', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 0 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, true);

    jest.clearAllMocks();
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);

    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 77 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, true);
  });

  test('captures the full document history by default (no truncation)', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, true);
  });

  test('applies ANALYSIS_SCRAPE_LIMIT env override when set', async () => {
    process.env.ANALYSIS_SCRAPE_LIMIT = '7';
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 7, null, true);
  });

  test('resolves scanDepth standard into no tail sampling', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5, scanDepth: 'standard' }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, false);
  });

  test('resolves scanDepth full into an unbounded page scan', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5, scanDepth: 'full' }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, Infinity, false);
  });
});
