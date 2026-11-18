'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseEngine } = require('../scripts/lib/arms');
const { buildImageMessage } = require('../scripts/lib/openrouter-client');
const { runExtraction, summarizeExtractionRows, execute, parseReasoningArg, estimateRunCost, createBenchLogger } = require('../scripts/benchmark-pdf-engines');
const { aggregateReviews } = require('../scripts/score-review');

const transcript = {
    docId: '1:Podnesak.pdf',
    arm: 'local-text',
    repeat: 1,
    documentType: 'text-layer / 1-2 / other',
    text: 'Sud je utvrdio da je tražbina u iznosu od 1.234,56 EUR prijavljena 12.03.2024.',
};
const extractionJson = {
    caseNumber: 'St-2/2013',
    decisionDate: '2024-03-12',
    amounts: [{ description: 'Prijavljena tražbina', amount: 1234.56, currency: 'EUR', date: '12.03.2024', quote: 'tražbina u iznosu od 1.234,56 EUR prijavljena' }],
};

function fakeChat(content, overrides = {}) {
    return jest.fn().mockResolvedValue({
        response: { choices: [{ message: { content } }] },
        usage: { total_tokens: 12, cost: 0.01 },
        cost: 0.01,
        latencyMs: 5,
        provider: 'mock',
        retries: 0,
        error: null,
        ...overrides,
    });
}

test('buildExtractionBody generates a valid user content payload', () => {
    const { buildExtractionBody } = require('../scripts/benchmark-pdf-engines');
    const body2 = buildExtractionBody('model', 'prompt');
    expect(body2.messages[0]).toEqual({ role: 'user', content: 'prompt' });
    const body3 = buildExtractionBody('model', 'text', 'prompt');
    expect(body3.messages[0]).toEqual({ role: 'user', content: 'prompt' });
});

test('live input inspection refuses unknown page counts instead of bypassing page caps', async () => {
    const { inspectPdfPages } = require('../scripts/benchmark-pdf-engines');
    await expect(inspectPdfPages({ filePath: '/tmp/unknown.pdf' }, async () => ({ pages: 0 }))).rejects.toThrow(/could not verify.*page count/i);
    await expect(inspectPdfPages({ pages: 2, filePath: '/tmp/known.pdf' }, async () => { throw new Error('should not read'); })).resolves.toBe(2);
});

test('crossed extraction produces grounded, scorable rows instead of throwing', async () => {
    const chat = fakeChat(JSON.stringify(extractionJson));
    const row = await runExtraction({ model: 'x/y', transcript, chat });
    expect(chat.mock.calls[0][0].messages[0].content).toBeTruthy();
    expect(row).toMatchObject({ docId: '1:Podnesak.pdf', transcriptArm: 'local-text', extractionModel: 'x/y', stage: 'E' });
    expect(row.json.valid).toBe(true);
    expect(row.parsed.caseNumber).toBe('St-2/2013');
    expect(row.quoteGroundingOwn).toEqual({ grounded: 1, total: 1, rate: 1 });
    expect(row.errors).toEqual([]);
    expect(row.costIncomplete).toBe(false);
});

test('extraction rows are scored against gold facts when a completed template exists', async () => {
    const gold = { factsComplete: true, reviewedCategories: ['amounts', 'oibs', 'dates', 'filingNumbers', 'decisionOutcome', 'tables'], facts: { amounts: [{ rawValue: '1.234,56', currency: 'EUR' }], oibs: [], dates: ['12.03.2024'], filingNumbers: ['St-2/2013'], tables: [] } };
    const row = await runExtraction({ model: 'x/y', transcript, goldDocument: gold, chat: fakeChat(JSON.stringify(extractionJson)) });
    expect(row.goldAccuracy.complete).toBe(true);
    expect(row.goldAccuracy.amounts.counts).toMatchObject({ truePositive: 1, reference: 1 });
});

test('invalid JSON and missing cost are recorded, never fatal', async () => {
    const invalid = await runExtraction({ model: 'x/y', transcript, chat: fakeChat('{"amounts": [') });
    expect(invalid.parsed).toBeNull();
    expect(invalid.json.valid).toBe(false);
    expect(invalid.errors).toEqual(['Invalid JSON or truncation']);

    const noCost = await runExtraction({ model: 'x/y', transcript, chat: fakeChat(JSON.stringify(extractionJson), { cost: null, usage: null }) });
    expect(noCost.costIncomplete).toBe(true);
});

test('extraction summaries aggregate cells by input path and model', async () => {
    const row = await runExtraction({ model: 'x/y', transcript, chat: fakeChat(JSON.stringify(extractionJson)) });
    const summary = summarizeExtractionRows([row]);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ arm: 'local-text', model: 'x/y', N: 1, answered: 1, errors: 0, validJson: 1, validRate: 1, ownGrounded: 1, ownQuotes: 1, goldStatus: 'none' });
    expect(summary[0].ownGroundingRate).toBe(1);
});

test('a failed call is not counted as the model emitting invalid JSON', () => {
    const base = {
        arm: 'or-cloudflare', model: 'x/y', documentType: 'text-layer / 1-2 / other',
        quoteGroundingOwn: { grounded: 1, total: 1 },
        goldAccuracy: { complete: false, reason: 'Set factsComplete=true after filling all gold categories.' },
    };
    const summary = summarizeExtractionRows([
        { ...base, json: { valid: true, truncated: false }, errors: [] },
        { ...base, json: undefined, errors: ['Provider returned error'] },
    ]);
    expect(summary[0]).toMatchObject({ N: 2, answered: 1, errors: 1, validJson: 1, validRate: 1, goldStatus: 'incomplete', goldScored: 0, goldPending: 2 });
});

