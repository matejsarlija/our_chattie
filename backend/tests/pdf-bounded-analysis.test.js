const { EventEmitter } = require('node:events');
const { registerPartialReportHandlers } = require('../scripts/benchmark-pdf-engines');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { splitTextIntoChunks } = require('../court-analysis/reasoning/retrieval/chunker');
const { shouldBoundAnalysis, runBoundedAnalysis: runBoundedAnalysisWithCache, checkpointKey, DEFAULT_CHECKPOINT_DIR } = require('../scripts/lib/bounded-analysis');

const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-bounded-analysis-'));
const runBoundedAnalysis = options => runBoundedAnalysisWithCache({
    ...options,
    context: {
        ...options.context,
        checkpointDir: options.context?.checkpointDir || checkpointDir,
        noCache: options.context?.noCache ?? true,
    },
});
afterAll(() => fs.rmSync(checkpointDir, { recursive: true, force: true }));

const json = value => ({ response:{ choices:[{message:{content:JSON.stringify(value)}}]}, cost:0.01, usage:{input_tokens:10}, status:200, latencyMs:5 });

describe('bounded analysis', () => {
    it('covers dense text with original chunk offsets and merges all facts', async () => {
        const text = 'A'.repeat(13000);
        const calls = [];
        const result = await runBoundedAnalysis({ doc:{id:'dense'}, context:{}, sourceText:text,
            requestText: async (chunk, segment) => { calls.push({chunk, segment}); return json({amounts:[{quote:'fact '+segment.startIndex, amount:1}]}); } });
        expect(result.analysisSegmentation.status).toBe('completed');
        expect(calls[0].segment.startIndex).toBe(0);
        expect(calls.at(-1).segment.endIndex).toBe(text.length);
        expect(result.analysisSegmentation.segments.every(s => s.status === 'completed')).toBe(true);
        expect(JSON.parse(result.response.choices[0].message.content).amounts).toHaveLength(calls.length);
        expect(result.cost).toBeCloseTo(calls.length * 0.01);
    });

    it('chunks text only and preserves source page ranges', async () => {
        const text = 'x'.repeat(5000);
        const calls = [];
        const result = await runBoundedAnalysis({
            doc: { docId: 'text-only' },
            sourceText: text,
            pageRanges: [{ pageNumber: 1, startIndex: 0, endIndex: 3000 }, { pageNumber: 2, startIndex: 3000, endIndex: 5000 }],
            requestText: async (chunk, segment) => {
                calls.push({ chunk, segment });
                return json({ summary: segment.id });
            },
        });
        expect(calls.length).toBeGreaterThan(1);
        expect(calls[0].segment.startIndex).toBe(0);
        expect(calls.at(-1).segment.endIndex).toBe(text.length);
        expect(calls[0].segment.pageNumbers).toContain(1);
        expect(calls.at(-1).segment.pageNumbers).toContain(2);
        expect(result.analysisSegmentation.kind).toBe('text');
        expect(result.analysisSegmentation.status).toBe('completed');
    });

    it('rejects malformed and truncated output without an aggregate', async () => {
        const malformed = json({});
        malformed.response.choices[0].message.content = '{"x":';
        for (const raw of [malformed, {...json({}),finish_reason:'length'}]) {
            const result = await runBoundedAnalysis({doc:{},context:{},sourceText:'short',requestText:async()=>raw});
            expect(result.response).toBeNull();
            expect(result.analysisSegmentation.status).toBe('failed');
        }
    });

    it('halts after an unknown-cost failure and retains known subtotal', async () => {
        let calls=0;
        const result = await runBoundedAnalysis({doc:{},context:{},sourceText:'x'.repeat(8000),
            requestText:async()=>{ calls++; if(calls===1) return {...json({}),cost:0.2}; const e=new Error('timeout'); e.rawResult={cost:null,status:504}; throw e; } });
        expect(calls).toBe(2);
        expect(result.cost).toBeCloseTo(0.2);
        expect(result.costIncomplete).toBe(true);
        expect(result.response).not.toBeNull();
        expect(result.analysisSegmentation.status).toBe('partial');
        expect(result.analysisSegmentation.requests[1].rawText).toBe('');
    });

    it('stops after intermediate cap breach but retains a fully completed final result', async () => {
        let calls=0;
        const opts={doc:{},context:{recordRequest:()=>false},sourceText:'x'.repeat(8000),requestText:async()=>{calls++;return {...json({summary:'ok'}),cost:0.02};}};
        const stopped=await runBoundedAnalysis(opts);
        expect(stopped.response).not.toBeNull();
        expect(stopped.analysisSegmentation.status).toBe('partial');
        expect(calls).toBe(1);
        const final=await runBoundedAnalysis({...opts,sourceText:'small'});
        expect(final.response).not.toBeNull();
        expect(final.usage.input_tokens).toBe(10);
    });
});

