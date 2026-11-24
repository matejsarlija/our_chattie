'use strict';

const { extractAmounts, extractDates, extractOibs, extractFilingNumbers, diacriticFidelity, pageCompleteness, jsonValidity, scoreJsonConditions, scoreJsonRequestConditions, setMetrics, computeTextMetrics } = require('../scripts/lib/metrics');
const { buildArmMatrix, ARMS } = require('../scripts/lib/arms');
const { probeModel } = require('../scripts/lib/capabilities');

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

test.each([
    ['1.234,56 EUR', '1234.56|EUR'],
    ['1,234.56 EUR', '1234.56|EUR'],
    ['1.234 kn', '1234.00|HRK'],
])('amount parser normalizes Croatian and US formats: %s', (input, expected) => {
    expect(extractAmounts(input)).toContain(expected);
});

test('OIB, Croatian dates, and register-prefixed filing numbers are extracted raw', () => {
    expect(extractOibs('OIB 66124057408')).toEqual(['66124057408']);
    expect(extractDates('dana 23.06.2026.')).toEqual(['23.06.2026.']);
    expect(extractFilingNumbers('St-2/2013, P-44/2020, Pz-11/2022')).toEqual(expect.arrayContaining(['St-2/2013', 'P-44/2020', 'Pz-11/2022']));
});

test('filing numbers normalize typography but never the register identity', () => {
    // A PDF copy prints the en dash and pads it; a model answers with a hyphen.
    // Same filing, so it must compare equal.
    expect(extractFilingNumbers('St – 2/2013')).toEqual(['St-2/2013']);
    expect(extractFilingNumbers('Povrv - 772/2021 - 10')).toEqual(['Povrv-772/2021-10']);
    // Multi-letter registers are real `poslovni brojevi`, not noise.
    expect(extractFilingNumbers('Pž-2889/2022-2')).toEqual(['Pž-2889/2022-2']);
    expect(extractFilingNumbers('Povrv-297/2020')).toEqual(['Povrv-297/2020']);
    // The leading register number is a distinct case identity, so it survives.
    expect(extractFilingNumbers('4 St-2/2013')).toEqual(['4 St-2/2013']);
    expect(extractFilingNumbers('4 St-2/2013, St-2/2013')).toHaveLength(2);
    // Ordinary prose is not a filing number.
    expect(extractFilingNumbers('račun 1.234/2020')).toEqual([]);
});

test('raw diacritic and page-marker metrics distinguish fidelity from ASCII loss', () => {
    expect(diacriticFidelity('Čćđšž', 'Ccdsz').preserved).toBe(0);
    expect(diacriticFidelity('Čćđšž', 'Čćđšž').preserved).toBe(1);
    expect(diacriticFidelity('čćđšž', 'Äŧ').mojibakeCount).toBeGreaterThan(0);
    expect(pageCompleteness('=== STRANICA 1 ===\na\n=== STRANICA 2 ===\nb', 2).complete).toBe(true);
    expect(pageCompleteness('=== STRANICA 1 ===\na', 2).complete).toBe(false);
    expect(jsonValidity('{"ok":true}').valid).toBe(true);
    expect(jsonValidity('{"ok":').truncated).toBe(true);
});

test('JSON condition scores separate strict parsing, structured mode, and fence repair', () => {
    expect(scoreJsonConditions('{"ok":true}', { structuredMode: true })).toMatchObject({
        raw_parse: true, structured_mode: true, repaired: false, rawFailed: false, repairOverheadCost: 0,
    });
    const fenced = scoreJsonConditions('```json\n{"ok":true}\n```', { structuredMode: true });
    expect(fenced).toMatchObject({ raw_parse: false, structured_mode: false, repaired: true, rawFailed: true, repairOverheadCost: 0 });
    expect(fenced.repairOverheadMs).toBeGreaterThanOrEqual(0);
    expect(scoreJsonConditions('```json\n{bad}\n```')).toMatchObject({
        raw_parse: false, structured_mode: false, repaired: false, rawFailed: true,
    });
});

