'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execute } = require('../scripts/benchmark-pdf-engines');
const { runTextAnalysis } = require('../scripts/lib/arms');

const canonicalText = 'Canonical frozen transcript. '.repeat(8);
const textDoc = {
    docId: 'text.pdf', title: 'Text', filePath: '/tmp/text.pdf', pages: 2,
    textLayer: true, canonicalTranscript: { text: canonicalText, pageMap: [], verified: true },
};
const scanDoc = {
    docId: 'scan.pdf', title: 'Scan', filePath: '/tmp/scan.pdf', pages: 2,
    textLayer: false, canonicalTranscript: { text: canonicalText, pageMap: [], verified: true },
};

async function run(documents, registry) {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-arms-policy-'));
    try {
        return await execute({
            args: { 'max-cost': 10, repeats: 1 },
            documents,
            models: ['x/y'],
            capabilitiesByModel: { 'x/y': {} },
            outputDir,
            dryRun: false,
            registry,
        });
    } finally {
        fs.rmSync(outputDir, { recursive: true, force: true });
    }
}

test('Stage A sends canonical frozen text for both digital and scanned filings only', async () => {
    const calls = [];
    const registry = {
        'local-text': async (_model, doc) => {
            calls.push({ docId: doc.docId, text: doc.benchExtraction.text });
            return {
                text: '{"summary":"read canonical text"}',
                parsed: { summary: 'read canonical text' },
                json: { valid: true, truncated: false },
                groundingText: doc.benchExtraction.text,
                errors: [],
                cost: 0,
                latency: 1,
                provider: 'mock',
                pages: doc.pages,
            };
        },
    };
    const report = await run([textDoc, scanDoc], registry);

    expect(calls).toEqual([
        { docId: 'text.pdf', text: canonicalText },
        { docId: 'scan.pdf', text: canonicalText },
    ]);
    expect(report.rows.map((row) => row.arm)).toEqual(['local-text', 'local-text']);
});

test('Stage A skips canonical transcripts shorter than 100 characters', async () => {
    const arm = jest.fn();
    const doc = {
        ...textDoc,
        canonicalTranscript: { text: 'too short', pageMap: [], verified: false },
    };
    const report = await run([doc], { 'local-text': arm });

    expect(arm).not.toHaveBeenCalled();
    expect(report.rows[0]).toMatchObject({
        status: 'SKIPPED',
        reason: 'canonical-transcript-under-100-characters',
    });
});

test('Stage A independently measures raw, structured, and repaired output offline', async () => {
    const checkpointDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-condition-checkpoints-'));
    const chat = jest.fn()
        .mockResolvedValueOnce({
            response: { choices: [{ message: { content: '```json\n{"summary":"raw"}\n```' } }] },
            cost: 0.01, latencyMs: 5, status: 200, finish_reason: 'stop', provider: 'mock',
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        })
        .mockResolvedValueOnce({
            response: { choices: [{ message: { content: '{"summary":"structured"}' } }] },
            cost: 0.02, latencyMs: 7, status: 200, finish_reason: 'stop', provider: 'mock',
            usage: { input_tokens: 11, output_tokens: 6, total_tokens: 17 },
        });
    try {
        const result = await runTextAnalysis('x/y', {
            ...textDoc,
            benchExtraction: { text: canonicalText, pages: 2, pageRanges: [] },
        }, { requestChat: chat, checkpointDir, analysisMaxTokens: 100 });

        expect(chat).toHaveBeenCalledTimes(2);
        expect(chat.mock.calls[0][0].response_format).toBeUndefined();
        expect(chat.mock.calls[1][0].response_format).toEqual({ type: 'json_object' });
        expect(result.jsonConditions).toMatchObject({
            raw_parse: false,
            structured_mode: true,
            repaired: true,
            rawFailed: true,
        });
        expect(result.conditionResults).toMatchObject({
            raw_parse: { requested: true, passed: false, cost: 0.01 },
            structured_mode: { requested: true, passed: true, cost: 0.02 },
            repaired: { rawFailed: true, passed: true, cost: 0 },
        });
        expect(result.cost).toBeCloseTo(0.03);
        expect(result.latency).toBe(12);
        const rawRequest = result.conditionResults.raw_parse.requests[0];
        expect(rawRequest.rawPersistedBeforeParse).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', rawRequest.rawArtifact), 'utf8'))).toMatchObject({
            rawText: '```json\n{"summary":"raw"}\n```',
            status: 'completed',
            rawPersistedBeforeParse: true,
        });
    } finally {
        fs.rmSync(checkpointDir, { recursive: true, force: true });
    }
});

test('Stage A stops after bounded raw sidecar persistence failure', async () => {
    const checkpointPath = path.join(os.tmpdir(), `pdf-condition-checkpoint-blocker-${process.pid}`);
    fs.writeFileSync(checkpointPath, 'not a directory');
    const requestChat = jest.fn(async () => ({
        response: { choices: [{ message: { content: '{"summary":"must not be parsed"}' } }] },
        cost: 0.01, latencyMs: 5, status: 200, finish_reason: 'stop',
    }));
    try {
        const result = await runTextAnalysis('x/y', {
            ...textDoc,
            pages: 12,
            benchExtraction: { text: canonicalText, pages: 12, pageRanges: [] },
        }, { requestChat, checkpointDir: checkpointPath });
        expect(requestChat).toHaveBeenCalledTimes(1);
        expect(result.jsonConditions).toMatchObject({
            raw_parse: false,
            structured_mode: null,
        });
        expect(result.conditionResults.raw_parse.requests[0]).toMatchObject({
            status: 'failed',
            rawPersistedBeforeParse: false,
            rawPersistenceError: expect.any(String),
            parseDiagnostics: { name: expect.any(String) },
        });
    } finally {
        fs.rmSync(checkpointPath, { force: true });
    }
});
