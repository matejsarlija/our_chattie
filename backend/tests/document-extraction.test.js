const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGetDocument = jest.fn();
const mockGeminiInvoke = jest.fn();
const mockCreateCanvas = jest.fn();
const mockWithGeminiTimeout = jest.fn((fn, opts) => fn(opts));

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
    withGeminiTimeout: (...args) => mockWithGeminiTimeout(...args),
}));

jest.mock('../helpers/geminiUsage', () => ({
    trackGeminiInvoke: (_gemini, prompt, _opts) => mockGeminiInvoke(prompt),
}));

const { extractTextFromFile, extractTextViaOCR, resetOcrPageCacheForTests } = require('../court-analysis/agents/analysis-agent');

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
    let ocrCacheDir;

    beforeAll(() => {
        ocrCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-page-store-test-'));
        process.env.OCR_CACHE_DIR = ocrCacheDir;
    });

    afterAll(() => {
        delete process.env.OCR_CACHE_DIR;
        if (ocrCacheDir) fs.rmSync(ocrCacheDir, { recursive: true, force: true });
    });

    beforeEach(() => {
        // Invoke-count assertions elsewhere in this file assume per-test
        // isolation of the shared Gemini mock — and of the module-global
        // page cache, which would otherwise leak OCR text across tests.
        mockGeminiInvoke.mockReset();
        resetOcrPageCacheForTests();
    });

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
        // Batched response covering both capped pages.
        mockGeminiInvoke.mockImplementation(() => Promise.resolve({
            content: '=== STRANICA 1 ===\npage text\n=== STRANICA 2 ===\npage text',
        }));
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 5,
                getPage: jest.fn().mockResolvedValue(mockPage()),
            }),
        });

        const tmpFile = path.join(os.tmpdir(), `ocr-cap-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`);
        fs.writeFileSync(tmpFile, Buffer.from(`fake-${Date.now()}-${Math.random()}`));
        try {
            mockGeminiInvoke.mockClear();
            const result = await extractTextViaOCR(tmpFile, () => {});
            expect(result.pages).toBe(2);
            expect(result.truncated).toBe(true);
            expect(result.error).toBeNull();
            // Both capped pages ride in ONE multimodal batch request.
            expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
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

describe('OCR resilience and cost guards', () => {
    beforeEach(() => {
        // Absolute invoke-count assertions require a clean slate per test.
        mockGeminiInvoke.mockReset();
        mockCreateCanvas.mockReset();
        mockGetDocument.mockReset();
        mockWithGeminiTimeout.mockClear();
        resetOcrPageCacheForTests();
    });

    function mockRenderablePage() {
        return {
            getViewport: jest.fn((opts) => ({ width: 200, height: 100, requestedScale: opts?.scale })),
            render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        };
    }

    function mockCanvas() {
        return {
            width: 200,
            height: 100,
            getContext: jest.fn().mockReturnValue({
                drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
            }),
            toBuffer: jest.fn().mockReturnValue(Buffer.from('fake-jpeg')),
        };
    }

    function setupOcr({ numPages }) {
        mockCreateCanvas.mockImplementation(() => mockCanvas());
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages,
                getPage: jest.fn().mockResolvedValue(mockRenderablePage()),
            }),
        });
    }

    const uniqueTmpPdf = (label) => {
        const tmpFile = path.join(os.tmpdir(), `ocr-guard-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pdf`);
        fs.writeFileSync(tmpFile, Buffer.from(`content-${label}-${Date.now()}-${Math.random()}`));
        return tmpFile;
    };

    it('yields partial text when a later OCR page fails', async () => {
        setupOcr({ numPages: 3 });
        // Call order with batching enabled: the batch attempt fails first
        // (falling back to per-page), then page 1 succeeds and page 2 fails.
        mockGeminiInvoke
            .mockRejectedValueOnce(new Error('Gemini request timed out after 30000ms'))
            .mockResolvedValueOnce({ content: 'page one text' })
            .mockRejectedValueOnce(new Error('Gemini request timed out after 30000ms'));

        const tmpFile = uniqueTmpPdf('partial');
        try {
            const result = await extractTextViaOCR(tmpFile);
            // Page 1 was already paid for — it must survive the page-2 failure.
            expect(result.method).toBe('ocr');
            expect(result.text).toContain('page one text');
            expect(result.pages).toBe(1);
            expect(result.error).toBe('ocr-partial');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('keeps the original empty-result behavior when every page fails', async () => {
        setupOcr({ numPages: 2 });
        mockGeminiInvoke.mockRejectedValue(new Error('Gemini request timed out after 30000ms'));

        const tmpFile = uniqueTmpPdf('first-page-fail');
        try {
            const result = await extractTextViaOCR(tmpFile);
            expect(result.text).toBe('');
            expect(result.pages).toBe(0);
            expect(result.error).toBe('ocr-timeout');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('reuses cached pages on re-analysis without spending new calls', async () => {
        setupOcr({ numPages: 2 });
        mockGeminiInvoke.mockImplementation(() => Promise.resolve({
            content: '=== STRANICA 1 ===\nstable body one\n=== STRANICA 2 ===\nstable body two',
        }));

        const tmpFile = uniqueTmpPdf('cache');
        try {
            const first = await extractTextViaOCR(tmpFile);
            const callsAfterFirst = mockGeminiInvoke.mock.calls.length;
            expect(callsAfterFirst).toBe(1);

            const second = await extractTextViaOCR(tmpFile);

            expect(mockGeminiInvoke.mock.calls.length).toBe(callsAfterFirst);
            expect(second.pages).toBe(2);
            expect(second.error).toBeNull();
            expect(second.text).toContain('stable body one');
            expect(second.text).toContain('stable body two');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('serves pages from the persistent store after a simulated backend restart', async () => {
        setupOcr({ numPages: 2 });
        mockGeminiInvoke.mockImplementation(() => Promise.resolve({
            content: '=== STRANICA 1 ===\npersist body one\n=== STRANICA 2 ===\npersist body two',
        }));

        const tmpFile = uniqueTmpPdf('persist');
        try {
            const first = await extractTextViaOCR(tmpFile);
            const callsAfterFirst = mockGeminiInvoke.mock.calls.length;
            expect(callsAfterFirst).toBe(1);

            // Wiping only the in-memory LRU simulates a backend restart; the
            // disk tier must satisfy every page without new vision spend.
            resetOcrPageCacheForTests();

            const second = await extractTextViaOCR(tmpFile);
            expect(mockGeminiInvoke.mock.calls.length).toBe(callsAfterFirst);
            expect(second.pages).toBe(2);
            expect(second.error).toBeNull();
            expect(second.text).toContain('persist body one');
            expect(second.text).toContain('persist body two');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('attributes batched OCR text by original page number when cache hits leave a non-contiguous pending set', async () => {
        setupOcr({ numPages: 3 });
        let calls = 0;
        mockGeminiInvoke.mockImplementation(() => {
            calls += 1;
            if (calls === 1) {
                // Phase 1: batch attempt fails outright...
                return Promise.reject(new Error('Gemini request timed out after 30000ms'));
            }
            if (calls === 2) return Promise.resolve({ content: 'page one text' });
            if (calls === 3) {
                // ...and the sequential fill dies on page 2, leaving only
                // page 1 in the cache (ocr-partial).
                return Promise.reject(new Error('Gemini request timed out after 30000ms'));
            }
            // Phase 2 re-run: pages 2..3 are pending. The model sees only TWO
            // images, so it can only label them positionally 1..K — extraction
            // must remap those positions back to original page numbers 2..3.
            return Promise.resolve({
                content: '=== STRANICA 1 ===\ntwo body\n=== STRANICA 2 ===\nthree body',
            });
        });

        const tmpFile = uniqueTmpPdf('cache-gap');
        try {
            const first = await extractTextViaOCR(tmpFile);
            expect(first.error).toBe('ocr-partial');
            expect(first.pages).toBe(1);

            const second = await extractTextViaOCR(tmpFile);
            // Exactly ONE vision call in phase 2: the batch must satisfy both
            // pending pages — no sequential refill for page 3.
            expect(mockGeminiInvoke).toHaveBeenCalledTimes(4);
            expect(second.error).toBeNull();
            expect(second.pages).toBe(3);

            const batchMessage = mockGeminiInvoke.mock.calls[3][0][0];
            // Instruction + exactly the two pending page images.
            expect(batchMessage.content).toHaveLength(3);

            const pageTwoAt = second.text.indexOf('two body');
            const pageThreeAt = second.text.indexOf('three body');
            expect(pageTwoAt).toBeGreaterThan(-1);
            expect(pageThreeAt).toBeGreaterThan(pageTwoAt);
            expect(second.text).not.toContain('sequential');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('treats empty batch sections as missing and refills them sequentially instead of caching them', async () => {
        setupOcr({ numPages: 2 });
        mockGeminiInvoke
            .mockImplementationOnce(() => Promise.resolve({
                // Both markers present but with no body text at all.
                content: '=== STRANICA 1 ===\n=== STRANICA 2 ===\n   ',
            }));
        let sequentialCalls = 0;
        mockGeminiInvoke.mockImplementation(() => {
            sequentialCalls += 1;
            return Promise.resolve({ content: sequentialCalls === 1 ? 'refill one' : 'refill two' });
        });

        const tmpFile = uniqueTmpPdf('empty-segments');
        try {
            const result = await extractTextViaOCR(tmpFile);
            // One batch + one sequential call per emptied-out section.
            expect(mockGeminiInvoke).toHaveBeenCalledTimes(3);
            expect(result.error).toBeNull();
            expect(result.pages).toBe(2);
            expect(result.text).toContain('refill one');
            expect(result.text).toContain('refill two');

            // A re-run must be fully served by the cache — only the non-empty
            // refills were ever written to it.
            const callsBefore = mockGeminiInvoke.mock.calls.length;
            const second = await extractTextViaOCR(tmpFile);
            expect(mockGeminiInvoke.mock.calls.length).toBe(callsBefore);
            expect(second.text).toContain('refill one');
            expect(second.text).toContain('refill two');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('reports pages already read when page rendering fails mid-document', async () => {
        setupOcr({ numPages: 2 });
        // Batch attempt fails; sequential page 1 succeeds; rendering page 2
        // explodes inside createCanvas.
        mockGeminiInvoke
            .mockRejectedValueOnce(new Error('Gemini request timed out after 30000ms'))
            .mockResolvedValue({ content: 'page one text' });
        const workingCanvas = mockCanvas();
        mockCreateCanvas
            .mockImplementationOnce(() => workingCanvas)
            .mockImplementationOnce(() => workingCanvas)
            .mockImplementationOnce(() => workingCanvas)
            .mockImplementation(() => {
                throw new Error('render exploded');
            });

        const tmpFile = uniqueTmpPdf('render-fail');
        try {
            const result = await extractTextViaOCR(tmpFile);
            expect(result.method).toBe('ocr');
            // Page 1 was read and must still be reported — not a bare zero.
            expect(result.pages).toBe(1);
            expect(result.text).toContain('page one text');
            expect(result.error).toBe('ocr-partial');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('sends a JPEG payload instead of PNG', async () => {
        setupOcr({ numPages: 1 });
        mockGeminiInvoke.mockResolvedValue({ content: 'ok' });

        const tmpFile = uniqueTmpPdf('jpeg');
        try {
            await extractTextViaOCR(tmpFile);
            const message = mockGeminiInvoke.mock.calls[mockGeminiInvoke.mock.calls.length - 1][0][0];
            expect(message.content[1].image_url.startsWith('data:image/jpeg;base64,')).toBe(true);
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('uses the OCR-specific timeout with its default and env override', async () => {
        setupOcr({ numPages: 1 });
        mockGeminiInvoke.mockResolvedValue({ content: 'ok' });

        const tmpFile = uniqueTmpPdf('timeout-default');
        try {
            await extractTextViaOCR(tmpFile);
            expect(mockWithGeminiTimeout).toHaveBeenLastCalledWith(
                expect.any(Function),
                { timeoutMs: 90000 },
            );
        } finally {
            fs.unlinkSync(tmpFile);
        }

        const previous = process.env.GEMINI_OCR_TIMEOUT_MS;
        process.env.GEMINI_OCR_TIMEOUT_MS = '123456';
        const tmpOverride = uniqueTmpPdf('timeout-override');
        try {
            await extractTextViaOCR(tmpOverride);
            expect(mockWithGeminiTimeout).toHaveBeenLastCalledWith(
                expect.any(Function),
                { timeoutMs: 123456 },
            );
        } finally {
            if (previous === undefined) delete process.env.GEMINI_OCR_TIMEOUT_MS;
            else process.env.GEMINI_OCR_TIMEOUT_MS = previous;
            fs.unlinkSync(tmpOverride);
        }
    });

    it('caps rendered long edge at 2000px for oversized pages', async () => {
        const oversizedPage = {
            getViewport: jest.fn(({ scale }) => {
                // Base page is 1000x3000pt; at scale 1 that exceeds the cap.
                return { width: 1000 * scale, height: 3000 * scale };
            }),
            render: jest.fn().mockReturnValue({ promise: Promise.resolve() }),
        };
        const canvasSpy = mockCanvas();
        canvasSpy.width = 667;
        canvasSpy.height = 2000;
        mockCreateCanvas.mockReturnValue(canvasSpy);
        mockGetDocument.mockReturnValue({
            promise: Promise.resolve({
                numPages: 1,
                getPage: jest.fn().mockResolvedValue(oversizedPage),
            }),
        });
        mockGeminiInvoke.mockResolvedValue({ content: 'big page' });

        const tmpFile = uniqueTmpPdf('long-edge');
        try {
            const result = await extractTextViaOCR(tmpFile);
            expect(result.error).toBeNull();
            // First call measures at scale 1; second renders with capped scale.
            expect(oversizedPage.getViewport).toHaveBeenNthCalledWith(1, { scale: 1 });
            expect(oversizedPage.getViewport).toHaveBeenNthCalledWith(2, { scale: expect.closeTo(2000 / 3000, 5) });
            const [canvasWidth, canvasHeight] = mockCreateCanvas.mock.calls[mockCreateCanvas.mock.calls.length - 1];
            expect(canvasHeight).toBeCloseTo(2000, 5);
            expect(canvasWidth).toBeCloseTo(1000 * (2000 / 3000), 5);
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('reads multiple pages in one batched request when markers are complete', async () => {
        setupOcr({ numPages: 3 });
        mockGeminiInvoke.mockImplementation(() => Promise.resolve({
            content: '=== STRANICA 1 ===\nfirst page body\n=== STRANICA 2 ===\nsecond page body\n=== STRANICA 3 ===\nthird page body',
        }));

        const tmpFile = uniqueTmpPdf('batch-ok');
        try {
            const result = await extractTextViaOCR(tmpFile);
            expect(result.error).toBeNull();
            expect(result.pages).toBe(3);
            expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
            expect(result.text).toContain('first page body');
            expect(result.text).toContain('second page body');
            expect(result.text).toContain('third page body');
            // Marker lines are section boundaries, never page content.
            expect(result.text).not.toContain('=== STRANICA');

            const message = mockGeminiInvoke.mock.calls[0][0][0];
            // Instruction + one image part per pending page.
            expect(message.content).toHaveLength(4);
            expect(message.content[0].text).toContain('=== STRANICA N ===');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });

    it('falls back to per-page OCR only for pages the batch left unmarked', async () => {
        setupOcr({ numPages: 3 });
        mockGeminiInvoke
            .mockImplementationOnce(() => Promise.resolve({
                content: '=== STRANICA 1 ===\nbatch page one\n=== STRANICA 2 ===\nbatch page two',
                // Page 3 marker missing on purpose.
            }))
            .mockResolvedValue({ content: 'sequential page three' });

        const tmpFile = uniqueTmpPdf('batch-partial-markers');
        try {
            const result = await extractTextViaOCR(tmpFile);
            expect(result.error).toBeNull();
            expect(result.pages).toBe(3);
            // One batch request + exactly one sequential fill.
            expect(mockGeminiInvoke).toHaveBeenCalledTimes(2);
            expect(result.text).toContain('batch page one');
            expect(result.text).toContain('batch page two');
            expect(result.text).toContain('sequential page three');
        } finally {
            fs.unlinkSync(tmpFile);
        }
    });
});