test('bounded condition scoring aggregates raw failures and successful fence repair', () => {
    const result = scoreJsonRequestConditions([
        { status: 'completed', rawText: '{"a":1}' },
        { status: 'completed', rawText: '```json\n{"b":2}\n```' },
    ], { structuredMode: true });
    expect(result).toMatchObject({
        raw_parse: false,
        structured_mode: false,
        repaired: true,
        rawFailed: true,
        repairOverheadCost: 0,
    });
    expect(scoreJsonRequestConditions([
        { status: 'completed', rawText: '{"a":1}' },
        { status: 'failed', rawText: '{bad}' },
    ])).toMatchObject({ raw_parse: false, repaired: false, rawFailed: true });
});

test('no text-layer reference yields unscored null metrics rather than false success', () => {
    expect(computeTextMetrics('', '1234 EUR', 1).amounts).toMatchObject({ precision: null, recall: null, counts: { reference: null, predicted: 1 } });
});

test('capability matrix skips unknown/false and readies confirmed capabilities', () => {
    const result = buildArmMatrix(['without/file'], ARMS, { 'without/file': { fileNative: false, imageInput: null } });
    expect(result.find((row) => row.arm === 'or-native-transcribe')).toMatchObject({ status: 'SKIPPED', reason: expect.stringContaining('fileNative is false') });
    expect(result.find((row) => row.arm === 'local-raster').status).toBe('SKIPPED');
    expect(result.find((row) => row.arm === 'or-cloudflare').status).toBe('READY');
});

test('unknown capabilities are probed before matrix creation', async () => {
    const fetchImpl = jest.fn(() => Promise.resolve(response(200, { provider: 'Test', choices: [{ message: { content: 'OK' } }] })));
    const result = await probeModel('x/unknown', { apiKey: 'test', fetchImpl, maxRetries: 0 });
    const matrix = buildArmMatrix(['x/unknown'], ARMS, { 'x/unknown': result.capabilities });
    expect(matrix.find((row) => row.arm === 'or-native-transcribe').status).toBe('READY');
    expect(matrix.find((row) => row.arm === 'local-raster').status).toBe('READY');
});

test('seeded stratified sample and arm registry are reproducible', () => {
    const { stableShuffle, selectSample } = require('../scripts/lib/selection');
    const { buildArmDefinitions } = require('../scripts/lib/arms');
    const items = ['a', 'b', 'c', 'd'];
    expect(stableShuffle(items, 5)).toEqual(stableShuffle(items, 5));
    expect(stableShuffle(items, 5)).not.toEqual(stableShuffle(items, 6));
    const docs = [
        { docId: 't1', textLayer: true, pageBucket: '1-2', tableHeavy: false },
        { docId: 't2', textLayer: true, pageBucket: '1-2', tableHeavy: false },
        { docId: 's1', textLayer: false, pageBucket: '3-10', tableHeavy: true },
    ];
    expect(selectSample(docs, 2, 9)).toEqual(selectSample(docs, 2, 9));
    expect(buildArmDefinitions().every((arm) => typeof arm.run === 'function')).toBe(true);
});

test('SKIPPED combinations remain visible but do not enter Stage T aggregates', () => {
    const { summarizeRows } = require('../scripts/benchmark-pdf-engines');
    const matrix = buildArmMatrix(['m'], ARMS, { m: { fileNative: false, imageInput: false } });
    const stageRows = [{ arm: 'local-text', model: null, documentType: 'scan', pages: 1, cost: 0, latency: 10, errors: [] }];
    const summary = summarizeRows(stageRows);
    expect(matrix.find((cell) => cell.arm === 'or-native-transcribe')).toMatchObject({ status: 'SKIPPED', reason: expect.stringContaining('fileNative is false') });
    expect(summary.some((cell) => cell.arm === 'or-native-transcribe')).toBe(false);
    expect(summary[0].N).toBe(1);
});

