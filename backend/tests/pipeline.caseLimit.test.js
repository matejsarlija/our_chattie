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

const { runCourtAnalysis } = require('../court-analysis/pipeline');

describe('runCourtAnalysis primary-cluster reasoning scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ANALYSIS_SCRAPE_LIMIT;
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);
  });





  test('uses the balanced scan depth without a legacy case-limit option', async () => {
    await expect(
      runCourtAnalysis('66124057408', { scanDepth: 'balanced' }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 40, 3, true, null, null);
  });

  test('resolves scanDepth full into a capped entry scan', async () => {
    await expect(
      runCourtAnalysis('66124057408', { scanDepth: 'full' }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 400, Infinity, false, null, null);
  });
});
