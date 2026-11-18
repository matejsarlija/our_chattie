'use strict';

const { PDFDocument } = require('pdf-lib');
const { recoverPdfAnalysis } = require('../scripts/lib/pdf-parser-recovery');

async function fixture(pages = 4, padded = true) {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < pages; i += 1) pdf.addPage([300, 400]);
    const bytes = Buffer.from(await pdf.save());
    // A PDF comment is valid source data and makes pdf-lib's lossless rewrite smaller.
    return padded ? Buffer.concat([bytes, Buffer.from(`\n%${'x'.repeat(8192)}\n`)]) : bytes;
}
function parsed(text, cost = 0.01) {
    return { response: { choices: [{ message: { content: 'OK', annotations: [{ file: { content: [{ type: 'text', text }] } }] } }] }, cost, usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }, latencyMs: 5 };
}
function rejected() { return { requestRejection: 'pdf-parser-size-limit', status: 400, cost: null, error: { message: 'size' } }; }
const successAnalysis = () => ({ response: { choices: [{ message: { content: '{"ok":true}' } }] }, cost: 0.02, usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }, latencyMs: 7 });

test('adaptive bisection preserves original ranges and sends one ordered full transcript for analysis', async () => {
    const originalBytes = await fixture();
    const seen = [];
    const result = await recoverPdfAnalysis({ engine: 'cloudflare-ai', model: 'x/y', doc: { pages: 4 }, originalBytes,
        requestPdf: async (_bytes, options) => {
            seen.push(options);
            if (options.phase === 'rewrite' || (options.firstPage === 1 && options.lastPage === 4)) return rejected();
            if (options.firstPage === 1 && options.lastPage === 2) return rejected();
            if (options.firstPage === 1) return parsed('page one');
            if (options.firstPage === 2) return parsed('page two');
            if (options.firstPage === 3) return parsed('page three');
            return parsed('page four');
        },
        requestAnalysis: async (text) => { seen.push(text); return successAnalysis(); },
    });
    expect(result.recovery).toMatchObject({ mode: 'chunked', status: 'completed', originalBytes: originalBytes.length, chunks: [
        { firstPage: 1, lastPage: 1 }, { firstPage: 2, lastPage: 2 }, { firstPage: 3, lastPage: 4 },
    ] });
    expect(result.parserText).toBe('[Original pages 1-1]\npage one\n[Original pages 2-2]\npage two\n[Original pages 3-4]\npage three');
    expect(seen.at(-1)).toBe(result.parserText);
    expect(seen.filter((entry) => typeof entry === 'string')).toHaveLength(1);
    expect(result.result.cost).toBeCloseTo(0.05);
    expect(result.result.usage.total_tokens).toBe(15);
    expect(originalBytes.length).toBeGreaterThan(result.recovery.rewrittenBytes);
});

test('single-page size rejection fails explicitly without analysis', async () => {
    const originalBytes = await fixture(1);
    const requestPdf = jest.fn(async () => rejected());
    const requestAnalysis = jest.fn();
    const result = await recoverPdfAnalysis({ engine: 'cloudflare-ai', model: 'x/y', doc: { pages: 1 }, originalBytes, requestPdf, requestAnalysis });
    expect(result.recovery).toMatchObject({ mode: 'chunked', status: 'failed' });
    expect(result.recovery.error).toMatch(/page 1.*without downsampling/i);
    expect(requestAnalysis).not.toHaveBeenCalled();
    expect(result.result.cost).toBe(0);
});

test('unknown-cost request stops without further parser or analysis requests', async () => {
    const originalBytes = await fixture(3);
    let calls = 0;
    const result = await recoverPdfAnalysis({ engine: 'cloudflare-ai', model: 'x/y', doc: { pages: 3 }, originalBytes,
        requestPdf: async () => { calls += 1; return { error: { message: 'connection lost' }, cost: null }; },
        requestAnalysis: jest.fn(),
    });
    expect(calls).toBe(1);
    expect(result.result.costIncomplete).toBe(true);
    expect(result.recovery.status).toBe('failed');
});

test('a cap callback stopping after a parser request prevents the next paid request', async () => {
    const originalBytes = await fixture(3);
    const calls = [];
    const result = await recoverPdfAnalysis({ engine: 'cloudflare-ai', model: 'x/y', doc: { pages: 3 }, originalBytes,
        context: { beforeRequest: () => true, recordRequest: () => false },
        requestPdf: async (_bytes, options) => { calls.push(options); return rejected(); },
        requestAnalysis: jest.fn(),
    });
    expect(calls).toHaveLength(1);
    expect(result.recovery.requests).toHaveLength(1);
});

test('smaller lossless rewrite succeeds and preserves the source buffer', async () => {
    const originalBytes = await fixture(2);
    const copy = Buffer.from(originalBytes);
    let sentBytes;
    const result = await recoverPdfAnalysis({ engine: 'cloudflare-ai', model: 'x/y', doc: { pages: 2 }, originalBytes,
        requestPdf: async (bytes, options) => { sentBytes = Buffer.from(bytes); expect(options).toMatchObject({ phase: 'rewrite', transcribe: false }); return parsed('all pages'); },
        requestAnalysis: jest.fn(),
    });
    expect(result.recovery).toMatchObject({ mode: 'rewritten', status: 'completed', rewrittenBytes: sentBytes.length });
    expect(sentBytes.length).toBeLessThan(originalBytes.length);
    expect(originalBytes.equals(copy)).toBe(true);
    expect(result.parserText).toBe('all pages');
});

test('Mistral recovery retains known spend and estimates only the missing page fee after a partial failure', async () => {
    const originalBytes = await fixture(2);
    const record = jest.fn(() => true);
    let accepted = 0;
    const requestAnalysis = jest.fn();
    const result = await recoverPdfAnalysis({
        engine: 'mistral-ocr', model: 'x/y', doc: { pages: 2 }, originalBytes,
        context: { recordRequest: record },
        requestPdf: async (_bytes, options) => {
            if (options.phase === 'rewrite') return rejected();
            accepted++;
            return accepted === 1 ? parsed('first page', 0.01) : { cost: null, error: 'response disconnected' };
        },
        requestAnalysis,
    });
    expect(result.result.cost).toBeCloseTo(0.01);
    expect(result.result.costIncomplete).toBe(true);
    expect(result.estimatedParserFee).toBeCloseTo(0.002);
    expect(record.mock.calls.map(([, estimate]) => estimate)).toEqual([0, 0, 0.002]);
    expect(requestAnalysis).not.toHaveBeenCalled();
});
