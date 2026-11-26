'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStore } = require('../services/sqliteStore');
const { createOpenRouterClient, normalizeUsage } = require('../llm/openrouterClient');
const { shouldRetry } = require('../llm/retry');

function sseStreamFromChunks(chunks) {
    const encoder = new TextEncoder();
    let idx = 0;
    return new ReadableStream({
        async pull(controller) {
            if (idx >= chunks.length) {
                controller.close();
                return;
            }
            const next = chunks[idx];
            idx += 1;
            if (typeof next === 'function') {
                await next(controller, encoder);
            } else {
                controller.enqueue(encoder.encode(next));
            }
        },
    });
}

describe('OpenRouter client', () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalApiKey;
    });

    test('converts a string prompt into a user message, sends stream:true, and normalizes json mock fallback usage', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'completion-1',
                model: 'provider/model',
                provider: 'provider',
                choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
            }),
        });

        const client = createOpenRouterClient({ model: 'provider/model', temperature: 0, maxTokens: 100 });
        const response = await client.invoke('return JSON');

        expect(global.fetch).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
                body: JSON.stringify({
                    model: 'provider/model',
                    messages: [{ role: 'user', content: 'return JSON' }],
                    temperature: 0,
                    max_tokens: 100,
                    stream: true,
                    stream_options: { include_usage: true },
                }),
            }),
        );
        expect(response).toMatchObject({
            content: '{"ok":true}',
            usage_metadata: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
            response_metadata: { model: 'provider/model', provider: 'provider', finish_reason: 'stop' },
        });
    });

    test('preserves messages arrays and returns null for absent usage when stream=false', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        const messages = [{ role: 'user', content: [{ type: 'text', text: 'read' }] }];
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'done' } }] }),
        });

        const response = await createOpenRouterClient({ model: 'provider/model', stream: false }).invoke(messages);
        const request = JSON.parse(global.fetch.mock.calls[0][1].body);

        expect(request.messages).toEqual(messages);
        expect(request.stream).toBeUndefined();
        expect(request.stream_options).toBeUndefined();
        expect(response.usage_metadata).toBeNull();
    });

    test('streams SSE chunks with keepalives, extracts annotations/usage, and writes raw llm_traces before parsing', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'or-trace-'));
        const sqliteStore = createSqliteStore({ dataDir: tmpDir });
        try {
            const run = await sqliteStore.createAnalysisRun({
                queryType: 'oib',
                queryValue: '12345678901',
                scanDepth: 'balanced',
            });

            const sseBody = sseStreamFromChunks([
                ': OPENROUTER PROCESSING\n\n',
                'data: {"id":"cmp-sse","model":"z-ai/glm-5.3-flash","provider":"Novita","choices":[{"delta":{"content":"{\\"broken\\": "}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"not-valid-json","annotations":[{"type":"file"}]},"finish_reason":"length"}]}\n\n',
                'data: {"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120,"prompt_tokens_details":{"cached_tokens":40},"completion_tokens_details":{"reasoning_tokens":8},"cost":0.00125}}\n\n',
                'data: [DONE]\n\n',
            ]);

            global.fetch = jest.fn().mockResolvedValue({
                ok: true,
                headers: new Headers({ 'content-type': 'text/event-stream' }),
                body: sseBody,
            });

            const client = createOpenRouterClient({
                model: 'z-ai/glm-5.3-flash',
                plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
                traceStore: sqliteStore,
                runId: run.id,
                taskType: 'ExtractDoc',
                docHash: 'hash-1',
                segmentId: 'seg-1',
                promptHash: 'ph-1',
            });

            const response = await client.invoke('extract facts');
            const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
            expect(sentBody.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]);
            expect(response.content).toBe('{"broken": not-valid-json');
            expect(response.annotations).toEqual([{ type: 'file' }]);
            expect(response.response_metadata).toMatchObject({
                model: 'z-ai/glm-5.3-flash',
                provider: 'Novita',
                finish_reason: 'length',
                usageDetails: {
                    cached_tokens: 40,
                    reasoning_tokens: 8,
                    cost_usd: 0.00125,
                },
            });

            const { traces } = sqliteStore.listRunTraces({ runId: run.id });
            expect(traces).toHaveLength(1);
            const fullTrace = sqliteStore.getRunTrace({ runId: run.id, traceId: traces[0].id });
            expect(fullTrace).toMatchObject({
                taskType: 'ExtractDoc',
                actualProvider: 'Novita',
                finishReason: 'length',
                rawResponse: '{"broken": not-valid-json',
                inputTokens: 100,
                outputTokens: 20,
                cachedTokens: 40,
                reasoningTokens: 8,
                costUsd: 0.00125,
            });
            expect(fullTrace.ttftMs).toBeGreaterThanOrEqual(0);
        } finally {
            sqliteStore.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('triggers ERR_STREAM_IDLE_TIMEOUT when SSE stream stalls beyond idleTimeoutMs and marks it retryable', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        global.fetch = jest.fn((_url, { signal }) => Promise.resolve({
            ok: true,
            headers: new Headers({ 'content-type': 'text/event-stream' }),
            body: new ReadableStream({
                start(controller) {
                    signal.addEventListener('abort', () => {
                        controller.error(signal.reason || new Error('aborted'));
                    }, { once: true });
                },
            }),
        }));

        const client = createOpenRouterClient({
            model: 'provider/model',
            idleTimeoutMs: 40,
            totalTimeoutMs: 5000,
        });

        let caught;
        try {
            await client.invoke('stalled');
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeTruthy();
        expect(caught.code).toBe('ERR_STREAM_IDLE_TIMEOUT');
        expect(shouldRetry(caught)).toBe(true);
    });

    test('rejects before making a request when the API key is missing', async () => {
        delete process.env.OPENROUTER_API_KEY;
        global.fetch = jest.fn();
        await expect(createOpenRouterClient({ model: 'provider/model' }).invoke('prompt'))
            .rejects.toThrow('OPENROUTER_API_KEY is not set');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('normalizes partial usage without inventing missing token counts', () => {
        expect(normalizeUsage({ prompt_tokens: 7 })).toEqual({
            input_tokens: 7,
            output_tokens: null,
            total_tokens: null,
        });
    });
});