test('gold status distinguishes no gold, unverified gold, and scored gold', () => {
    const cell = (goldAccuracy) => summarizeExtractionRows([{
        arm: 'local-text', model: 'x/y', documentType: 'text-layer / 1-2 / other',
        json: { valid: true, truncated: false }, errors: [], quoteGroundingOwn: { grounded: 0, total: 0 },
        goldAccuracy,
    }])[0];
    expect(cell(null).goldStatus).toBe('none');
    expect(cell({ complete: false, reason: 'incomplete' }).goldStatus).toBe('incomplete');
    const scored = cell({ complete: true, amounts: { counts: { truePositive: 1, predicted: 1, reference: 1 } } });
    expect(scored.goldStatus).toBe('scored');
    expect(scored.goldAccuracy.amounts).toMatchObject({ precision: 1, recall: 1 });
});

test('parser fidelity is recorded per model, and never for the native arm', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-parser-'));
    const { loadDocuments } = require('../scripts/benchmark-pdf-engines');
    const [doc] = loadDocuments({ 'doc-id': ['1:Podnesak.pdf'] });
    doc.pages = 2;
    const shape = (parserText) => ({
        text: JSON.stringify(extractionJson), parsed: extractionJson, json: { valid: true, truncated: false },
        parserText, groundingText: parserText, cost: 0.01, latency: 10, provider: 'mock',
        retries: 0, errors: [], pages: 2, costIncomplete: false,
    });
    const registry = {
        'local-text': async () => shape(''),
        'or-cloudflare': async () => shape('parsed by cloudflare 1.234,56 EUR'),
        'or-mistral-ocr': async () => shape(''),
        'or-native': async () => shape(''),
    };
    try {
        const report = await execute({
            args: { 'max-cost': 1, repeats: 1, 'engines-on-text-layer': true },
            documents: [doc],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: true, imageInput: true } },
            outputDir,
            dryRun: false,
            registry,
        });
        expect(report.parserMetrics.map((row) => row.arm).sort()).toEqual(['or-cloudflare', 'or-mistral-ocr']);
        expect(report.parserMetrics.every((row) => row.model === 'x/y')).toBe(true);
        const mistral = report.textMetricSummary.find((row) => row.arm === 'or-mistral-ocr');
        expect(mistral.emptyOutputs).toBe(1);
        const cloudflare = report.textMetricSummary.find((row) => row.arm === 'or-cloudflare');
        expect(cloudflare.emptyOutputs).toBe(0);
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('repeats apply to smoke too, so percentiles have samples', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-smoke-repeat-'));
    const arm = jest.fn().mockResolvedValue({ text: 'text', cost: 0.01, latency: 5, provider: 'mock', errors: [], pages: 1, parsed: null, json: { valid: true, truncated: false }, groundingText: '' });
    try {
        const report = await execute({
            args: { scope: 'smoke', 'max-cost': 10, repeats: 3 },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: true, imageInput: true } },
            outputDir,
            dryRun: false,
            registry: { 'local-text': arm, 'local-raster': arm, 'or-cloudflare': arm, 'or-mistral-ocr': arm, 'or-native': arm },
        });
        // Four arms apply on a text-layer document (the page-image arm is
        // skipped), and every one of them runs three times.
        expect(arm).toHaveBeenCalledTimes(12);
        expect(report.rows.filter((row) => row.status !== 'SKIPPED')).toHaveLength(12);
        expect(report.rows.find((row) => row.arm === 'local-raster').reason).toBe('skipped:not-a-scan');
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('mistral-ocr cost uses the reported total instead of double-counting the page fee', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            choices: [{ message: { annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'parsed text' }] } }] } }],
            usage: { cost: 0.5, prompt_tokens: 100 },
        }),
    });
    const doc = { filePath: '/tmp/does-not-matter.pdf', pages: 2 };
    // Avoid touching the real file: parseEngine reads bytes, so use a real temp PDF stub.
    const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cost-')), 'doc.pdf');
    fs.writeFileSync(temp, '%PDF-1.4 stub');
    try {
        const result = await parseEngine('mistral-ocr', 'x/y', { ...doc, filePath: temp }, {
            requestOptions: { apiKey: 'mock', fetchImpl }, provider: {}, mistralPageRate: 2,
        });
        expect(result.cost).toBe(0.5);
        expect(result.estimatedParserFee).toBe(0);
        expect(result.costBasis).toBe('reported-total');
        expect(result.parserFeeEstimateUsd).toBeCloseTo(0.004);
        expect(result.costIncomplete).toBe(false);
    } finally {
        fs.rmSync(path.dirname(temp), { recursive: true, force: true });
    }
});

test('a response without reported cost falls back to the parser-fee estimate and is flagged', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ choices: [{ message: { annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'parsed' }] } }] } }], usage: { prompt_tokens: 5 } }),
    });
    const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cost-')), 'doc.pdf');
    fs.writeFileSync(temp, '%PDF-1.4 stub');
    try {
        const result = await parseEngine('mistral-ocr', 'x/y', { filePath: temp, pages: 2 }, {
            requestOptions: { apiKey: 'mock', fetchImpl }, provider: {}, mistralPageRate: 2,
        });
        expect(result.cost).toBeNull();
        expect(result.estimatedParserFee).toBeCloseTo(0.004);
        expect(result.costBasis).toBe('estimated-parser-fee');
        expect(result.costIncomplete).toBe(true);
    } finally {
        fs.rmSync(path.dirname(temp), { recursive: true, force: true });
    }
});

