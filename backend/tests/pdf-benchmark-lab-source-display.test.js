'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute, extractTranscriptProvider } = require('../scripts/benchmark-pdf-engines');
const { enrichReportWithTranscriptSources } = require('../bench/corpus');

test('Stage A execute preserves transcriptSourceArm and transcriptProvider on report rows', async () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-a-provenance-'));
    const mkDoc = (docId, sourceArm, provider) => ({
        docId,
        title: docId,
        pages: 1,
        textLayer: sourceArm === 'local-text',
        canonicalTranscript: {
            sourceArm,
            text: `Kratki tekst dokumenta ${docId}. `.repeat(8),
            verified: true,
        },
        parserRuns: provider ? { [sourceArm]: { provider } } : {},
    });
    const docs = [
        mkDoc('1:text.pdf', 'local-text', 'local-pdfjs'),
        mkDoc('374:scan.pdf', 'or-mistral-ocr', 'Mistral'),
        mkDoc('372:raster.pdf', 'local-raster', ['Google AI Studio']),
    ];

    try {
        const dry = await execute({
            args: { 'analysis-mode': 'single' },
            documents: docs,
            models: ['z-ai/glm-5.3-flash'],
            capabilitiesByModel: { 'z-ai/glm-5.3-flash': { fileNative: false, imageInput: false } },
            outputDir: outDir,
            dryRun: true,
            registry: { 'local-text': jest.fn() },
        });
        expect(dry.rows.map((r) => ({
            docId: r.docId, arm: r.arm, transcriptSourceArm: r.transcriptSourceArm, transcriptProvider: r.transcriptProvider,
        }))).toEqual([
            { docId: '1:text.pdf', arm: 'local-text', transcriptSourceArm: 'local-text', transcriptProvider: 'pdfjs' },
            { docId: '374:scan.pdf', arm: 'local-text', transcriptSourceArm: 'or-mistral-ocr', transcriptProvider: 'Mistral' },
            { docId: '372:raster.pdf', arm: 'local-text', transcriptSourceArm: 'local-raster', transcriptProvider: 'Google AI Studio' },
        ]);
    } finally {
        fs.rmSync(outDir, { recursive: true, force: true });
    }
});

test('enrichReportWithTranscriptSources backfills historical Stage A reports without clobbering existing fields', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-enrich-'));
    const txDir = path.join(dataRoot, 'fixtures', 'transcripts');
    fs.mkdirSync(txDir, { recursive: true });
    fs.writeFileSync(path.join(txDir, '374:scan.pdf.json'), JSON.stringify({
        canonicalTranscript: { sourceArm: 'or-mistral-ocr', text: 'abc' },
        parserRuns: { 'or-mistral-ocr': { provider: 'Mistral' } },
    }));
    fs.writeFileSync(path.join(txDir, '40:raster.pdf.json'), JSON.stringify({
        canonicalTranscript: { sourceArm: 'local-raster', text: 'abc' },
        parserRuns: { 'local-raster': { provider: ['Google AI Studio'] } },
    }));
    fs.writeFileSync(path.join(txDir, '1:digital.pdf.json'), JSON.stringify({
        canonicalTranscript: { sourceArm: 'local-text', text: 'abc' },
    }));

    const historicalReport = {
        runId: '2026-11-21T14-32-13-795Z-d285ea3f',
        rows: [
            { docId: '374:scan.pdf', arm: 'local-text', stage: 'A', model: 'z-ai/glm-5.3-flash' },
            { docId: '40:raster.pdf', arm: 'local-text', stage: 'A', model: 'google/gemini-2.5-flash' },
            { docId: '1:digital.pdf', arm: 'local-text', stage: 'A', model: 'z-ai/glm-5.3-flash' },
            { docId: '374:scan.pdf', arm: 'local-text', stage: 'A', transcriptSourceArm: 'local-raster', transcriptProvider: 'Wafer' },
            { docId: '999:missing.pdf', arm: 'or-cloudflare', stage: 'T', model: 'z-ai/glm-5.3-flash' },
        ],
    };

    try {
        const enriched = enrichReportWithTranscriptSources(historicalReport, dataRoot);
        expect(enriched.rows[0]).toMatchObject({ transcriptSourceArm: 'or-mistral-ocr', transcriptProvider: 'Mistral' });
        expect(enriched.rows[1]).toMatchObject({ transcriptSourceArm: 'local-raster', transcriptProvider: 'Google AI Studio' });
        expect(enriched.rows[2]).toMatchObject({ transcriptSourceArm: 'local-text', transcriptProvider: 'pdfjs' });
        expect(enriched.rows[3]).toMatchObject({ transcriptSourceArm: 'local-raster', transcriptProvider: 'Wafer' });
        expect(enriched.rows[4].transcriptSourceArm).toBeUndefined();
        expect(extractTranscriptProvider({}, 'local-text')).toBe('pdfjs');
    } finally {
        fs.rmSync(dataRoot, { recursive: true, force: true });
    }
});