test('bounded merging removes overlap duplicates but preserves equal facts in distinct source ranges', async () => {
    const chars = Array(13000).fill('x');
    const overlapQuote = 'OVERLAP_EUR17';
    const repeatedQuote = 'DISTINCT_EUR29';
    for (const [offset, quote] of [[3200, overlapQuote], [100, repeatedQuote], [9000, repeatedQuote]]) chars.splice(offset, quote.length, ...quote);
    const sourceText = chars.join('');
    const result = await runBoundedAnalysis({
        doc: { docId: 'source' }, sourceText,
        requestText: async text => json({
            amounts: [
                ...(text.includes(overlapQuote) ? [{ amount: 17, quote: overlapQuote }] : []),
                ...(text.includes(repeatedQuote) ? [{ amount: 29, quote: repeatedQuote }] : []),
            ],
        }),
    });
    const merged = JSON.parse(result.response.choices[0].message.content);
    expect(merged.amounts.filter(fact => fact.amount === 17)).toHaveLength(1);
    const repeated = merged.amounts.filter(fact => fact.amount === 29);
    expect(repeated).toHaveLength(2);
    expect(repeated[0].sourceEndIndex).toBeLessThan(repeated[1].sourceStartIndex);
});

test('single analysis mode takes precedence over dense/long workload detection', () => {
    const doc = { pages: 12, tableHeavy: true };
    expect(shouldBoundAnalysis(doc, { analysisMode: 'single' }, 'x'.repeat(13000))).toBe(false);
    expect(shouldBoundAnalysis(doc, { analysisMode: 'bounded' }, 'x'.repeat(13000))).toBe(true);
});

test('checkpoints each parsed segment and resumes without a request or cost', async () => {
    const options = {
        doc: { docId: 'checkpoint-doc' },
        model: 'vendor/model',
        context: { checkpointDir, promptHash: 'prompt-v1', checkpointOptions: { max_tokens: 20 }, noCache: false },
        sourceText: 'checkpoint fixture',
        requestText: jest.fn(async () => json({ summary: 'saved' })),
    };
    const first = await runBoundedAnalysis(options);
    expect(options.requestText).toHaveBeenCalledTimes(1);
    const resumed = await runBoundedAnalysis(options);
    expect(options.requestText).toHaveBeenCalledTimes(1);
    expect(resumed.cost).toBe(0);
    expect(resumed.analysisSegmentation.requests[0]).toMatchObject({
        status: 'checkpoint: hit',
        checkpoint: 'hit',
        rawText: '{"summary":"saved"}',
    });
    expect(JSON.parse(first.response.choices[0].message.content).summary).toBe('saved');
    const chunk = splitTextIntoChunks(options.sourceText, { chunkSize: 3500, chunkOverlap: 350, docId: 'checkpoint-doc' })[0];
    const segment = { id: chunk.id, text: chunk.text };
    const expectedKey = crypto.createHash('sha256')
        .update(`${segment.id}:${segment.text}:vendor/model:prompt-v1:${JSON.stringify({ max_tokens: 20 })}`)
        .digest('hex');
    expect(checkpointKey(segment, 'vendor/model', 'prompt-v1', { max_tokens: 20 })).toBe(expectedKey);
    expect(fs.existsSync(path.join(checkpointDir, `${expectedKey}.json`))).toBe(true);
    expect(DEFAULT_CHECKPOINT_DIR).toBe(path.resolve(__dirname, '../data/pdf-engine-bench/checkpoints'));
    const forced = await runBoundedAnalysis({
        ...options,
        context: { ...options.context, forceRerun: true, noCache: false },
        requestText: jest.fn(async () => json({ summary: 'rerun' })),
    });
    expect(forced.cost).toBeCloseTo(0.01);
    expect(forced.analysisSegmentation.requests[0].checkpoint).toBeUndefined();
});

