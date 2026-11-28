'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execute, extractTranscriptProvider } = require('../scripts/benchmark-pdf-engines');
const { enrichReportWithTranscriptSources } = require('../bench/corpus');

function extractLabUiHelpers() {
    const html = fs.readFileSync(path.resolve(__dirname, '../scripts/pdf-bench-lab.html'), 'utf8');
    const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(html);
    if (!scriptMatch) throw new Error('Could not locate inline <script> in pdf-bench-lab.html');
    const script = scriptMatch[1];

    const sliceBetween = (startNeedle, endNeedle) => {
        const start = script.indexOf(startNeedle);
        const end = script.indexOf(endNeedle, start);
        if (start < 0 || end < 0) throw new Error(`Could not slice between ${startNeedle} and ${endNeedle}`);
        return script.slice(start, end);
    };

    const helperCode = [
        'const esc = (s) => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");',
        'function fmtCost(v){ return v==null||!Number.isFinite(Number(v)) ? "—" : (Number(v)===0 ? "$0.0000" : "$"+Number(v).toFixed(5)); }',
        'function reportNote(text){ const el = document.createElement("p"); el.className = "report-note"; el.textContent = text; return el; }',
        sliceBetween('const MODEL_LABELS=', 'function renderModelCell'),
        sliceBetween('function renderAnalysisSegmentationReport', 'async function renderReport'),
        'this.__exports = { formatFrozenSourceLabel, describeStageASource, renderEngineBadge, renderAnalysisSegmentationReport };',
    ].join('\n');

    const makeEl = (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            children: [],
            _text: '',
            append(...nodes) {
                for (const node of nodes) this.children.push(node);
            },
            set textContent(v) { this._text = String(v ?? ''); },
            get textContent() {
                if (this.children.length) return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
                return this._text;
            },
        };
        return el;
    };

    const sandbox = {
        document: { createElement: (tag) => makeEl(tag) },
        __exports: null,
    };
    vm.runInNewContext(helperCode, sandbox);
    return sandbox.__exports;
}

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

test('UI badges distinguish Frozen text Stage T sources from Stage T Local (pdfjs)', () => {
    const ui = extractLabUiHelpers();

    expect(ui.renderEngineBadge('local-text', 'z-ai/glm-5.3-flash', 'Z.AI', {
        stage: 'A', transcriptSourceArm: 'or-mistral-ocr', transcriptProvider: 'Mistral',
    })).toContain('>Frozen text (Mistral OCR)<');

    expect(ui.renderEngineBadge('local-text', 'z-ai/glm-5.3-flash', 'Z.AI', {
        stage: 'A', transcriptSourceArm: 'local-raster', transcriptProvider: 'Google AI Studio',
    })).toContain('>Frozen text (Gemini Raster)<');

    expect(ui.renderEngineBadge('local-text', 'z-ai/glm-5.3-flash', 'Z.AI', {
        stage: 'A', transcriptSourceArm: 'local-raster', transcriptProvider: 'Wafer',
    })).toContain('>Frozen text (Wafer Raster)<');

    expect(ui.renderEngineBadge('local-text', 'z-ai/glm-5.3-flash', 'Z.AI', {
        stage: 'A', transcriptSourceArm: 'local-text', transcriptProvider: 'pdfjs',
    })).toContain('>Frozen text (pdfjs)<');

    const unannotatedStageA = ui.renderEngineBadge('local-text', 'z-ai/glm-5.3-flash', 'Z.AI', { stage: 'A' });
    expect(unannotatedStageA).toContain('>Frozen text<');
    expect(unannotatedStageA).not.toContain('Local (pdfjs)');

    expect(ui.renderEngineBadge('local-text', null, null, { stage: 'T' })).toContain('>Local (pdfjs)<');

    expect(ui.renderEngineBadge('local-text', null, null, {
        stage: 'A',
        sources: [
            { transcriptSourceArm: 'or-mistral-ocr', transcriptProvider: 'Mistral' },
            { transcriptSourceArm: 'local-raster', transcriptProvider: 'Google AI Studio' },
        ],
    })).toContain('>Frozen text (Mistral OCR + Gemini Raster)<');
});

test('segmentation banner hides pending-segment warning unless pending segments exist', () => {
    const ui = extractLabUiHelpers();

    const partialTruncated = ui.renderAnalysisSegmentationReport({
        rows: [{
            docId: '19:Diobeni popis.pdf',
            arm: 'local-text',
            stage: 'A',
            transcriptSourceArm: 'local-text',
            transcriptProvider: 'pdfjs',
            model: 'google/gemini-2.5-flash',
            structuredAnalysisSegmentation: {
                status: 'partial',
                segments: [{ id: 's1', status: 'completed' }, { id: 's2', status: 'failed' }],
                requests: [{ segmentId: 's1', status: 'completed', cost: 0.01 }, { segmentId: 's2', status: 'failed', finishReason: 'length', error: 'truncated' }],
            },
        }],
    });
    expect(partialTruncated.textContent).not.toContain('Pending segments were not requested');
    expect(partialTruncated.textContent).toContain('partial coverage');
    expect(partialTruncated.textContent).toContain('Frozen text (pdfjs)');

    const abortedWithPending = ui.renderAnalysisSegmentationReport({
        rows: [{
            docId: '19:Završni račun.pdf',
            arm: 'local-text',
            stage: 'A',
            transcriptSourceArm: 'local-text',
            model: 'z-ai/glm-5.3-flash',
            structuredAnalysisSegmentation: {
                status: 'partial',
                segments: [{ id: 's1', status: 'completed' }, { id: 's2', status: 'pending' }],
                requests: [{ segmentId: 's1', status: 'completed', cost: 0.01 }],
            },
        }],
    });
    expect(abortedWithPending.textContent).toContain('Pending segments were not requested; partial costs are not complete costs.');
});