test('image messages accept multiple page images for the layout judge', () => {
    const body = buildImageMessage({ model: 'x/y', prompt: 'compare', imageDataUrls: ['data:image/jpeg;base64,AA==', 'data:image/jpeg;base64,BB=='], maxTokens: 512 });
    const images = body.messages[0].content.filter((part) => part.type === 'image_url');
    expect(images).toHaveLength(2);
    expect(images[1].image_url.url).toBe('data:image/jpeg;base64,BB==');
    expect(() => buildImageMessage({ model: 'x/y', prompt: 'compare' })).toThrow(/imageDataUrl/);
});

test('human/metric agreement understands page-completeness objects', () => {
    const answerKey = { mappings: { d1: { A: { arm: 'local-text', repeat: 1 } } } };
    const report = { rows: [{ docId: 'd1', arm: 'local-text', repeat: 1, documentType: 'plain', metrics: { amounts: { recall: 1 }, pageCompleteness: { complete: true, expected: 2, marked: 2 } } }] };
    const result = aggregateReviews({ verdicts: [{ docId: 'd1', label: 'A', verdict: 'usable', errorTypes: [] }] }, answerKey, report);
    expect(result[0].agreement).toEqual({ matches: 1, compared: 1 });
    expect(result[0].deterministicAgreement).toBe(1);
});

test('bench logger keeps request lifecycle details in the log and only shows key progress by default', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-log-'));
    const logFile = path.join(dir, 'progress.log');
    const stream = { write: jest.fn() };
    try {
        const logger = createBenchLogger({ stream, logFile });
        logger.event({ phase: 'start', label: 'cell', attempt: 1, timeoutMs: 300000 });
        logger.event({ phase: 'heartbeat', label: 'cell', attempt: 1, elapsedMs: 15000 });
        logger.event({ phase: 'heartbeat', label: 'cell', attempt: 1, elapsedMs: 30000 });
        logger.event({ phase: 'end', label: 'cell', attempt: 1, latencyMs: 30000, cost: 0.01, provider: 'mock' });
        const terminal = stream.write.mock.calls.map(([line]) => line).join('');
        const details = fs.readFileSync(logFile, 'utf8');
        expect(terminal).not.toMatch(/request →|request ←|15\.0s elapsed/);
        expect(terminal).toMatch(/waiting · cell.*30\.0s elapsed/);
        expect(details).toMatch(/request → cell/);
        expect(details).toMatch(/waiting · cell.*15\.0s elapsed/);
        expect(details).toMatch(/request ← cell/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a free concurrency slot refills before a slow cell finishes, preserving report order', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-concurrency-'));
    let releaseSlow;
    const slow = new Promise((resolve) => { releaseSlow = resolve; });
    const starts = [];
    let active = 0;
    let maxActive = 0;
    const arm = async (_model, doc) => {
        starts.push(doc.docId);
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (doc.docId === 'd1') await slow;
        if (doc.docId === 'd3') releaseSlow();
        active -= 1;
        return { text: doc.docId, cost: 0.01, latency: 10, provider: 'mock', errors: [], pages: 1, parsed: null, json: { valid: false, truncated: false } };
    };
    const documents = ['d1', 'd2', 'd3'].map((docId) => ({ docId, title: docId, filePath: `/tmp/${docId}.pdf`, pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }));
    try {
        const report = await execute({
            args: { scope: 'smoke', arms: ['local-text'], concurrency: 2 },
            documents, models: ['x/y'], capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir, dryRun: false, registry: { 'local-text': arm },
        });
        expect(starts).toEqual(['d1', 'd2', 'd3']);
        expect(maxActive).toBe(2);
        expect(report.rows.map(({ docId }) => docId)).toEqual(['d1', 'd2', 'd3']);
        expect(report.aborted).toBeNull();
    } finally {
        releaseSlow();
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});