test('retains valid segments around a malformed answer and records the extraction gap', async () => {
    let calls = 0;
    const result = await runBoundedAnalysis({
        doc: { docId: 'gap-fixture' },
        sourceText: 'x'.repeat(8000),
        requestText: async () => {
            calls += 1;
            if (calls === 2) {
                const malformed = json({ ignored: true });
                malformed.response.choices[0].message.content = '```json\n{bad}\n```';
                return malformed;
            }
            return json({ summary: `segment-${calls}` });
        },
    });
    expect(calls).toBe(3);
    expect(result.analysisSegmentation.status).toBe('partial');
    expect(result.response).not.toBeNull();
    expect(result.analysisSegmentation.segments.map(segment => segment.status)).toEqual(['completed', 'failed', 'completed']);
    expect(result.analysisSegmentation.gaps).toMatchObject([{
        segmentId: result.analysisSegmentation.segments[1].id,
        startIndex: result.analysisSegmentation.segments[1].startIndex,
        endIndex: result.analysisSegmentation.segments[1].endIndex,
        reason: expect.any(String),
    }]);
    expect(result.analysisSegmentation.requests.every(request => (
        Object.hasOwn(request, 'rawText')
        && Object.hasOwn(request, 'status')
        && Object.hasOwn(request, 'parseDiagnostics')
    ))).toBe(true);
    expect(result.analysisSegmentation.requests[1].rawText).toBe('```json\n{bad}\n```');
    expect(result.analysisSegmentation.requests[1].parseDiagnostics.message).toMatch(/Unexpected token|Expected property name/i);
    const merged = JSON.parse(result.response.choices[0].message.content);
    expect(merged.summary).toContain('segment-1');
    expect(merged.summary).toContain('segment-3');
    expect(result.analysisSegmentation.coverage.rate).toBeLessThan(1);
});

test('persists malformed raw output before parse and flushes it on SIGINT', async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-bench-interrupted-'));
    const processObject = new EventEmitter();
    processObject.exit = jest.fn();
    let partialRows = [];
    const hooks = registerPartialReportHandlers({ outputDir, getRows: () => partialRows, processObject });
    let beforeParseArtifact;
    const malformedText = '```json\n{bad}\n```';
    const result = await runBoundedAnalysis({
        doc: { docId: 'interrupt-fixture' },
        model: 'vendor/model',
        context: {
            promptHash: 'interrupt-prompt',
            onRequestProgress: (metadata) => {
                const request = metadata.requests.at(-1);
                const artifactPath = path.resolve(__dirname, '..', request.rawArtifact);
                if (request.status === 'received') {
                    beforeParseArtifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
                }
                if (request.status === 'failed') {
                    partialRows = [{ docId: 'interrupt-fixture', status: 'RUNNING', analysisSegmentation: metadata }];
                    processObject.emit('SIGINT');
                }
            },
        },
        sourceText: 'single malformed segment',
        requestText: async () => {
            const raw = json({});
            raw.response.choices[0].message.content = malformedText;
            return raw;
        },
    });
    expect(beforeParseArtifact).toMatchObject({
        rawText: malformedText,
        status: 'received',
        parseDiagnostics: null,
        rawPersistedBeforeParse: true,
    });
    const partial = JSON.parse(fs.readFileSync(path.join(outputDir, 'report-partial.json'), 'utf8'));
    const request = partial.rows[0].analysisSegmentation.requests[0];
    expect(request).toMatchObject({
        rawText: malformedText,
        status: 'failed',
        rawPersistedBeforeParse: true,
        parseDiagnostics: { message: expect.any(String) },
    });
    expect(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', request.rawArtifact), 'utf8'))).toMatchObject({
        rawText: malformedText,
        status: 'failed',
        parseDiagnostics: { message: expect.any(String) },
    });
    expect(processObject.exit).toHaveBeenCalledWith(130);
    expect(result.response).toBeNull();
    hooks.dispose();
    fs.rmSync(outputDir, { recursive: true, force: true });
});

test('aborts remaining segment requests when raw response persistence fails', async () => {
    const checkpointPath = path.join(os.tmpdir(), `pdf-bench-checkpoint-blocker-${process.pid}`);
    fs.writeFileSync(checkpointPath, 'not a directory');
    const requestText = jest.fn(async () => json({ summary: 'must not be parsed' }));
    try {
        const result = await runBoundedAnalysis({
            doc: { docId: 'persist-failure' },
            context: { checkpointDir: checkpointPath },
            sourceText: 'x'.repeat(8000),
            requestText,
        });
        expect(requestText).toHaveBeenCalledTimes(1);
        expect(result.response).toBeNull();
        expect(result.analysisSegmentation.status).toBe('failed');
        expect(result.analysisSegmentation.requests[0]).toMatchObject({
            status: 'failed',
            rawPersistedBeforeParse: false,
            rawPersistenceError: expect.any(String),
            parseDiagnostics: { name: expect.any(String) },
        });
        expect(result.analysisSegmentation.gaps).toHaveLength(1);
    } finally {
        fs.rmSync(checkpointPath, { force: true });
    }
});
