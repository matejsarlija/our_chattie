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
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 9);
  });

  test('clamps options.caseLimit into supported bounds', async () => {
    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 0 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 3);

    jest.clearAllMocks();
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([]);

    await expect(
      runCourtAnalysis('66124057408', { caseLimit: 77 }, jest.fn()),
    ).rejects.toThrow();
    expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 30);
  });
});
