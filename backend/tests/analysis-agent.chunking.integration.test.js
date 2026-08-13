const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGeminiInvoke = jest.fn();
const mockWithGeminiRetry = jest.fn();
const mockSplitTextIntoChunks = jest.fn();

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    invoke: mockGeminiInvoke,
  })),
}));

jest.mock('../helpers/geminiRetry', () => ({
  withGeminiRetry: (...args) => mockWithGeminiRetry(...args),
  withGeminiTimeout: (callable) => callable(undefined),
}));

jest.mock('../court-analysis/reasoning/chunker', () => ({
  splitTextIntoChunks: (...args) => mockSplitTextIntoChunks(...args),
}));

const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');

describe('AnalyzeDocumentsTool chunking integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockWithGeminiRetry.mockImplementation(async (fn) => fn());
    mockGeminiInvoke.mockResolvedValue({
      content: JSON.stringify({
        caseNumber: 'St-357/2013',
        decisionDate: '2026-03-08',
        summary: 'Sažetak.',
      }),
    });

    mockSplitTextIntoChunks.mockReturnValue([
      {
        id: 'chunk-1',
        text: 'Najnovija relevantna činjenica iz dokumenta.',
        metadata: { docId: 'test-doc', startIndex: 0, endIndex: 1200 },
      },
      {
        id: 'chunk-2',
        text: 'Ključni iznos je 250.000 EUR i važan procesni korak.',
        metadata: { docId: 'test-doc', startIndex: 1000, endIndex: 2200 },
      },
    ]);
  });

  it('uses chunking/retrieval path for large documents', async () => {
    const tool = new AnalyzeDocumentsTool();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-agent-'));
    const largeTxtPath = path.join(tmpDir, 'large.txt');
    const largeText = `UVOD\\n${'A'.repeat(28000)}\\nZAKLJUCAK`;

    fs.writeFileSync(largeTxtPath, largeText, 'utf8');

    try {
      const result = await tool._call({
        files: [{ filePath: largeTxtPath, text: 'large.txt', url: 'mock://large' }],
        caseInfo: { participants: [] },
      });

      expect(result.individualAnalyses).toHaveLength(1);
      expect(mockSplitTextIntoChunks).toHaveBeenCalledTimes(1);

      const prompt = mockGeminiInvoke.mock.calls[0][0];
      expect(prompt).toContain('Najnovija relevantna činjenica iz dokumenta.');
      expect(prompt).toContain('Ključni iznos je 250.000 EUR');
      expect(prompt).not.toContain('A'.repeat(500));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
