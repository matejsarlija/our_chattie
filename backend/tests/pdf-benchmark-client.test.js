'use strict';

const {
    buildPdfMessage, requestChat, extractParsedFileText, mistralOcrCost,
} = require('../scripts/lib/openrouter-client');
const {
    capabilitiesFromMetadata, resolveCapabilities, parseCapabilityOverride,
} = require('../scripts/lib/capabilities');
const { assertLiveCaps } = require('../scripts/benchmark-pdf-engines');

const jsonResponse = (status, value) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
});

beforeEach(() => jest.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; }));
afterEach(() => jest.restoreAllMocks());

test('file parts require an explicitly pinned engine, and native requires confirmed capability', async () => {
    const bytes = Buffer.from('%PDF');
    const unpinned = buildPdfMessage({ bytes, model: 'x/y', engine: 'cloudflare-ai' });
    unpinned.plugins = [];
    await expect(requestChat(unpinned, { apiKey: 'x', fetchImpl: jest.fn() })).rejects.toThrow(/explicit/);
    const native = buildPdfMessage({ bytes, model: 'x/y', engine: 'native' });
    await expect(requestChat(native, { apiKey: 'x', fetchImpl: jest.fn(), capabilities: { fileNative: null } })).rejects.toThrow(/confirmed/);
    const accepted = await requestChat(native, {
        apiKey: 'x', capabilities: { fileNative: true },
        fetchImpl: jest.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { cost: 0.01 } })),
    });
    expect(accepted.cost).toBe(0.01);
});

test('a file-parser size-limit HTTP 400 is classified as a definitive pre-inference rejection', async () => {
    const body = buildPdfMessage({ bytes: Buffer.from('%PDF'), model: 'x/y', engine: 'cloudflare-ai' });
    const fetchImpl = jest.fn().mockResolvedValue(jsonResponse(400, {
        error: { message: 'Failed to parse the file: The file exceeds the maximum size supported by the file parser.' },
    }));
    const result = await requestChat(body, { apiKey: 'x', fetchImpl });
    expect(result).toMatchObject({
        status: 400,
        requestRejection: 'pdf-parser-size-limit',
        provider: null,
        usage: null,
        cost: null,
        retries: 0,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const other = await requestChat({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] }, {
        apiKey: 'x',
        fetchImpl: jest.fn().mockResolvedValue(jsonResponse(400, {
            error: { message: 'The file exceeds the maximum size supported by the file parser.' },
        })),
    });
    expect(other.requestRejection).toBeNull();
});


test('a stalled request is abandoned after the timeout and is not retried', async () => {
    const events = [];
    const fetchImpl = jest.fn((_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted due to timeout');
            error.name = 'TimeoutError';
            reject(error);
        });
    }));
    const result = await requestChat(
        { model: 'x/y', messages: [{ role: 'user', content: 'hi' }] },
        { apiKey: 'x', fetchImpl, timeoutMs: 20, maxRetries: 2, onEvent: (event) => events.push(event), heartbeatMs: 5 },
    );
    expect(result.timedOut).toBe(true);
    expect(result.error).toMatch(/timed out after 20 ms/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.phase)).toEqual(expect.arrayContaining(['start', 'heartbeat', 'end']));
    expect(events.some((event) => event.phase === 'retry')).toBe(false);
});

test('an upstream abort retains its cause and is not mislabeled as our deadline or retried', async () => {
    const error = new Error('terminated', { cause: Object.assign(new Error('socket closed'), { code: 'UND_ERR_SOCKET' }) });
    error.name = 'AbortError';
    const fetchImpl = jest.fn().mockRejectedValue(error);
    const result = await requestChat(
        { model: 'x/y', messages: [{ role: 'user', content: 'hi' }] },
        { apiKey: 'x', fetchImpl, timeoutMs: 300000 },
    );
    expect(result.timedOut).toBe(false);
    expect(result.error).toMatch(/aborted before the configured deadline.*UND_ERR_SOCKET.*socket closed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test('a body disconnect records received headers, request ID and nested transport cause', async () => {
    const events = [];
    const error = new Error('terminated', { cause: Object.assign(new Error('peer closed'), { code: 'UND_ERR_SOCKET' }) });
    const fetchImpl = jest.fn(async () => ({
        ok: true, status: 200, headers: { get: (key) => key === 'x-request-id' ? 'req-123' : null },
        text: async () => { throw error; },
    }));
    const result = await requestChat(
        { model: 'x/y', messages: [{ role: 'user', content: 'hi' }] },
        {
            apiKey: 'secret', onEvent: (event) => events.push(event), fetchImpl,
        },
    );
    expect(result).toMatchObject({
        status: 200, timedOut: false,
        diagnostics: {
            stage: 'reading-body', httpStatus: 200, requestId: 'req-123', deadlineAborted: false,
            causes: [{ name: 'Error', code: null, message: 'terminated' }, { name: 'Error', code: 'UND_ERR_SOCKET', message: 'peer closed' }],
        },
    });
    expect(events.find((event) => event.phase === 'headers')).toMatchObject({ status: 200, requestId: 'req-123' });
    expect(events.find((event) => event.phase === 'end').diagnostics).toEqual(result.diagnostics);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.retries).toBe(0);
    expect(events.some((event) => event.phase === 'retry')).toBe(false);
});

test('wall-clock adjustment does not corrupt request latency', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValueOnce(30000).mockReturnValue(10000);
    const result = await requestChat(
        { model: 'x/y', messages: [{ role: 'user', content: 'hi' }] },
        { apiKey: 'x', maxRetries: 0, fetchImpl: async () => { throw new Error('connection failed'); } },
    );
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.wallElapsedMs).toBe(-20000);
    expect(result.diagnostics.attemptElapsedMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.stage).toBe('awaiting-headers');
    now.mockRestore();
});

