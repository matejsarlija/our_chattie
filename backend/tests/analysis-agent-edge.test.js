const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGeminiInvoke = jest.fn();

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    invoke: mockGeminiInvoke,
  })),
}));

jest.mock('../helpers/geminiRetry', () => ({
  withGeminiRetry: (fn) => fn(),
  withGeminiTimeout: (fn) => fn(),
}));

jest.mock('../helpers/geminiUsage', () => ({
  trackGeminiInvoke: (_gemini, prompt, _opts) => mockGeminiInvoke(prompt),
}));

const mockGetDocument = jest.fn();
jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
  getDocument: (...args) => mockGetDocument(...args),
  GlobalWorkerOptions: { workerSrc: '' },
}));

jest.mock('canvas', () => ({
  createCanvas: jest.fn(() => ({
    width: 200,
    height: 100,
    getContext: jest.fn().mockReturnValue({
      drawImage: jest.fn(),
      fillRect: jest.fn(),
      fillText: jest.fn(),
    }),
    toBuffer: jest.fn().mockReturnValue(Buffer.from('fake')),
  })),
}));

const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');

function mockScannedPdfDoc() {
    return {
        numPages: 1,
        getPage: jest.fn().mockResolvedValue(mockScannedPdfPage()),
        destroy: jest.fn(),
    };
}

function mockScannedPdfPage() {
    return {
        getViewport: jest.fn().mockReturnValue({ width: 200, height: 100 }),
        render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        getTextContent: jest.fn().mockResolvedValue({ items: [] }),
    };
}

describe('AnalyzeDocumentsTool edge/error cases', () => {
    beforeEach(() => {
        mockGeminiInvoke.mockReset();
        mockGeminiInvoke.mockResolvedValue({
            content: JSON.stringify({ caseNumber: 'X', decisionDate: '2025-01-01', summary: 'Mock.', amounts: [] }),
        });
        mockGetDocument.mockReset();
    });

    it('returns error for empty file list', async () => {
        const tool = new AnalyzeDocumentsTool();
        const result = await tool._call({ files: [] });
        expect(Array.isArray(result.individualAnalyses)).toBe(true);
        expect(result.individualAnalyses.length).toBe(0);
    });

    it('handles non-PDF file gracefully', async () => {
        const txtPath = path.resolve(__dirname, 'dummy.txt');
        fs.writeFileSync(txtPath, 'Just some text');
        const tool = new AnalyzeDocumentsTool();
        const files = [{ filePath: txtPath, url: 'mock', text: 'Dummy TXT' }];
        const result = await tool._call({ files });
        expect(result.individualAnalyses[0].aiResult).toBeDefined();
        fs.unlinkSync(txtPath);
    });

    it('reports OCR timeout as the failure reason for scanned PDFs', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-scan-'));
        const pdfPath = path.join(tmpDir, 'scanned.pdf');
        fs.writeFileSync(pdfPath, Buffer.from('fake-pdf'));

        mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockScannedPdfDoc()) });
        mockGeminiInvoke.mockRejectedValue(new Error('Gemini request timed out after 30000ms'));

        try {
            const tool = new AnalyzeDocumentsTool();
            const result = await tool._call({
                files: [{ filePath: pdfPath, url: 'mock', text: 'Scanned PDF' }],
                caseInfo: { participants: [] },
            });
            expect(result.individualAnalyses[0].aiResult).toBeNull();
            expect(result.individualAnalyses[0].error).toContain('Could not extract text from file');
            expect(result.individualAnalyses[0].error).toContain('OCR timed out');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('reports parse failure when the PDF cannot be parsed at all', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-corrupt-'));
        const pdfPath = path.join(tmpDir, 'corrupt.pdf');
        fs.writeFileSync(pdfPath, Buffer.from('not-a-real-pdf'));

        mockGetDocument.mockReturnValue({
            promise: Promise.reject(new Error('Invalid PDF structure')),
        });

        try {
            const tool = new AnalyzeDocumentsTool();
            const result = await tool._call({
                files: [{ filePath: pdfPath, url: 'mock', text: 'Corrupt PDF' }],
                caseInfo: { participants: [] },
            });
            expect(result.individualAnalyses[0].aiResult).toBeNull();
            expect(result.individualAnalyses[0].error).toContain('Could not extract text from file');
            expect(result.individualAnalyses[0].error).toContain('could not be parsed');
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('falls back to OCR and succeeds when the text layer is empty', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-ocr-ok-'));
        const pdfPath = path.join(tmpDir, 'scanned-ok.pdf');
        fs.writeFileSync(pdfPath, Buffer.from('fake-pdf'));

        mockGetDocument.mockReturnValue({ promise: Promise.resolve(mockScannedPdfDoc()) });

        try {
            const tool = new AnalyzeDocumentsTool();
            const result = await tool._call({
                files: [{ filePath: pdfPath, url: 'mock', text: 'OCR-rescued PDF' }],
                caseInfo: { participants: [] },
            });
            expect(result.individualAnalyses[0].aiResult).toBeDefined();
            expect(result.individualAnalyses[0].aiResult.summary).toBe('Mock.');
            expect(mockGeminiInvoke).toHaveBeenCalled();
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});
