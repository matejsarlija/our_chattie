const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGetDocument = jest.fn();
const mockGeminiInvoke = jest.fn();
const mockCreateCanvas = jest.fn();

jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
    getDocument: (...args) => mockGetDocument(...args),
    GlobalWorkerOptions: { workerSrc: '' },
}));

jest.mock('canvas', () => ({
    createCanvas: (...args) => mockCreateCanvas(...args),
}));

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

const { extractTextFromFile, extractTextViaOCR } = require('../court-analysis/agents/analysis-agent');

describe('extractTextFromFile', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extraction-test-'));
    const testDocxPath = path.join(tmpDir, 'test.docx');
    const testTxtPath = path.join(tmpDir, 'test.txt');
    const testPdfPath = path.join(tmpDir, 'test.pdf');
    const testDocPath = path.join(tmpDir, 'test.doc');
    const testText = 'Test content for extraction';

    beforeAll(async () => {
        const { Document, Packer, Paragraph, TextRun } = require('docx');
        const docx = new Document({
            sections: [{
                properties: {},
                children: [new Paragraph({ children: [new TextRun(testText)] })],
            }],
        });
        await Packer.toBuffer(docx).then((buf) => fs.writeFileSync(testDocxPath, buf));
        fs.writeFileSync(testTxtPath, testText, 'utf8');
        fs.writeFileSync(testPdfPath, Buffer.from('fake-pdf'));
        fs.writeFileSync(testDocPath, Buffer.from('fake-doc'));
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('extracts multi-page text from PDF via pdfjs-dist getTextContent', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 2,
                getPage: jest.fn()
                    .mockResolvedValueOnce({
                        getTextContent: jest.fn().mockResolvedValue({
                            items: [
                                { str: 'Page 1 title' },
                                { str: 'Page 1 body text' },
                            ],
                        }),
                    })
                    .mockResolvedValueOnce({
                        getTextContent: jest.fn().mockResolvedValue({
                            items: [{ str: 'Page 2 continuation' }],
                        }),
                    }),
                destroy: jest.fn(),
            }),
        });

        const result = await extractTextFromFile(testPdfPath);
        expect(result.text).toContain('Page 1 title');
        expect(result.text).toContain('Page 1 body text');
        expect(result.text).toContain('Page 2 continuation');
        expect(result.method).toBe('pdf-text');
        expect(result.pages).toBe(2);
        expect(result.truncated).toBe(false);
        expect(result.error).toBeNull();
        expect(mockGetDocument).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.any(Uint8Array),
                standardFontDataUrl: expect.stringContaining('standard_fonts'),
            }),
        );
    });

    it('extracts text from DOCX via mammoth', async () => {
        const result = await extractTextFromFile(testDocxPath);
        expect(result.text).toContain('Test content for extraction');
        expect(result.method).toBe('docx');
        expect(result.error).toBeNull();
    });

    it('extracts text from TXT', async () => {
        const result = await extractTextFromFile(testTxtPath);
        expect(result.text).toBe(testText);
        expect(result.method).toBe('txt');
        expect(result.error).toBeNull();
    });

    it('returns unsupported-type error for unknown extension', async () => {
        const unknownPath = path.join(tmpDir, 'unknown.xyz');
        fs.writeFileSync(unknownPath, 'binary-ish');
        const result = await extractTextFromFile(unknownPath);
        expect(result.text).toBe('');
        expect(result.method).toBeNull();
        expect(result.error).toBe('unsupported-type');
    });

    it('returns file-not-found error for non-existent file', async () => {
        const result = await extractTextFromFile('/tmp/does-not-exist.pdf');
        expect(result.text).toBe('');
        expect(result.error).toBe('file-not-found');
    });

    it('routes .doc to word-extractor', async () => {
        const WordExtractor = require('word-extractor');
        const origExtract = WordExtractor.prototype.extract;
        WordExtractor.prototype.extract = jest.fn().mockResolvedValue({
            getBody: () => 'DOC extracted text',
        });
        try {
            const result = await extractTextFromFile(testDocPath);
            expect(result.text).toBe('DOC extracted text');
            expect(result.method).toBe('doc');
            expect(result.error).toBeNull();
        } finally {
            WordExtractor.prototype.extract = origExtract;
        }
    });

    it('returns pdf-parse-failed when pdfjs throws', async () => {
        mockGetDocument.mockReturnValue({
            promise: Promise.reject(new Error('Invalid PDF structure')),
        });
        const result = await extractTextFromFile(testPdfPath);
        expect(result.text).toBe('');
        expect(result.method).toBeNull();
        expect(result.error).toBe('pdf-parse-failed');
    });
});

