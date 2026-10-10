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
  buildRetrievalChunks: jest.fn(() => []),
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

      const prompts = mockGeminiInvoke.mock.calls.map(([prompt]) => prompt).join('\n');
      expect(prompts).toContain('Najnovija relevantna činjenica iz dokumenta.');
      expect(prompts).toContain('Ključni iznos je 250.000 EUR');
      expect(prompts).not.toContain('A'.repeat(500));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  it('analyzes every chunk in long extracted text', async () => {
    const chunks = Array.from({ length: 8 }, (_, index) => ({
      id: `chunk-${index + 1}`,
      text: `Evidence marker ${index + 1}`,
      metadata: {
        docId: 'test-doc',
        startIndex: index * 1000,
        endIndex: (index + 1) * 1000,
      },
    }));
    mockSplitTextIntoChunks.mockReturnValue(chunks);
    mockGeminiInvoke.mockImplementation(async (prompt) => {
      const match = String(prompt).match(/Evidence marker (\d+)/);
      const index = Number(match?.[1] || 0);
      return {
        content: JSON.stringify({
          caseNumber: 'St-357/2013',
          summary: `Segment ${index}.`,
          amounts: [{
            description: `Amount from segment ${index}`,
            amount: index,
            currency: 'EUR',
            quote: `Quote ${index}`,
          }],
        }),
      };
    });

    const tool = new AnalyzeDocumentsTool();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-agent-all-chunks-'));
    const largeTxtPath = path.join(tmpDir, 'large.txt');
    fs.writeFileSync(largeTxtPath, 'A'.repeat(28000), 'utf8');

    try {
      const result = await tool._call({
        files: [{ filePath: largeTxtPath, text: 'large.txt' }],
        caseInfo: { participants: [] },
      });

      expect(mockGeminiInvoke).toHaveBeenCalledTimes(chunks.length);
      expect(mockGeminiInvoke.mock.calls.map(([prompt]) => prompt).join('\n'))
        .toContain('Evidence marker 8');
      expect(result.individualAnalyses[0].aiResult.amounts.map((item) => item.amount))
        .toEqual(chunks.map((_, index) => index + 1));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  it('keeps successful chunk facts and marks a document partial when another chunk fails', async () => {
    mockSplitTextIntoChunks.mockReturnValue([
      { id: 'success', text: 'Successful evidence', metadata: { startIndex: 0, endIndex: 1200 } },
      { id: 'failed', text: 'Unavailable evidence', metadata: { startIndex: 1000, endIndex: 2200 } },
    ]);
    mockGeminiInvoke
      .mockResolvedValueOnce({
        content: JSON.stringify({
          summary: 'Djelomičan sažetak.',
          amounts: [{ description: 'Potvrđena tražbina', amount: 500, currency: 'EUR', quote: 'grounded quote' }],
        }),
      })
      .mockRejectedValueOnce(new Error('quota unavailable'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-agent-partial-chunk-'));
    const filePath = path.join(tmpDir, 'large.txt');
    fs.writeFileSync(filePath, 'A'.repeat(28000), 'utf8');

    try {
      const result = await new AnalyzeDocumentsTool()._call({
        files: [{ filePath, text: 'large.txt' }],
        caseInfo: { participants: [] },
      });
      const item = result.individualAnalyses[0];

      expect(item.aiResult.amounts).toHaveLength(1);
      expect(item.degraded).toBe(true);
      expect(item.analysisChunks).toEqual(expect.objectContaining({
        total: 2,
        completed: 1,
        failed: 1,
      }));
      expect(result.coverage).toEqual(expect.objectContaining({
        analyzed: 1,
        partial: 1,
        complete: false,
      }));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
  it('deduplicates identical extracted facts repeated only inside chunk overlap', async () => {
    const quote = 'Claim appears in overlap.';
    const sourceText = `${'A'.repeat(3300)}${quote}${'B'.repeat(25000)}`;
    mockSplitTextIntoChunks.mockReturnValue([
      {
        id: 'chunk-before',
        text: `${'A'.repeat(3300)}${quote}`,
        metadata: { startIndex: 0, endIndex: 3325 },
      },
      {
        id: 'chunk-after',
        text: `${quote}${'B'.repeat(3000)}`,
        metadata: { startIndex: 3300, endIndex: 6325 },
      },
    ]);
    mockGeminiInvoke.mockResolvedValue({
      content: JSON.stringify({
        summary: 'Sažetak.',
        amounts: [{
          description: 'Isti iznos',
          amount: 100,
          currency: 'EUR',
          quote,
        }],
      }),
    });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-agent-overlap-'));
    const filePath = path.join(tmpDir, 'large.txt');
    fs.writeFileSync(filePath, sourceText, 'utf8');

    try {
      const result = await new AnalyzeDocumentsTool()._call({
        files: [{ filePath, text: 'large.txt' }],
        caseInfo: { participants: [] },
      });

      expect(result.individualAnalyses[0].aiResult.amounts).toHaveLength(1);
      expect(result.individualAnalyses[0].aiResult.amounts[0].sourceChunkId).toBe('chunk-before');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