test('a transport failure before headers is not retried because execution is unknown', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    const result = await requestChat(
        { model: 'x/y', messages: [{ role: 'user', content: 'hi' }] },
        { apiKey: 'x', fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
        response: null, cost: null, retries: 0,
        diagnostics: { stage: 'awaiting-headers', httpStatus: null },
    });
});

test('429 retries are bounded and usage/provider details are retained', async () => {
    const fetchImpl = jest.fn()
        .mockResolvedValueOnce(jsonResponse(429, { error: { message: 'busy' } }))
        .mockResolvedValueOnce(jsonResponse(200, { provider: 'ProviderX', model: 'x/y', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { total_tokens: 9, cost: 0.2 } }));
    const result = await requestChat({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] }, { apiKey: 'x', fetchImpl });
    expect(result).toMatchObject({ provider: 'ProviderX', model: 'x/y', finish_reason: 'stop', cost: 0.2, retries: 1, usage: { total_tokens: 9 } });
});

test('parser output is read from file annotation text content', () => {
    expect(extractParsedFileText({ choices: [{ message: { annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'parsed' }, { type: 'image_url' }] } }] } }] })).toBe('parsed');
    expect(extractParsedFileText({ choices: [{ message: { content: 'no annotations' } }] })).toBe('');
});

test('capabilities resolve manual override over probe over metadata hints', () => {
    const metadata = { architecture: { input_modalities: ['text', 'image', 'file'] } };
    expect(capabilitiesFromMetadata(metadata)).toEqual({ fileNative: true, imageInput: true });
    const cached = { models: { 'x/y': { capabilities: { fileNative: false, imageInput: false } } } };
    expect(resolveCapabilities('x/y', { cached, metadata })).toMatchObject({ fileNative: false, imageInput: false });
    expect(resolveCapabilities('x/y', { cached, metadata, overrides: ['x/y:fileNative:true'] })).toMatchObject({ fileNative: true, imageInput: false, sources: { fileNative: 'manual', imageInput: 'probe' } });
    expect(resolveCapabilities('x/y').fileNative).toBe(null);
    expect(parseCapabilityOverride('x/y:imageInput:false')).toEqual({ model: 'x/y', capability: 'imageInput', value: false });
});

test('Mistral OCR estimate uses two dollars per thousand pages', () => {
    expect(mistralOcrCost(250)).toBe(0.5);
    expect(mistralOcrCost(250, 2.2)).toBeCloseTo(0.55);
});
test('live runs require finite document, page, and cost caps; dry runs remain unblocked', () => {
    expect(() => assertLiveCaps({}, false)).toThrow(/--max-docs cap/);
    expect(() => assertLiveCaps({ 'max-docs': '3', 'max-pages': '10' }, false)).toThrow(/--max-cost cap/);
    expect(() => assertLiveCaps({ 'max-docs': '3', 'max-pages': '10', 'max-cost': '0.1' }, false)).not.toThrow();
    expect(() => assertLiveCaps({}, true)).not.toThrow();
});

test('parser text is never harvested from an error payload', () => {
    const contaminated = {
        error: {
            message: 'Provider returned error',
            code: 429,
            metadata: { file_annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'ZAJEDNIČKI PODNESAK' }] } }] },
        },
    };
    expect(extractParsedFileText(contaminated)).toBe('');
    expect(extractParsedFileText({ choices: [{ message: { annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'real parse' }] } }] } }] })).toBe('real parse');
});

test.each([
    ['top-level error', { error: { message: 'provider failed' }, usage: { cost: 0.02 } }, /provider failed/],
    ['choice error', { choices: [{ error: { message: 'choice failed' } }] }, /choice failed/],
    ['missing choices', { usage: { cost: 0.02 } }, /No usable choices/],
    ['empty choices', { choices: [] }, /No usable choices/],
    ['missing message', { choices: [{ finish_reason: 'stop' }] }, /No usable choices/],
    ['empty content', { choices: [{ message: { content: '  ' } }] }, /No usable choices/],
    ['invalid JSON', undefined, /Invalid JSON/],
])('HTTP 200 %s is a failed request, not an answer', async (_label, payload, errorPattern) => {
    const events = [];
    const fetchImpl = jest.fn().mockResolvedValue(payload === undefined
        ? { ok: true, status: 200, text: async () => '<html>not JSON</html>' }
        : jsonResponse(200, payload));
    const result = await requestChat({ model: 'x/y', messages: [{ role: 'user', content: 'hi' }] }, {
        apiKey: 'x', fetchImpl, onEvent: (event) => events.push(event),
    });
    expect(result.response).toBeNull();
    expect(JSON.stringify(result.error)).toMatch(errorPattern);
    expect(result.status).toBe(200);
    expect(result.cost).toBe(payload?.usage?.cost ?? null);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ phase: 'end', status: 200, error: expect.stringMatching(errorPattern) });
});

test('error payloads cannot leak echoed file annotations into transcripts', async () => {
    const payload = { error: { message: 'failed' }, choices: [{ message: {
        content: 'OK',
        annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'stale document' }] } }],
    } }] };
    expect(extractParsedFileText(payload)).toBe('');
    const result = await requestChat({ model: 'x/y', messages: [] }, {
        apiKey: 'x', fetchImpl: jest.fn().mockResolvedValue(jsonResponse(200, payload)),
    });
    expect(result.response).toBeNull();
    expect(result.error).toEqual(payload.error);
});