describe('extractTextViaOCR', () => {
    function mockPage() {
        return {
            getViewport: jest.fn().mockReturnValue({ width: 200, height: 100 }),
            render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        };
    }

    it('invokes Gemini with base64-encoded image and returns text', async () => {
        const fakeCanvas = {
            width: 200, height: 100,
            getContext: jest.fn().mockReturnValue({
                drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
            }),
            toBuffer: jest.fn().mockReturnValue(Buffer.from('fake-png')),
        };
        mockCreateCanvas.mockReturnValue(fakeCanvas);
        mockGeminiInvoke.mockResolvedValue({ content: 'OCR result text' });
        const page = mockPage();
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(page),
            }),
        });

        const tmpFile = path.join(os.tmpdir(), 'ocr-test.pdf');
        fs.writeFileSync(tmpFile, Buffer.from('fake-pdf'));
        try {
            const progressEvents = [];
            const result = await extractTextViaOCR(tmpFile, (event) => progressEvents.push(event));
            expect(result.text.trim()).toBe('OCR result text');
            expect(result.method).toBe('ocr');
            expect(result.pages).toBe(1);
            expect(result.truncated).toBe(false);
            expect(result.error).toBeNull();
            expect(mockCreateCanvas).toHaveBeenCalled();
            expect(page.render).toHaveBeenCalled();
            expect(mockGetDocument).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.any(Uint8Array),
                    standardFontDataUrl: expect.stringContaining('standard_fonts'),
                }),
            );
            const pageEvents = progressEvents.filter((event) => String(event.message || '').includes('OCR:'));
            expect(pageEvents.length).toBe(1);
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('returns ocr-timeout error code when Gemini times out', async () => {
        mockCreateCanvas.mockReturnValue({
            width: 200, height: 100,
            getContext: jest.fn().mockReturnValue({
                drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
            }),
            toBuffer: jest.fn().mockReturnValue(Buffer.from('fake')),
        });
        mockGeminiInvoke.mockRejectedValue(new Error('Gemini request timed out after 30000ms'));
        const page = mockPage();
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(page),
            }),
        });

        const tmpFile = path.join(os.tmpdir(), 'ocr-timeout.pdf');
        fs.writeFileSync(tmpFile, Buffer.from('fake'));
        try {
            const result = await extractTextViaOCR(tmpFile, () => {});
            expect(result.text).toBe('');
            expect(result.method).toBe('ocr');
            expect(result.error).toBe('ocr-timeout');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('returns ocr-failed error code when Gemini throws a non-timeout error', async () => {
        mockCreateCanvas.mockReturnValue({
            width: 200, height: 100,
            getContext: jest.fn().mockReturnValue({
                drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
            }),
            toBuffer: jest.fn().mockReturnValue(Buffer.from('fake')),
        });
        mockGeminiInvoke.mockRejectedValue(new Error('Gemini error'));
        const page = mockPage();
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(page),
            }),
        });

        const tmpFile = path.join(os.tmpdir(), 'ocr-fail.pdf');
        fs.writeFileSync(tmpFile, Buffer.from('fake'));
        try {
            const result = await extractTextViaOCR(tmpFile, () => {});
            expect(result.text).toBe('');
            expect(result.error).toBe('ocr-failed');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('stops at OCR_MAX_PAGES and reports truncated', async () => {
        const originalMaxPages = process.env.OCR_MAX_PAGES;
        process.env.OCR_MAX_PAGES = '2';
        mockCreateCanvas.mockReturnValue({
            width: 200, height: 100,
            getContext: jest.fn().mockReturnValue({
                drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
            }),
            toBuffer: jest.fn().mockReturnValue(Buffer.from('fake')),
        });
        mockGeminiInvoke.mockResolvedValue({ content: 'page text' });
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 5,
                getPage: jest.fn().mockResolvedValue(mockPage()),
            }),
        });

        const tmpFile = path.join(os.tmpdir(), 'ocr-cap.pdf');
        fs.writeFileSync(tmpFile, Buffer.from('fake'));
        try {
            mockGeminiInvoke.mockClear();
            const result = await extractTextViaOCR(tmpFile, () => {});
            expect(result.pages).toBe(2);
            expect(result.truncated).toBe(true);
            expect(result.error).toBeNull();
            expect(mockGeminiInvoke).toHaveBeenCalledTimes(2);
        } finally {
            if (originalMaxPages === undefined) {
                delete process.env.OCR_MAX_PAGES;
            } else {
                process.env.OCR_MAX_PAGES = originalMaxPages;
            }
            fs.unlinkSync(tmpFile);
        }
    });
});