test('reported cost averages use only cells with provider-reported charges', () => {
    const { summarizeRows } = require('../scripts/benchmark-pdf-engines');
    const [summary] = summarizeRows([
        { arm: 'or-mistral-ocr', model: 'x/y', documentType: 'scan', pages: 1, cost: 0.5 },
        { arm: 'or-mistral-ocr', model: 'x/y', documentType: 'scan', pages: 9, cost: null, estimatedParserFee: 0.02, costIncomplete: true },
    ]);
    expect(summary).toMatchObject({ N: 2, pages: 10, reportedCostCells: 1, costPerCell: 0.5, costPerPage: 0.5 });
});

test('p95 is withheld below three observations and reported at three', () => {
    const { summarizeRows } = require('../scripts/benchmark-pdf-engines');
    const rows = (n) => Array.from({ length: n }, (_, index) => ({
        arm: 'local-text', model: 'x/y', documentType: 'text-layer', pages: 1, latency: 100 + index, cost: 0.01, errors: [],
    }));
    expect(summarizeRows(rows(2))[0]).toMatchObject({
        latencyN: 2, minLatency: 100, p50Latency: 100, maxLatency: 101, p95Latency: null,
    });
    expect(summarizeRows(rows(3))[0]).toMatchObject({
        latencyN: 3, minLatency: 100, p50Latency: 101, maxLatency: 102, p95Latency: 102,
    });
});

test('a metadata-only parser response counts as empty; a terse real one does not', () => {
    const { isEffectivelyEmpty, effectiveContentChars } = require('../scripts/lib/metrics');
    // Real Cloudflare Workers AI output on an image-only invoice: 883
    // characters of envelope and PDF metadata, no document text at all.
    const metadataOnly = `<file name="Prilog Adria.pdf">
# document.pdf
## Metadata
- PDFFormatVersion=1.3
- IsLinearized=true
- Creator=Preview
- Title=Račun Adria Rijeka, 2-2025.pdf


## Contents
### Page 1
</file>`;
    expect(metadataOnly.length).toBeGreaterThan(150);
    expect(effectiveContentChars(metadataOnly)).toBe(0);
    expect(isEffectivelyEmpty(metadataOnly)).toBe(true);
    expect(isEffectivelyEmpty('')).toBe(true);
    expect(isEffectivelyEmpty('   \n\n  ')).toBe(true);
    const terse = '<file name="a.pdf">\n## Contents\n### Page 1\nRačun br. 2-2025 — 1.234,56 EUR\n</file>';
    expect(isEffectivelyEmpty(terse)).toBe(false);
});

test('metric aggregation reports pooled counts and per-cell N', () => {
    const { summarizeTextMetrics } = require('../scripts/lib/metrics');
    const rows = [
        { arm: 'or-cloudflare', model: null, documentType: 'text-layer', metrics: { amounts: { counts: { truePositive: 3, predicted: 4, reference: 5 } } } },
        { arm: 'or-cloudflare', model: null, documentType: 'text-layer', metrics: { amounts: { counts: { truePositive: 4, predicted: 5, reference: 4 } } } },
    ];
    const cell = summarizeTextMetrics(rows)[0];
    expect(cell.fields.amounts).toMatchObject({ truePositive: 7, predicted: 9, reference: 9, N: 2, precision: 7 / 9, recall: 7 / 9 });
});

test('parser date scores compare equivalent numeric, ISO and Croatian dates', () => {
    const metrics = computeTextMetrics(
        '8. lipnja 2026. i 22. travnja. 2022.g.',
        '08.06.2026. i 2022-04-22'
    );
    expect(metrics.dates).toEqual({
        precision: 1, recall: 1,
        counts: { truePositive: 2, predicted: 2, reference: 2 },
    });
    expect(computeTextMetrics('8.6.2026.', '09.06.2026.').dates.recall).toBe(0);
});

test('scan-only parser summaries leave unmeasured precision and recall unknown', () => {
    const { summarizeTextMetrics } = require('../scripts/lib/metrics');
    const [summary] = summarizeTextMetrics([{
        arm: 'or-cloudflare', documentType: 'image-only',
        metrics: computeTextMetrics('', 'Recovered 100 EUR on 8.6.2026.'),
    }]);
    for (const metric of Object.values(summary.fields)) {
        expect(metric).toMatchObject({ N: 0, precision: null, recall: null });
    }
});
