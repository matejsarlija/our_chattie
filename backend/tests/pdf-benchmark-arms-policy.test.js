'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute } = require('../scripts/benchmark-pdf-engines');

const textDoc = { docId: 'text.pdf', title: 'Text', filePath: '/tmp/text.pdf', pages: 2, textLayer: true, pageBucket: '1-2', tableHeavy: false };
const scanDoc = { docId: 'scan.pdf', title: 'Scan', filePath: '/tmp/scan.pdf', pages: 2, textLayer: false, pageBucket: '1-2', tableHeavy: false };

const answered = (report) => report.rows.filter((row) => row.status !== 'SKIPPED');

function registryFor(record) {
    const recordArm = (arm) => async (model, doc, context) => {
        record.push({ arm, doc: doc.docId, context });
        return { text: '{}', parsed: {}, json: { valid: true, truncated: false }, groundingText: '', errors: [], cost: 0, latency: 1, provider: 'mock', pages: doc.pages };
    };
    return {
        'local-text': recordArm('local-text'),
        'local-raster': recordArm('local-raster'),
        'or-cloudflare': recordArm('or-cloudflare'),
        'or-mistral-ocr': recordArm('or-mistral-ocr'),
        'or-native': recordArm('or-native'),
    };
}

async function run({ args, documents, record = [], registry = registryFor(record), capabilities = { fileNative: true, imageInput: true } }) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-arms-policy-'));
    try {
        const report = await execute({
            args: { 'max-cost': 10, repeats: 1, ...args },
            documents,
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': capabilities },
            outputDir,
            dryRun: false,
            registry,
        });
        return { report, record };
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
}

test('a pilot run does not pay for file parsers on documents that already have text', async () => {
    const { record } = await run({ args: { scope: 'pilot' }, documents: [textDoc] });
    expect(record.map((item) => item.arm).sort()).toEqual(['local-text', 'or-native']);
});

test('smoke keeps the parser arms on a text layer, because that is the only place parser fidelity is measurable', async () => {
    const { record } = await run({ args: { scope: 'smoke' }, documents: [textDoc] });
    expect(record.map((item) => item.arm).sort()).toEqual(['local-text', 'or-cloudflare', 'or-mistral-ocr', 'or-native']);
});

test('--engines-on-text-layer restores the parser arms in a pilot run', async () => {
    const { record } = await run({ args: { scope: 'pilot', 'engines-on-text-layer': true }, documents: [textDoc] });
    expect(record.map((item) => item.arm).sort()).toEqual(['local-text', 'or-cloudflare', 'or-mistral-ocr', 'or-native']);
});

test('the page-image arm runs only on scans', async () => {
    const onText = await run({ args: { scope: 'smoke' }, documents: [textDoc] });
    expect(onText.record.some((item) => item.arm === 'local-raster')).toBe(false);
    expect(onText.report.rows.find((row) => row.arm === 'local-raster').reason).toBe('skipped:not-a-scan');

    const onScan = await run({ args: { scope: 'smoke' }, documents: [scanDoc] });
    expect(onScan.record.some((item) => item.arm === 'local-raster')).toBe(true);
});

test('the page-image arm is bounded by the production OCR page cap', async () => {
    const previous = process.env.OCR_MAX_PAGES;
    process.env.OCR_MAX_PAGES = '7';
    try {
        const fromEnv = await run({ args: { scope: 'smoke' }, documents: [scanDoc] });
        const raster = fromEnv.record.find((item) => item.arm === 'local-raster');
        expect(raster.context.rasterMaxPages).toBe(7);

        const overridden = await run({ args: { scope: 'smoke', 'raster-max-pages': '3' }, documents: [scanDoc] });
        expect(overridden.record.find((item) => item.arm === 'local-raster').context.rasterMaxPages).toBe(3);
    } finally {
        if (previous === undefined) delete process.env.OCR_MAX_PAGES;
        else process.env.OCR_MAX_PAGES = previous;
    }
});

test('attempted empty raster failures retain paid costs and errors in runner reliability', async () => {
    const failure = {
        text: '', parsed: null, groundingText: '', failedCall: true,
        errors: ['OCR provider failed', 'Raster produced no usable transcription'],
        usage: { total_tokens: 12 }, cost: 0.03, costIncomplete: false,
        latency: 15, retries: 1, provider: 'mock', pages: 2,
    };
    const arm = jest.fn().mockResolvedValue(failure);
    const { report } = await run({
        args: { scope: 'smoke', arms: ['local-raster'] }, documents: [scanDoc],
        registry: { 'local-raster': arm },
    });
    expect(report.skippedCells).toHaveLength(0);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
        failedCall: true, errors: failure.errors, usage: failure.usage, cost: 0.03,
        costIncomplete: false, retries: 1, pages: 2, textLength: 0,
    });
    expect(report.actualCost).toBeCloseTo(0.03);
    expect(report.summary[0]).toMatchObject({ N: 1, errors: 1, errorRate: 1, costPerCell: 0.03 });
    expect(report.extractionSummary[0]).toMatchObject({ N: 1, answered: 0, errors: 1, validRate: null });
});

test('unsupported raster remains skipped and never incurs requests or reliability failures', async () => {
    const arm = jest.fn();
    const { report } = await run({
        args: { scope: 'smoke', arms: ['local-raster'] }, documents: [scanDoc],
        capabilities: { fileNative: false, imageInput: false }, registry: { 'local-raster': arm },
    });
    expect(arm).not.toHaveBeenCalled();
    expect(report.rows[0]).toMatchObject({ status: 'SKIPPED', reason: expect.stringContaining('unsupported-capability') });
    expect(report.summary).toEqual([]);
    expect(report.extractionSummary).toEqual([]);
    expect(report.actualCost).toBe(0);
});
