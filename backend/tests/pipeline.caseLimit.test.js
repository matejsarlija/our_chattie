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

const mockResolveGeminiPlan = jest.fn(() => 'free');
jest.mock('../helpers/geminiPlan', () => ({
  resolveGeminiPlan: () => mockResolveGeminiPlan(),
}));

const { runCourtAnalysis } = require('../court-analysis/pipeline');

describe('runCourtAnalysis caseLimit + scrapeLimit options', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANALYSIS_SCRAPE_LIMIT;
    mockResolveGeminiPlan.mockReturnValue('free');
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);
  });

  test('uses default caseLimit when options are omitted and second arg is callback', async () => {
    const progress = jest.fn();
    await expect(runCourtAnalysis('66124057408', progress)).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 15);
  });

  test('honors options.caseLimit from caller', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 3 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 15);
  });

  test('clamps options.caseLimit into supported bounds', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 0 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 15);

    jest.clearAllMocks();
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);

    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 77 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 15);
  });

  test('caps capture at 15 by default on the free plan', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 15);
  });

  test('caps capture at 50 by default on the paid plan', async () => {
    mockResolveGeminiPlan.mockReturnValue('paid');
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 50);
  });

  test('applies ANALYSIS_SCRAPE_LIMIT env override when set (wins over the plan)', async () => {
    process.env.ANALYSIS_SCRAPE_LIMIT = '7';
    mockResolveGeminiPlan.mockReturnValue('paid');
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 5 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 7);
  });
});
