'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { createSqliteStore } = require('../services/sqliteStore');
const {
    selectOcrPages,
    transcribeDocumentViaStageT,
    resetOcrPageCacheForTests,
    GEMMA_RASTER_MODEL,
} = require('../court-analysis/extraction/ocrRouter');

async function createBlankPdfBuffer(pageCount) {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pageCount; i += 1) {
        doc.addPage([200, 300]);
    }
    return Buffer.from(await doc.save());
}

describe('Stage T ocrRouter', () => {
    let tmpDir;
    let sqliteStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-router-'));
        sqliteStore = createSqliteStore({ dataDir: path.join(tmpDir, 'db') });
        resetOcrPageCacheForTests();
    });

    afterEach(() => {
        sqliteStore?.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('transcribes a 36-page scan in 15+15+6 page windows and merges pages 1..36 in order', async () => {
        const pdfPath = path.join(tmpDir, 'scan36.pdf');
        fs.writeFileSync(pdfPath, await createBlankPdfBuffer(36));

        const windowLengths = [];
        const mistralOcr = jest.fn(async (messages) => {
            const dataUrl = messages[0].content.find((p) => p.type === 'file').file.file_data;
            const b64 = dataUrl.replace(/^data:application\/pdf;base64,/, '');
            const subPdf = await PDFDocument.load(Buffer.from(b64, 'base64'));
            const count = subPdf.getPageCount();
            windowLengths.push(count);
            const offset = windowLengths.slice(0, -1).reduce((a, b) => a + b, 0);
            const parts = Array.from({ length: count }, (_, idx) => ({
                type: 'text',
                text: `Mistral stranica ${offset + idx + 1}`,
            }));
            return {
                content: '',
                annotations: [{ file: { content: parts } }],
            };
        });

        const preflightDoc = {
            filePath: pdfPath,
            fileName: 'scan36.pdf',
            docClass: 'scanned_full',
            pageCount: 36,
            ocrPages: Array.from({ length: 36 }, (_, idx) => idx + 1),
            pageAnalyses: [],
        };

        const progressEvents = [];
        const result = await transcribeDocumentViaStageT({
            preflightDoc,
            sqliteStore,
            progressCallback: (ev) => progressEvents.push(ev),
            clients: { mistralOcr },
        });

        expect(windowLengths).toEqual([15, 15, 6]);
        expect(mistralOcr).toHaveBeenCalledTimes(3);
        expect(result.error).toBeNull();
        expect(result.ocrEngine).toBe('mistral-ocr');
        expect(result.pages).toBe(36);
        expect(result.truncated).toBe(false);
        expect(result.skippedPageRanges).toEqual([]);
        expect(result.text.indexOf('Mistral stranica 1')).toBeLessThan(result.text.indexOf('Mistral stranica 16'));
        expect(result.text.indexOf('Mistral stranica 16')).toBeLessThan(result.text.indexOf('Mistral stranica 36'));

        const ocrCounters = progressEvents.filter((ev) => ev?.metadata?.stage === 'ocr');
        expect(ocrCounters.at(-1).metadata).toMatchObject({ pagesDone: 36, pagesTotal: 36 });

        // Warm rerun hits SQLite ocr_transcripts at $0
        const warm = await transcribeDocumentViaStageT({ preflightDoc, sqliteStore, clients: { mistralOcr } });
        expect(mistralOcr).toHaveBeenCalledTimes(3);
        expect(warm.fromCache).toBe(true);
        expect(warm.text).toBe(result.text);
    });

    test('caps 80-page scan at 60 pages (40 head + 20 tail) and records skippedPageRanges', async () => {
        const all80 = Array.from({ length: 80 }, (_, idx) => idx + 1);
        const selection = selectOcrPages(all80, 60);
        expect(selection.truncated).toBe(true);
        expect(selection.selectedPages).toHaveLength(60);
        expect(selection.selectedPages.slice(0, 40)).toEqual(all80.slice(0, 40));
        expect(selection.selectedPages.slice(40)).toEqual(all80.slice(60, 80));
        expect(selection.skippedPageRanges).toEqual([{ from: 41, to: 60 }]);

        const pdfPath = path.join(tmpDir, 'scan80.pdf');
        fs.writeFileSync(pdfPath, await createBlankPdfBuffer(80));
        const mistralOcr = jest.fn(async (messages) => {
            const dataUrl = messages[0].content.find((p) => p.type === 'file').file.file_data;
            const subPdf = await PDFDocument.load(Buffer.from(dataUrl.replace(/^data:application\/pdf;base64,/, ''), 'base64'));
            const count = subPdf.getPageCount();
            return {
                content: Array.from({ length: count }, (_, idx) => `=== STRANICA ${idx + 1} ===\nOk text`).join('\n'),
            };
        });

        const result = await transcribeDocumentViaStageT({
            preflightDoc: {
                filePath: pdfPath,
                fileName: 'scan80.pdf',
                docClass: 'scanned_full',
                pageCount: 80,
                ocrPages: all80,
                pageAnalyses: [],
            },
            sqliteStore,
            clients: { mistralOcr },
        });

        expect(result.pages).toBe(60);
        expect(result.truncated).toBe(true);
        expect(result.skippedPageRanges).toEqual([{ from: 41, to: 60 }]);
        expect(result.reasonCode).toBe('ocr-page-cap');
    });

    test('merges hybrid_mixed digital pages 1-3 with OCR pages 4-12 in exact 1..12 order', async () => {
        const pdfPath = path.join(tmpDir, 'hybrid12.pdf');
        fs.writeFileSync(pdfPath, await createBlankPdfBuffer(12));

        const sentOcrPages = [];
        const mistralOcr = jest.fn(async (messages) => {
            const dataUrl = messages[0].content.find((p) => p.type === 'file').file.file_data;
            const subPdf = await PDFDocument.load(Buffer.from(dataUrl.replace(/^data:application\/pdf;base64,/, ''), 'base64'));
            const count = subPdf.getPageCount();
            sentOcrPages.push(count);
            return {
                content: Array.from({ length: count }, (_, idx) => `=== STRANICA ${idx + 1} ===\nOCR str ${idx + 4}`).join('\n'),
            };
        });

        const preflightDoc = {
            filePath: pdfPath,
            fileName: 'hybrid12.pdf',
            docClass: 'hybrid_mixed',
            pageCount: 12,
            digitalPages: [1, 2, 3],
            ocrPages: [4, 5, 6, 7, 8, 9, 10, 11, 12],
            pageAnalyses: [
                { pageNumber: 1, hasUsableText: true, text: 'Digital str 1' },
                { pageNumber: 2, hasUsableText: true, text: 'Digital str 2' },
                { pageNumber: 3, hasUsableText: true, text: 'Digital str 3' },
            ],
        };

        const result = await transcribeDocumentViaStageT({
            preflightDoc,
            sqliteStore,
            clients: { mistralOcr },
        });

        expect(sentOcrPages).toEqual([9]);
        expect(result.method).toBe('hybrid');
        expect(result.pages).toBe(12);
        expect(result.text.indexOf('Digital str 1')).toBeLessThan(result.text.indexOf('Digital str 3'));
        expect(result.text.indexOf('Digital str 3')).toBeLessThan(result.text.indexOf('OCR str 4'));
        expect(result.text.indexOf('OCR str 4')).toBeLessThan(result.text.indexOf('OCR str 12'));
    });

    test('falls back to google/gemma-4-31b-it raster when Mistral fails and Gemini hits RECITATION', async () => {
        const pdfPath = path.join(tmpDir, 'fallback.pdf');
        fs.writeFileSync(pdfPath, await createBlankPdfBuffer(2));

        const mistralOcr = jest.fn().mockRejectedValue(new Error('Mistral 503 unavailable'));
        const gemmaRaster = jest.fn().mockResolvedValue({
            content: '=== STRANICA 1 ===\nGemma tekst 1\n=== STRANICA 2 ===\nGemma tekst 2',
            response_metadata: { model: GEMMA_RASTER_MODEL, finish_reason: 'stop' },
        });
        const mockWorkerPool = {
            run: jest.fn(async (_type, payload) => payload.pageNumbers.map((pageNumber) => ({
                pageNumber,
                buffer: Buffer.from(`jpeg-${pageNumber}`),
            }))),
        };

        const result = await transcribeDocumentViaStageT({
            preflightDoc: {
                filePath: pdfPath,
                fileName: 'fallback.pdf',
                docClass: 'scanned_full',
                pageCount: 2,
                ocrPages: [1, 2],
                pageAnalyses: [],
            },
            sqliteStore,
            workerPool: mockWorkerPool,
            clients: { mistralOcr, gemmaRaster },
        });

        expect(mistralOcr).toHaveBeenCalledTimes(1);
        expect(gemmaRaster).toHaveBeenCalledTimes(1);
        expect(result.ocrEngine).toBe('gemma-raster');
        expect(result.text).toContain('Gemma tekst 1');
        expect(result.text).toContain('Gemma tekst 2');

        // Verify Gemini escalation works when Gemma hits RECITATION
        resetOcrPageCacheForTests();
        const freshPath = path.join(tmpDir, 'fallback-gemini.pdf');
        fs.writeFileSync(freshPath, await createBlankPdfBuffer(1));
        const gemmaBlocked = jest.fn().mockResolvedValue({
            content: '',
            response_metadata: { finish_reason: 'recitation' },
        });
        const geminiRaster = jest.fn().mockResolvedValue({
            content: 'Gemini rescued page',
            response_metadata: { finish_reason: 'stop' },
        });

        const escalated = await transcribeDocumentViaStageT({
            preflightDoc: {
                filePath: freshPath,
                fileName: 'fallback-gemini.pdf',
                docClass: 'scanned_full',
                pageCount: 1,
                ocrPages: [1],
                pageAnalyses: [],
            },
            sqliteStore,
            workerPool: mockWorkerPool,
            clients: { mistralOcr, gemmaRaster: gemmaBlocked, geminiRaster },
        });

        expect(escalated.ocrEngine).toBe('gemini-raster');
        expect(escalated.text).toContain('Gemini rescued page');
    });

    test('determines page count automatically without preflightDoc and honors OCR_HARD_MAX_PAGES', async () => {
        const pdfPath = path.join(tmpDir, 'nopreflight.pdf');
        fs.writeFileSync(pdfPath, await createBlankPdfBuffer(4));
        const previousHardMax = process.env.OCR_HARD_MAX_PAGES;
        process.env.OCR_HARD_MAX_PAGES = '2';
        const mistralOcr = jest.fn();
        try {
            const rejected = await transcribeDocumentViaStageT({
                filePath: pdfPath,
                sqliteStore,
                clients: { mistralOcr },
            });
            expect(rejected.error).toBe('pdf-page-limit-exceeded');
            expect(mistralOcr).not.toHaveBeenCalled();
        } finally {
            if (previousHardMax === undefined) delete process.env.OCR_HARD_MAX_PAGES;
            else process.env.OCR_HARD_MAX_PAGES = previousHardMax;
        }
    });
});