test('concurrent cells may finish past the cost cap but no new cell starts after a breach', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-concurrent-cap-'));
    const calls = [];
    const arm = async () => {
        calls.push('started');
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { text: 'text', cost: 0.5, latency: 10, provider: 'mock', errors: [], pages: 1, parsed: null, json: { valid: false, truncated: false } };
    };
    try {
        const report = await execute({
            args: { scope: 'smoke', arms: ['local-text', 'or-cloudflare', 'or-mistral-ocr'], concurrency: 2, 'max-cost': 0.25 },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'], capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir, dryRun: false, registry: { 'local-text': arm, 'or-cloudflare': arm, 'or-mistral-ocr': arm },
        });
        expect(calls).toHaveLength(2);
        expect(report.rows).toHaveLength(2);
        expect(report.actualCost).toBeCloseTo(1);
        expect(report.aborted).toMatchObject({ reason: 'cost-cap' });
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('a cost-cap breach keeps the paid-for rows instead of discarding the run', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-cap-'));
    const arm = async () => ({ text: 'text', usage: null, cost: 0.5, latency: 5, provider: 'mock', retries: 0, errors: [], pages: 1, parsed: null, json: { valid: false, truncated: false }, groundingText: '' });
    const registry = { 'local-text': arm, 'or-cloudflare': arm, 'or-mistral-ocr': arm, 'or-native': arm };
    try {
        const report = await execute({
            args: { 'max-cost': 0.75, repeats: 1, 'engines-on-text-layer': true },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir,
            dryRun: false,
            registry,
        });
        expect(report.aborted).toMatchObject({ reason: 'cost-cap' });
        expect(report.aborted.message).toMatch(/0\.75/);
        // The unavailable page-image arm is reported as skipped, not paid for.
        const answered = report.rows.filter((row) => row.status !== 'SKIPPED');
        expect(answered).toHaveLength(2);
        expect(answered[0].arm).toBe('local-text');
        expect(answered[1].arm).toBe('or-cloudflare');
        expect(report.summary).toHaveLength(2);
        expect(report.extractionSummary).toHaveLength(2);
        expect(report.actualCost).toBeCloseTo(1);
        expect(report.estimatedParserFee).toBe(0);
        expect(report.spendTotal).toBeCloseTo(1);
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('parser-fee estimates enter the cap basis without being reported as actual spend', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-estimated-cap-'));
    const arm = async () => ({ text: 'text', cost: null, estimatedParserFee: 0.004, costIncomplete: true, latency: 5, provider: 'mock', errors: [], pages: 2, parsed: null, json: { valid: false, truncated: false } });
    try {
        const report = await execute({
            args: { 'max-cost': 0.003 },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 2, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir,
            dryRun: false,
            registry: { 'local-text': arm, 'or-cloudflare': arm, 'or-mistral-ocr': arm, 'or-native': arm },
        });
        expect(report.aborted).toMatchObject({ reason: 'cost-cap' });
        expect(report.rows.filter((row) => row.status !== 'SKIPPED')).toHaveLength(1);
        expect(report.rows[0]).toMatchObject({ cost: null, estimatedParserFee: 0.004, costIncomplete: true });
        expect(report.actualCost).toBe(0);
        expect(report.estimatedParserFee).toBeCloseTo(0.004);
        expect(report.spendTotal).toBeCloseTo(0.004);
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('a live run retains the response but stops when provider cost is unknown', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-unknown-cost-'));
    const first = jest.fn().mockResolvedValue({ text: 'answer', cost: null, costIncomplete: true, errors: [], pages: 1, parsed: extractionJson, json: { valid: true, truncated: false }, groundingText: '' });
    const next = jest.fn();
    try {
        const report = await execute({
            args: { 'max-cost': 1 },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir,
            dryRun: false,
            registry: { 'local-text': first, 'or-cloudflare': next, 'or-mistral-ocr': next, 'or-native': next },
        });
        expect(report.aborted).toMatchObject({ reason: 'cost-unknown' });
        expect(report.rows.filter((row) => row.status !== 'SKIPPED')).toHaveLength(1);
        expect(report.rows[0]).toMatchObject({ cost: null, costIncomplete: true });
        expect(report.costMissingCalls).toBe(1);
        expect(report.actualCost).toBe(0);
        expect(next).not.toHaveBeenCalled();
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('a definitive file-parser rejection is retained and the benchmark continues to later cells', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-parser-rejection-'));
    const arm = jest.fn()
        .mockResolvedValueOnce({
            text: '', parserText: '', groundingText: '', cost: null, costIncomplete: true,
            requestRejection: 'pdf-parser-size-limit', httpStatus: 400, failedCall: true,
            errors: ['The file exceeds the maximum size supported by the file parser.'],
            pages: 1, parsed: null, json: { valid: false, truncated: false },
        })
        .mockResolvedValueOnce({
            text: 'answer', parserText: '', groundingText: '', cost: 0.02, costIncomplete: false,
            errors: [], pages: 1, parsed: extractionJson, json: { valid: true, truncated: false },
        });
    try {
        const report = await execute({
            args: { scope: 'smoke', arms: ['local-text'], repeats: 2, concurrency: 1, 'max-cost': 1 },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir,
            dryRun: false,
            registry: { 'local-text': arm },
        });
        expect(arm).toHaveBeenCalledTimes(2);
        expect(report.aborted).toBeNull();
        expect(report.rows.filter((row) => row.status !== 'SKIPPED')).toHaveLength(2);
        expect(report.rows[0]).toMatchObject({
            requestRejection: 'pdf-parser-size-limit',
            httpStatus: 400,
            failedCall: true,
            cost: null,
            costIncomplete: true,
        });
        expect(report.costMissingCalls).toBe(1);
        expect(report.actualCost).toBeCloseTo(0.02);
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('a parser size rejection runs the classified local fallback without merging it into parser results', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-parser-fallback-'));
    const rejected = jest.fn().mockResolvedValue({
        text: '', parserText: '', groundingText: '', cost: null, costIncomplete: true,
        requestRejection: 'pdf-parser-size-limit', httpStatus: 400, failedCall: true,
        errors: ['The file exceeds the maximum size supported by the file parser.'],
        pages: 1, parsed: null, json: { valid: false, truncated: false },
    });
    const localTextFallback = jest.fn().mockResolvedValue({
        text: 'local text answer', parserText: '', groundingText: 'source text',
        cost: 0.02, costIncomplete: false, latency: 7, provider: 'mock',
        errors: [], pages: 1, parsed: extractionJson, json: { valid: true, truncated: false },
    });
    try {
        const report = await execute({
            args: { scope: 'smoke', arms: ['or-cloudflare'], 'max-cost': 1, 'parser-recovery': 'off' },
            documents: [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }],
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': { fileNative: false, imageInput: false } },
            outputDir,
            dryRun: false,
            registry: { 'or-cloudflare': rejected, 'local-text': localTextFallback },
        });

        expect(localTextFallback).toHaveBeenCalledTimes(1);
        expect(localTextFallback.mock.calls[0][2].label).toMatch(/fallback local-text/);
        expect(report.rows).toHaveLength(1);
        expect(report.rows[0]).toMatchObject({ arm: 'or-cloudflare', failedCall: true, requestRejection: 'pdf-parser-size-limit', parsed: null });
        expect(report.fallbacks).toEqual([expect.objectContaining({
            sourceArm: 'or-cloudflare', arm: 'local-text', status: 'completed',
            cost: 0.02, parsed: extractionJson, json: { valid: true, truncated: false },
        })]);
        expect(report.summary.map((row) => row.arm)).toEqual(['or-cloudflare']);
        expect(report.parserMetrics[0]).toMatchObject({ arm: 'or-cloudflare', empty: true });
        expect(report.actualCost).toBeCloseTo(0.02);
        expect(report.costMissingCalls).toBe(1);
        expect(report.aborted).toBeNull();
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('a rejected Mistral file-parser request does not accrue an estimated OCR page fee', async () => {
    const { runPdfAnalysis } = require('../scripts/lib/arms');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-parser-rejection-fee-'));
    const filePath = path.join(dir, 'doc.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4 stub');
    const fetchImpl = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
            error: { message: 'Failed to parse the file: The file exceeds the maximum size supported by the file parser.' },
        }),
    });
    try {
        const result = await runPdfAnalysis('mistral-ocr', 'x/y', { filePath, pages: 11 }, {
            requestOptions: { apiKey: 'mock', fetchImpl },
            mistralPageRate: 2,
            parserRecovery: 'off',
            analysisMode: 'single',
        });
        expect(result).toMatchObject({
            requestRejection: 'pdf-parser-size-limit',
            httpStatus: 400,
            cost: null,
            costIncomplete: true,
            estimatedParserFee: 0,
            parserFeeEstimateUsd: 0,
            failedCall: true,
        });
        expect(summarizeExtractionRows([{ ...result, arm: 'or-mistral-ocr', model: 'x/y', documentType: 'text-layer' }])[0].answered).toBe(0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('the OpenRouter arm is one request: PDF + analysis prompt + pinned engine + production output cap', async () => {
    const { runPdfAnalysis } = require('../scripts/lib/arms');
    const fetchImpl = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
            provider: 'Cloudflare',
            choices: [{
                message: {
                    content: JSON.stringify(extractionJson),
                    annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'parsed body from the engine' }] } }],
                },
            }],
            usage: { cost: 0.02, prompt_tokens: 100 },
        }),
    });
    const temp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-oneshot-')), 'doc.pdf');
    fs.writeFileSync(temp, '%PDF-1.4 stub');
    try {
        const result = await runPdfAnalysis('cloudflare-ai', 'z-ai/glm-5.3-flash', { filePath: temp, pages: 2 }, {
            requestOptions: { apiKey: 'mock', fetchImpl },
            provider: { allow_fallbacks: false },
            mistralPageRate: 2,
        });
        const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
        expect(body.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }]);
        expect(body.max_tokens).toBe(16384);
        expect(body.messages[0].content[0].text).toMatch(/extract key information as a JSON object/i);
        expect(body.messages[0].content[1].type).toBe('file');
        expect(result.parsed.caseNumber).toBe('St-2/2013');
        expect(result.parserText).toBe('parsed body from the engine');
        expect(result.groundingText).toBe('parsed body from the engine');
        expect(result.cost).toBe(0.02);
        expect(result.json.valid).toBe(true);
    } finally {
        fs.rmSync(path.dirname(temp), { recursive: true, force: true });
    }
});

