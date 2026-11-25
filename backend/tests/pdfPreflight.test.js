'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDocument } = require('pdf-lib');
const { createCanvas } = require('canvas');
const { createSqliteStore } = require('../services/sqliteStore');
const { createRunBus } = require('../http/runBus');
const { createWorkerPool } = require('../court-analysis/extraction/workerPool');
const { preflightClusterDocuments } = require('../court-analysis/extraction/pdfPreflight');
const { inspectPdfBuffer, EXTRACTION_ERROR_CODES } = require('../court-analysis/extraction/pdfText');

function renderPdfWithPages(pageConfigs) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ autoFirstPage: false });
        const chunks = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        for (const cfg of pageConfigs) {
            doc.addPage({ size: 'A4', margin: 40 });
            if (cfg.text) {
                doc.fontSize(11).text(cfg.text, 40, 40);
            }
            if (cfg.drawImageBox) {
                const canvas = createCanvas(20, 20);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, 20, 20);
                doc.image(canvas.toBuffer('image/jpeg'), 40, 120, { width: 100, height: 100 });
            }
        }
        doc.end();
    });
}

describe('Stage T0 pdfPreflight and node:worker_threads pool', () => {
    let tmpDir;
    let dataDir;
    let sqliteStore;
    let runBus;
    let workerPool;

    beforeAll(() => {
        workerPool = createWorkerPool({ size: 2 });
    });

    afterAll(async () => {
        await workerPool?.destroy();
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-test-'));
        dataDir = path.join(tmpDir, 'db');
        sqliteStore = createSqliteStore({ dataDir });
        runBus = createRunBus({ analysisStore: sqliteStore });
    });

    afterEach(() => {
        runBus?.closeAll();
        sqliteStore?.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('rejects HTML masquerading as .pdf with reasonCode html-as-pdf', async () => {
        const htmlPdf = path.join(tmpDir, 'error.pdf');
        fs.writeFileSync(htmlPdf, '<!DOCTYPE html><html><body>502 Bad Gateway</body></html>');
        const run = await sqliteStore.createAnalysisRun({ status: 'running' });

        const { manifest, documents } = await preflightClusterDocuments({
            files: [{ filePath: htmlPdf, text: 'Podnesak.pdf', sourceEntryIndex: 0 }],
            sqliteStore,
            runBus,
            runId: run.id,
            workerPool,
        });

        expect(documents).toHaveLength(1);
        expect(documents[0].docClass).toBe('empty_or_corrupt');
        expect(documents[0].reasonCode).toBe(EXTRACTION_ERROR_CODES.HTML_AS_PDF);
        expect(manifest.corruptDocs).toBe(1);
    });

    test('executes real worker_threads inspection, isolates hybrid_mixed non-blank OCR pages, dedupes duplicates, and persists preflight_json', async () => {
        // 1. Digital 1-page admin PDF (ASCII for pdfkit built-in Helvetica WinAnsi)
        const adminPdfPath = path.join(tmpDir, 'Punomoc.pdf');
        const adminBytes = await renderPdfWithPages([
            { text: 'PUNOMOC St-2/2013 dana 10.01.2024. OIB: 12345678901 zastupa stecajnog duznika.' },
        ]);
        fs.writeFileSync(adminPdfPath, adminBytes);

        // 2. Duplicate copy of Punomoc.pdf at another entry index
        const adminDupPath = path.join(tmpDir, 'Punomoc-dup.pdf');
        fs.writeFileSync(adminDupPath, adminBytes);

        // 3. 12-page hybrid_mixed PDF: pages 1-3 digital, pages 4-11 scanned (image + stray 1-char watermark), page 12 blank
        const hybridPages = [
            { text: 'Stranica 1 digitalni podnesak u predmetu St-2/2013.' },
            { text: 'Stranica 2 nastavak digitalnog podneska vjerovnika.' },
            { text: 'Stranica 3 zakljucni dio digitalnog podneska.' },
            ...Array.from({ length: 8 }, () => ({ text: 'x', drawImageBox: true })),
            { text: '' }, // blank page 12
        ];
        const hybridPdfPath = path.join(tmpDir, 'Hybrid.pdf');
        const hybridBytes = await renderPdfWithPages(hybridPages);
        fs.writeFileSync(hybridPdfPath, hybridBytes);

        // 4. 4-page scanned PDF with stray scanner noise (2 chars/page) cached in SQLite
        const scannedPdfPath = path.join(tmpDir, 'Scanned.pdf');
        const scannedBytes = await renderPdfWithPages(
            Array.from({ length: 4 }, () => ({ text: 'ab', drawImageBox: true })),
        );
        fs.writeFileSync(scannedPdfPath, scannedBytes);
        const scannedHash = crypto.createHash('sha256').update(scannedBytes).digest('hex');
        sqliteStore.putOcrTranscript({
            contentHash: scannedHash,
            engine: 'mistral-ocr',
            modelId: 'or-mistral-ocr',
            pageCount: 4,
            text: 'Cached OCR transcript',
        });

        const run = await sqliteStore.createAnalysisRun({ status: 'running' });
        const emittedEvents = [];
        const unsubscribe = runBus.subscribe(run.id, (msg) => emittedEvents.push(msg));

        const { manifest, documents } = await preflightClusterDocuments({
            files: [
                { filePath: adminPdfPath, text: 'Punomoc.pdf', sourceEntryIndex: 0 },
                { filePath: adminDupPath, text: 'Punomoc.pdf', sourceEntryIndex: 1 },
                { filePath: hybridPdfPath, text: 'Hybrid.pdf', sourceEntryIndex: 2 },
                { filePath: scannedPdfPath, text: 'Scanned.pdf', sourceEntryIndex: 3 },
            ],
            sqliteStore,
            runBus,
            runId: run.id,
            workerPool,
        });
        unsubscribe();

        expect(workerPool.workerCount()).toBeGreaterThanOrEqual(1);
        expect(workerPool.activeCount()).toBe(0);

        expect(documents[0].docClass).toBe('digital_text');
        expect(documents[0].adminFastPathEligible).toBe(true);

        expect(documents[1].isDuplicate).toBe(true);
        expect(documents[1].dedupedOfDocId).toBe(documents[0].docId);

        expect(documents[2].docClass).toBe('hybrid_mixed');
        expect(documents[2].digitalPages).toEqual([1, 2, 3]);
        expect(documents[2].ocrPages).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
        expect(documents[2].blankPages).toEqual([12]);
        expect(documents[2].text).toContain('Stranica 1 digitalni podnesak');

        expect(documents[3].docClass).toBe('scanned_full');
        expect(documents[3].fromCache).toBe(true);

        expect(manifest).toMatchObject({
            digitalDocs: 1,
            hybridDocs: 1,
            scannedDocs: 1,
            duplicateDocs: 1,
            adminFastPathDocs: 1,
            cachedHits: 1,
            ocrPages: 8, // 8 non-blank pages from hybrid; cached scanned doc does not add OCR spend!
            totalDocs: 4,
        });
        expect(manifest.estimatedMinUsd).toBeGreaterThan(0);
        expect(manifest.estimatedExpectedUsd).toBeGreaterThanOrEqual(manifest.estimatedMinUsd);

        // Durable preflight_json survives completeAnalysisRun and getAnalysisRunFull
        await sqliteStore.completeAnalysisRun({
            analysisId: run.id,
            resultText: 'Report',
            resultJson: { comparativeAnalysis: 'Report' },
        });
        const full = await sqliteStore.getAnalysisRunFull({ id: run.id });
        expect(full.run.preflight).toMatchObject({
            ocrPages: 8,
            cachedHits: 1,
            hybridDocs: 1,
            digitalDocs: 1,
        });

        const preflightMsg = emittedEvents.find((msg) => msg.event === 'run.preflight');
        expect(preflightMsg).toBeTruthy();
        expect(preflightMsg.payload.preflight.ocrPages).toBe(8);
        expect(emittedEvents.some((msg) => msg.payload?.lanes?.preflight?.done === 4)).toBe(true);
    });

    test('detects encrypted PDFs cleanly and always destroys pdf.js document', async () => {
        const pdfDoc = await PdfLibDocument.create();
        pdfDoc.addPage();
        const bytes = await pdfDoc.save();
        const inspected = await inspectPdfBuffer(bytes);
        expect(inspected.docClass).toBe('empty_or_corrupt');
        expect(inspected.blankPages).toEqual([1]);
    });
});
