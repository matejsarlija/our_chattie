'use strict';

const { performance } = require('node:perf_hooks');
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_API_URL = 'https://openrouter.ai/api/v1/models';
const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
const MISTRAL_OCR_USD_PER_PAGE = 0.002;
// A benchmark call must never wait forever. Five minutes is deliberately
// generous for a 16k-token analysis on a small PDF, while still turning a
// stalled connection into a logged error the operator can act on.
const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
// Matches the production analysis output budget; dense extraction responses
// need generous headroom to avoid truncating mid-JSON.
const ANALYSIS_MAX_TOKENS = 16384;

function hasFilePart(messages) {
    return (messages || []).some((message) => Array.isArray(message.content)
        && message.content.some((part) => part && part.type === 'file'));
}

function getPdfEngine(plugins) {
    return (plugins || []).find((plugin) => plugin?.id === 'file-parser')?.pdf?.engine;
}

function validateRequest(body, capabilities = {}, { allowNativeProbe = false } = {}) {
    if (!body || !Array.isArray(body.messages)) throw new Error('messages are required');
    if (hasFilePart(body.messages)) {
        const engine = getPdfEngine(body.plugins);
        if (!engine) throw new Error('File parts require an explicit file-parser PDF engine');
        if (engine === 'native' && capabilities.fileNative !== true && !allowNativeProbe) {
            throw new Error('PDF engine native requires confirmed fileNative capability for this model');
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanError(value) {
    if (!value) return '';
    const message = typeof value === 'string' ? value : value.message || JSON.stringify(value);
    return String(message).replace(/\s+/g, ' ').trim().slice(0, 500);
}

async function requestChat(body, options = {}) {
    validateRequest(body, options.capabilities || {}, { allowNativeProbe: options.allowNativeProbe === true });
    const fetchImpl = options.fetchImpl || global.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('Node fetch is unavailable');
    const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for live calls');
    const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 2;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;
    const heartbeatMs = Number.isFinite(options.heartbeatMs) ? options.heartbeatMs : 15000;
    const label = String(options.label || body.model || 'OpenRouter request');
    const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
    const emit = (event) => {
        if (!onEvent) return;
        try { onEvent({ label, ...event }); } catch { /* Progress reporting must never break a paid call. */ }
    };
    const started = performance.now();
    let retries = 0;
    while (true) {
        const attempt = retries + 1;
        const attemptStarted = performance.now();
        let stage = 'awaiting-headers';
        let httpStatus = null;
        let requestId = null;
        const wallStarted = Date.now();
        const signal = timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(timeoutMs)
            : undefined;
        const heartbeat = onEvent && heartbeatMs > 0
            ? setInterval(() => emit({ phase: 'heartbeat', attempt, elapsedMs: performance.now() - attemptStarted, stage }), heartbeatMs)
            : null;
        heartbeat?.unref?.();
        emit({ phase: 'start', attempt, timeoutMs, engine: getPdfEngine(body.plugins) || null, model: body.model,
            providerOrder: body.provider?.order || [], maxTokens: body.max_tokens ?? null });
        try {
            const response = await fetchImpl(options.url || API_URL, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                ...(signal ? { signal } : {}),
            });
            stage = 'reading-body';
            httpStatus = response.status;
            requestId = response.headers?.get?.('x-request-id') || response.headers?.get?.('cf-ray') || null;
            emit({ phase: 'headers', attempt, status: httpStatus, requestId, elapsedMs: performance.now() - attemptStarted });
            const raw = await response.text();
            stage = 'decoding-response';
            let data;
            let invalidJson = false;
            try { data = JSON.parse(raw); } catch { invalidJson = true; }
            if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
            const usableChoice = Array.isArray(data.choices) && data.choices[0]?.message
                && (extractAssistantText(data).trim() || extractParsedFileText(data).trim());
            const payloadError = data.error || data.choices?.[0]?.error
                || (data.choices?.[0]?.finish_reason === 'error' ? 'Provider returned an error finish reason' : null)
                || (invalidJson ? 'Invalid JSON response from provider' : !usableChoice ? 'No usable choices returned by provider' : null);
            if (!response.ok || payloadError) {
                const errorBody = response.ok ? payloadError : data.error || raw || `HTTP ${response.status}`;
                if ((response.status === 429 || response.status >= 500) && retries < maxRetries) {
                    const delayMs = Math.min(250 * (2 ** retries), 2000);
                    emit({ phase: 'retry', attempt, status: response.status, delayMs, error: cleanError(errorBody) });
                    await sleep(delayMs);
                    retries += 1;
                    continue;
                }
                const requestRejection = response.status === 400
                    && retries === 0
                    && getPdfEngine(body.plugins)
                    && hasFilePart(body.messages)
                    && data.provider == null
                    && data.usage == null
                    && !usableChoice
                    && /file exceeds the maximum size supported by the file parser/i.test(cleanError(data.error))
                    ? 'pdf-parser-size-limit'
                    : null;
                const result = {
                    response: null,
                    status: response.status,
                    provider: data.provider || null,
                    model: data.model || body.model,
                    finish_reason: null,
                    usage: data.usage || null,
                    cost: data.usage?.cost ?? null,
                    latencyMs: performance.now() - started,
                    retries,
                    requestRejection,
                    error: errorBody,
                };
                emit({ phase: 'end', attempt, status: result.status, provider: result.provider, latencyMs: result.latencyMs, cost: result.cost, error: cleanError(errorBody) });
                return result;
            }
            const choice = data.choices?.[0] || {};
            const result = {
                response: data,
                status: response.status,
                provider: data.provider || null,
                model: data.model || body.model,
                finish_reason: choice.finish_reason || null,
                usage: data.usage || null,
                cost: data.usage?.cost ?? null,
                latencyMs: performance.now() - started,
                retries,
                error: null,
            };
            emit({ phase: 'end', attempt, status: result.status, provider: result.provider, latencyMs: result.latencyMs, cost: result.cost, finishReason: result.finish_reason });
            return result;
        } catch (error) {
            const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError';
            const timedOut = signal?.aborted === true;
            const causes = [];
            const seen = new Set();
            for (let cause = error; cause && causes.length < 5 && !seen.has(cause); cause = cause.cause) {
                seen.add(cause);
                causes.push({ name: cause.name || null, code: cause.code || null, message: String(cause.message || cause) });
            }
            const diagnostics = {
                stage, httpStatus, requestId, timeoutMs, deadlineAborted: timedOut,
                signalReason: signal?.aborted ? String(signal.reason?.name || signal.reason) : null,
                attemptElapsedMs: performance.now() - attemptStarted,
                wallElapsedMs: Date.now() - wallStarted, causes,
            };
            const detail = causes.map((cause) => [cause.name, cause.code, cause.message].filter(Boolean).join(': ')).join(' ← ');
            const errorBody = timedOut
                ? `Request timed out after ${timeoutMs} ms (${options.label || body.model}). Raise --timeout-ms if the provider is simply slow.`
                : `${aborted ? 'Request aborted before the configured deadline: ' : ''}${detail}`;
            // Transport failures do not prove the server rejected the request,
            // even before headers arrive. Never duplicate an ambiguously paid call.
            const result = {
                response: null, status: httpStatus, provider: null, model: body.model, finish_reason: null,
                usage: null, cost: null, latencyMs: performance.now() - started, retries,
                error: errorBody, timedOut, diagnostics,
            };
            emit({ phase: 'end', attempt, status: httpStatus, latencyMs: result.latencyMs, error: cleanError(errorBody), timedOut, diagnostics });
            return result;
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
    }
}

function buildPdfMessage({ model = DEFAULT_MODEL, filename, bytes, prompt, engine, maxTokens = 16, provider, reasoning } = {}) {
    if (!Buffer.isBuffer(bytes)) throw new Error('PDF bytes must be a Buffer');
    if (!engine) throw new Error('PDF engine must be explicitly pinned');
    return {
        model,
        messages: [{ role: 'user', content: [
            { type: 'text', text: prompt || 'Transcribe this PDF.' },
            { type: 'file', file: { filename: filename || 'document.pdf', file_data: `data:application/pdf;base64,${bytes.toString('base64')}` } },
        ] }],
        plugins: [{ id: 'file-parser', pdf: { engine } }],
        max_tokens: maxTokens,
        stream: false,
        ...(provider ? { provider } : {}),
        ...(reasoning ? { reasoning } : {}),
    };
}

function buildImageMessage({ model = DEFAULT_MODEL, prompt, imageDataUrl, imageDataUrls, maxTokens = 2048, provider, reasoning } = {}) {
    const urls = [...(Array.isArray(imageDataUrls) ? imageDataUrls : []), ...(imageDataUrl ? [imageDataUrl] : [])].filter(Boolean);
    if (!urls.length) throw new Error('imageDataUrl or imageDataUrls is required');
    return {
        model,
        messages: [{ role: 'user', content: [
            { type: 'text', text: prompt || 'Read this page.' },
            ...urls.map((url) => ({ type: 'image_url', image_url: { url } })),
        ] }],
        max_tokens: maxTokens,
        stream: false,
        ...(provider ? { provider } : {}),
        ...(reasoning ? { reasoning } : {}),
    };
}

function extractAssistantText(response) {
    const content = response?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : Array.isArray(content)
        ? content.map((part) => part?.text || '').join('') : '';
}

// Parser output is only trustworthy when it came back attached to a successful
// completion. OpenRouter can echo `file_annotations` on an error payload too, and
// those annotations may belong to an earlier, different document (observed: a
// 429 on Troškovnik carrying Podnesak's text). An error is an error row with no
// text, never a transcript.
function extractParsedFileText(response) {
    if (response?.error || response?.choices?.[0]?.error) return '';
    const annotations = response?.choices?.[0]?.message?.annotations;
    if (!Array.isArray(annotations)) return '';
    return annotations.flatMap((item) => item?.file?.content || [])
        .filter((part) => part?.type === 'text' && part.text)
        .map((part) => part.text).join('\n');
}

function mistralOcrCost(pageCount, ratePerThousand = 2) {
    if (!Number.isFinite(pageCount) || pageCount < 0) throw new Error('pageCount must be non-negative');
    return pageCount * ratePerThousand / 1000;
}

module.exports = {
    API_URL, MODEL_API_URL, DEFAULT_MODEL, MISTRAL_OCR_USD_PER_PAGE, ANALYSIS_MAX_TOKENS, DEFAULT_REQUEST_TIMEOUT_MS,
    hasFilePart, getPdfEngine, validateRequest, requestChat, buildPdfMessage,
    buildImageMessage, extractAssistantText, extractParsedFileText, mistralOcrCost,
};