test('the free pdf.js control is skipped, never scored, on an image-only document', async () => {
    const { runTextAnalysis } = require('../scripts/lib/arms');
    const { loadDocuments } = require('../scripts/benchmark-pdf-engines');
    const [doc] = loadDocuments({ 'doc-id': ['6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf'] });
    const fetchImpl = jest.fn();
    const result = await runTextAnalysis('x/y', doc, { requestOptions: { apiKey: 'mock', fetchImpl } });
    expect(result.skipped).toBe('no-text-layer');
    expect(fetchImpl).not.toHaveBeenCalled();
});

test('the baseline model runs only its production arm; the challenger runs every input path', () => {
    const { analysisArmsForModel } = require('../scripts/lib/arms');
    const baseline = analysisArmsForModel('google/gemini-2.5-flash', { baselineModel: 'google/gemini-2.5-flash' });
    expect(baseline.map((arm) => arm.id)).toEqual(['or-native']);
    const challenger = analysisArmsForModel('z-ai/glm-5.3-flash', { baselineModel: 'google/gemini-2.5-flash' });
    expect(challenger.map((arm) => arm.id)).toEqual(['local-text', 'local-raster', 'or-cloudflare', 'or-mistral-ocr']);
});

test('dry-run estimate charges Mistral pages once and adds a completion estimate per cell', () => {
    const { estimateRunCost } = require('../scripts/benchmark-pdf-engines');
    const estimate = estimateRunCost({
        models: ['z-ai/glm-5.3-flash', 'google/gemini-2.5-flash'],
        pages: [2, 1, 2],
        repeats: 1,
        args: { baseline: 'google/gemini-2.5-flash' },
    });
    expect(estimate.parserUsd).toBeCloseTo(5 * 2 / 1000);
    expect(estimate.analysisUsd).toBeGreaterThan(0);
    expect(estimate.totalUsd).toBeCloseTo(estimate.parserUsd + estimate.analysisUsd);
    expect(estimate.perModel['google/gemini-2.5-flash']).toBeGreaterThan(0);
});

test('unusable JSON is a model failure, so it counts as answered but invalid', () => {
    const [cell] = summarizeExtractionRows([{
        arm: 'or-mistral-ocr', model: 'x/y', documentType: 'text-layer / 1-2 / other',
        json: { valid: false, truncated: true }, errors: ['Invalid JSON or truncation'], failedCall: false,
        quoteGroundingOwn: null, goldAccuracy: null,
    }]);
    expect(cell).toMatchObject({ N: 1, answered: 1, errors: 0, validJson: 0, validRate: 0 });
});

test('reasoning is an explicit, validated condition instead of a silent default', () => {
    expect(parseReasoningArg(undefined)).toBeNull();
    expect(parseReasoningArg('default')).toBeNull();
    expect(parseReasoningArg('provider')).toBeNull();
    expect(parseReasoningArg('off')).toEqual({ enabled: false });
    expect(parseReasoningArg('LOW')).toEqual({ effort: 'low' });
    expect(parseReasoningArg('high')).toEqual({ effort: 'high' });
    expect(() => parseReasoningArg('maximum')).toThrow(/--reasoning expects/);
});

test('a reasoning model gets its own token headroom so the answer keeps the production budget', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-reasoning-budget-'));
    const seen = [];
    const arm = (name) => jest.fn(async (model, doc, context) => {
        seen.push({ name, context });
        return { text: '{}', cost: 0.001, latency: 1, provider: 'mock', errors: [], pages: 1, parsed: {}, json: { valid: true, truncated: false }, groundingText: '' };
    });
    const documents = [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }];
    const models = ['x/y'];
    const capabilitiesByModel = { 'x/y': { fileNative: true, imageInput: true } };
    try {
        // Provider default: no reasoning block and no extra headroom.
        await execute({
            args: { scope: 'smoke', 'max-cost': 1 },
            documents, models, capabilitiesByModel, outputDir, dryRun: false,
            registry: { 'local-text': arm('text'), 'or-cloudflare': arm('cf'), 'or-mistral-ocr': arm('mistral'), 'or-native': arm('native') },
        });
        expect(seen.every((item) => item.context.reasoning === null)).toBe(true);
        expect(seen.every((item) => item.context.analysisMaxTokens === 16384)).toBe(true);

        seen.length = 0;
        await execute({
            args: { scope: 'smoke', 'max-cost': 1, reasoning: 'low', 'reasoning-tokens': 4096 },
            documents, models, capabilitiesByModel, outputDir, dryRun: false,
            registry: { 'local-text': arm('text'), 'or-cloudflare': arm('cf'), 'or-mistral-ocr': arm('mistral'), 'or-native': arm('native') },
        });
        expect(seen.every((item) => item.context.reasoning)).toEqual(true);
        expect(seen[0].context.reasoning).toEqual({ effort: 'low' });
        // Answer budget stays at production size; reasoning is additional.
        expect(seen.every((item) => item.context.analysisMaxTokens === 16384 + 4096)).toBe(true);
        expect(seen[0].context.analysisAnswerTokens).toBe(16384);
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('the dry-run estimate includes reasoning tokens as billable completion', () => {
    const base = { models: ['z-ai/glm-5.3-flash'], pages: [2, 1, 2], repeats: 1, args: { baseline: 'google/gemini-2.5-flash' } };
    const withoutReasoning = estimateRunCost({ ...base, args: { ...base.args, reasoning: 'off' } });
    const withReasoning = estimateRunCost({ ...base, args: { ...base.args, reasoning: 'low', 'reasoning-tokens': 8192 } });
    expect(withReasoning.analysisUsd).toBeGreaterThan(withoutReasoning.analysisUsd);
});

test('--arms narrows the matrix so one cell can be re-run as a diagnostic', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-arms-filter-'));
    const arm = jest.fn(async () => ({ text: '{}', cost: 0.001, latency: 1, provider: 'mock', errors: [], pages: 1, parsed: {}, json: { valid: true, truncated: false }, groundingText: '' }));
    const documents = [{ docId: 'd1', title: 'Doc', filePath: '/tmp/x.pdf', pages: 1, textLayer: true, pageBucket: '1-2', tableHeavy: false }];
    const capabilitiesByModel = { 'x/y': { fileNative: true, imageInput: true } };
    const registry = { 'local-text': arm, 'or-cloudflare': arm, 'or-mistral-ocr': arm, 'or-native': arm };
    try {
        const report = await execute({
            args: { scope: 'smoke', 'max-cost': 1, arms: ['local-text'] },
            documents, models: ['x/y'], capabilitiesByModel, outputDir, dryRun: false, registry,
        });
        expect(arm).toHaveBeenCalledTimes(1);
        expect(report.rows.map((row) => row.arm)).toEqual(['local-text']);

        await expect(execute({
            args: { scope: 'smoke', 'max-cost': 1, arms: ['nope'] },
            documents, models: ['x/y'], capabilitiesByModel, outputDir, dryRun: true,
            registry,
        })).rejects.toThrow(/--arms: unknown arm/);
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
});

test('reasoning can be set per model, so the baseline keeps its production default', () => {
    const { resolveReasoningByModel } = require('../scripts/benchmark-pdf-engines');
    const models = ['z-ai/glm-5.3-flash', 'google/gemini-2.5-flash'];
    const baseline = 'google/gemini-2.5-flash';

    const globalOnly = resolveReasoningByModel({ reasoning: ['low'] }, models, { baseline });
    expect(globalOnly.byModel['z-ai/glm-5.3-flash']).toEqual({ effort: 'low' });
    expect(globalOnly.byModel[baseline]).toEqual({ effort: 'low' });
    expect(globalOnly.overridesBaseline).toBe(false);

    const protectedBaseline = resolveReasoningByModel(
        { reasoning: ['low', `${baseline}:default`] },
        models,
        { baseline },
    );
    expect(protectedBaseline.byModel['z-ai/glm-5.3-flash']).toEqual({ effort: 'low' });
    expect(protectedBaseline.byModel[baseline]).toBeNull();
    expect(protectedBaseline.overridesBaseline).toBe(true);

    const challengerOff = resolveReasoningByModel({ reasoning: ['z-ai/glm-5.3-flash:off'] }, models, { baseline });
    expect(challengerOff.byModel['z-ai/glm-5.3-flash']).toEqual({ enabled: false });
    expect(challengerOff.byModel[baseline]).toBeNull();

    expect(() => resolveReasoningByModel({ reasoning: ['not-a-model:low'] }, models, { baseline })).toThrow(/not in this run/);
});

test('raster stamps each page header once, instead of stacking it on the model header', () => {
    const { pageBody } = require('../scripts/lib/arms');
    // The model is told to open with a header, and this arm sends one image per
    // request — so its header always says 1 and must not survive the wrap.
    expect(pageBody('=== STRANICA 1 ===\nODVJETNIK ANTE KUKOČ')).toBe('ODVJETNIK ANTE KUKOČ');
    expect(pageBody('=== STRANICA 1 === ODVJETNIK ANTE KUKOČ')).toBe('ODVJETNIK ANTE KUKOČ');
    // A model that mislabels the page (it only ever sees one image) is still
    // reduced to plain body text.
    expect(pageBody('=== STRANICA 2 ===\nRJEŠENJE')).toBe('RJEŠENJE');
    // No header at all: the text is kept verbatim.
    expect(pageBody('RJEŠENJE\nTRGOVAČKI SUD')).toBe('RJEŠENJE\nTRGOVAČKI SUD');
    // Repeated headers (the old double-stamp) leave nothing behind.
    expect(pageBody('=== STRANICA 1 ===\nA\n=== STRANICA 2 ===\nB')).toBe('A\n\nB');
});

test('a two-page raster cell counts one header per page, not four', () => {
    const { pageBody } = require('../scripts/lib/arms');
    // This is the shape that produced markers [1,1,2,1] on 1:Podnesak.pdf: the
    // model header plus the harness wrapper, for each of two pages.
    const modelReplies = ['=== STRANICA 1 ===\nprva stranica', '=== STRANICA 1 ===\ndruga stranica'];
    const text = modelReplies
        .map((reply, index) => {
            const body = pageBody(reply);
            return body ? `=== STRANICA ${index + 1} ===\n${body}` : '';
        })
        .filter(Boolean)
        .join('\n\n');
    const markers = [...text.matchAll(/===\s*STRANICA\s+(\d+)\s*===/g)].map((m) => Number(m[1]));
    expect(markers).toEqual([1, 2]);
    expect(text).toContain('druga stranica');
});

async function rasterResult(replies, inspect) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-raster-accounting-'));
    const filePath = path.join(dir, 'scan.pdf');
    fs.writeFileSync(filePath, '%PDF stub');
    const pdf = { numPages: 2, getPage: jest.fn().mockResolvedValue({}), destroy: jest.fn().mockResolvedValue() };
    jest.doMock('pdfjs-dist/legacy/build/pdf.js', () => ({
        GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(pdf) }),
    }));
    jest.doMock('../court-analysis/agents/analysis-agent', () => ({
        ...jest.requireActual('../court-analysis/agents/analysis-agent'),
        renderPageToJpeg: jest.fn().mockResolvedValue(Buffer.from('page')),
    }));
    let runRasterAnalysis;
    jest.isolateModules(() => { ({ runRasterAnalysis } = require('../scripts/lib/arms')); });
    const fetchImpl = jest.fn();
    for (const reply of replies) fetchImpl.mockResolvedValueOnce({
        ok: true, status: 200, text: async () => JSON.stringify(reply),
    });
    try {
        const result = await runRasterAnalysis('x/y', { filePath, pages: 2 }, {
            requestOptions: { apiKey: 'mock', fetchImpl, maxRetries: 0 },
        });
        await inspect(result, fetchImpl);
    } finally {
        jest.dontMock('pdfjs-dist/legacy/build/pdf.js');
        jest.dontMock('../court-analysis/agents/analysis-agent');
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const rasterReply = (content, usage) => ({ choices: [{ message: { content } }], usage, provider: 'mock' });

test('raster analysis sums OCR and final-analysis tokens including reasoning details', async () => {
    await rasterResult([
        rasterReply('page one', { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, cost: 0.01, completion_tokens_details: { reasoning_tokens: 1 } }),
        rasterReply('page two', { prompt_tokens: 20, completion_tokens: 3, total_tokens: 23, cost: 0.02, completion_tokens_details: { reasoning_tokens: 2 } }),
        rasterReply(JSON.stringify(extractionJson), { prompt_tokens: 30, completion_tokens: 4, total_tokens: 34, cost: 0.03, completion_tokens_details: { reasoning_tokens: 3 } }),
    ], (result, fetchImpl) => {
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        expect(result.usage).toMatchObject({ prompt_tokens: 60, completion_tokens: 9, total_tokens: 69, completion_tokens_details: { reasoning_tokens: 6 } });
        expect(result.cost).toBeCloseTo(0.06);
        expect(result.costIncomplete).toBe(false);
        expect(result.errors).toEqual([]);
    });
});

test('raster analysis retains partial OCR failures and their costs after successful analysis', async () => {
    await rasterResult([
        { error: { message: 'page provider failed' }, usage: { total_tokens: 5, cost: 0.01 } },
        rasterReply('page two', { total_tokens: 10, cost: 0.02 }),
        rasterReply(JSON.stringify(extractionJson), { total_tokens: 15, cost: 0.03 }),
    ], (result) => {
        expect(result.errors).toEqual([{ message: 'page provider failed' }]);
        expect(result.failedCall).toBe(false);
        expect(result.json.valid).toBe(true);
        expect(result.usage.total_tokens).toBe(30);
        expect(result.cost).toBeCloseTo(0.06);
        expect(result.groundingText).not.toContain('STRANICA 1');
    });
});

test('empty attempted raster is a costed failure, not a skipped arm', async () => {
    await rasterResult([
        rasterReply('=== STRANICA 1 ===', { total_tokens: 5, cost: 0.01 }),
        { error: { message: 'OCR failed' }, usage: { total_tokens: 10, cost: 0.02 } },
    ], (result, fetchImpl) => {
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(result.skipped).toBeUndefined();
        expect(result.failedCall).toBe(true);
        expect(result.errors).toContainEqual({ message: 'OCR failed' });
        expect(result.cost).toBeCloseTo(0.03);
        expect(result.usage.total_tokens).toBe(15);
        const [reliability] = require('../scripts/benchmark-pdf-engines').summarizeRows([{ ...result, arm: 'local-raster', model: 'x/y', documentType: 'scan' }]);
        expect(reliability).toMatchObject({ N: 1, errors: 1, errorRate: 1, reportedCostCells: 1 });
        expect(reliability.costPerCell).toBeCloseTo(0.03);
    });
});

test('raster stops before another page or analysis when OCR cost is unknown', async () => {
    await rasterResult([
        rasterReply('page one', { total_tokens: 5 }),
    ], (result, fetchImpl) => {
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(result.cost).toBeNull();
        expect(result.costIncomplete).toBe(true);
        expect(result.failedCall).toBe(true);
    });
});

test('cost summaries exclude unknown and partial subtotals while retaining reliability', () => {
    const { summarizeRows } = require('../scripts/benchmark-pdf-engines');
    const base = { arm: 'local-raster', model: 'x/y', documentType: 'scan', pages: 2, latency: 10 };
    const [summary] = summarizeRows([
        { ...base, cost: 0.2, errors: [] },
        { ...base, cost: 0.01, costIncomplete: true, errors: ['OCR page failed'] },
        { ...base, cost: null, costIncomplete: true, errors: ['No OCR text'] },
        { ...base, status: 'SKIPPED', reason: 'unsupported' },
    ]);
    expect(summary).toMatchObject({ N: 3, errors: 2, reportedCostCells: 1, incompleteCostCells: 2, costPerCell: 0.2, costPerPage: 0.1 });
    const [unknown] = summarizeRows([{ ...base, cost: 0, costIncomplete: true }]);
    expect(unknown).toMatchObject({ reportedCostCells: 0, costPerCell: null, costPerPage: null });
});

test('raster retains a reported cost subtotal without treating unreported analysis as free', async () => {
    await rasterResult([
        rasterReply('page one', { total_tokens: 5, cost: 0.01 }),
        rasterReply('page two', { total_tokens: 10, cost: 0.02 }),
        rasterReply('{}', { total_tokens: 15 }),
    ], (result) => {
        expect(result.cost).toBeCloseTo(0.03);
        expect(result.costIncomplete).toBe(true);
        expect(result.usage.total_tokens).toBe(30);
        const [summary] = require('../scripts/benchmark-pdf-engines').summarizeRows([{
            ...result, arm: 'local-raster', model: 'x/y', documentType: 'scan',
        }]);
        expect(summary).toMatchObject({ N: 1, reportedCostCells: 0, incompleteCostCells: 1, costPerCell: null });
    });
});

test('partial request failure with a valid answer keeps JSON rates bounded and reliability separate', () => {
    const base = { arm: 'local-raster', model: 'x/y', documentType: 'scan' };
    const [summary] = summarizeExtractionRows([
        { ...base, failedCall: true, errors: ['OCR page failed'], json: { valid: true, truncated: false } },
        { ...base, failedCall: false, errors: [], json: { valid: true, truncated: false } },
        { ...base, failedCall: true, errors: ['Provider failed'], textLength: 0, json: { valid: false, truncated: false } },
    ]);
    expect(summary).toMatchObject({ N: 3, errors: 2, answered: 2, validJson: 2, validRate: 1 });
});

test('cost-over-cap previews return a plan indicator while live execution remains blocked', () => {
    const { assertEstimatedCostCap } = require('../scripts/benchmark-pdf-engines');
    expect(assertEstimatedCostCap(1.5, 0.75, true)).toBe(true);
    expect(assertEstimatedCostCap(0.5, 0.75, true)).toBe(false);
    expect(assertEstimatedCostCap(0.75, 0.75, false)).toBe(false);
    expect(() => assertEstimatedCostCap(1.5, 0.75, false)).toThrow(/Estimated run cost exceeds cap/);
});

test('only an explicit estimate bypass permits an over-cap live plan without hiding the overage', () => {
    const { assertEstimatedCostCap } = require('../scripts/benchmark-pdf-engines');
    expect(assertEstimatedCostCap(30.66, 7, false, true)).toBe(true);
    expect(() => assertEstimatedCostCap(30.66, 7, false, 'false')).toThrow(/Estimated run cost exceeds cap/);
});
