'use strict';

const crypto = require('node:crypto');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 240_000;

function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const inputTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
    const outputTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
    const totalTokens = Number.isFinite(usage.total_tokens)
        ? usage.total_tokens
        : (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
    return inputTokens === null && outputTokens === null && totalTokens === null
        ? null
        : { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens };
}

function extractDetailedUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const cachedTokens = Number.isFinite(usage?.prompt_tokens_details?.cached_tokens)
        ? usage.prompt_tokens_details.cached_tokens
        : (Number.isFinite(usage.cached_tokens) ? usage.cached_tokens : 0);
    const reasoningTokens = Number.isFinite(usage?.completion_tokens_details?.reasoning_tokens)
        ? usage.completion_tokens_details.reasoning_tokens
        : (Number.isFinite(usage.reasoning_tokens) ? usage.reasoning_tokens : 0);
    const rawCost = usage.cost ?? usage.total_cost;
    const costUsd = Number.isFinite(Number(rawCost)) ? Number(rawCost) : null;
    return {
        cached_tokens: cachedTokens,
        reasoning_tokens: reasoningTokens,
        cost_usd: costUsd,
    };
}

function createProviderError(status, detail, body = null, headers = null) {
    const error = new Error(`OpenRouter request failed (${status}): ${detail}`);
    error.status = status;
    error.actualProvider = body?.provider || body?.error?.metadata?.provider_name || null;
    error.response = {
        status,
        headers: {
            'retry-after': headers?.get?.('retry-after') ?? null,
            'x-retry-after-ms': headers?.get?.('x-retry-after-ms') ?? null,
        },
        data: body,
    };
    return error;
}

function mergeAnnotations(existing, incoming) {
    if (!Array.isArray(incoming) || incoming.length === 0) return existing;
    return [...(existing || []), ...incoming];
}

function deltaContentToText(deltaContent) {
    if (typeof deltaContent === 'string') return deltaContent;
    if (!Array.isArray(deltaContent)) return '';
    return deltaContent
        .map((part) => (typeof part === 'string' ? part : (part?.text || '')))
        .join('');
}

async function consumeSseResponse(response, { requestedModel, startedAt, resetIdleWatchdog }) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let reasoningText = '';
    let finishReason = null;
    let actualModel = requestedModel;
    let actualProvider = null;
    let id = null;
    let usage = null;
    let annotations = [];
    let ttftMs = null;

    const handleSseLine = (line) => {
        if (!line) return false;
        if (line.startsWith(':')) {
            // Keepalive comment (e.g. ": OPENROUTER PROCESSING") resets idle watchdog.
            resetIdleWatchdog();
            return false;
        }
        if (!line.startsWith('data:')) return false;
        resetIdleWatchdog();
        const rawData = line.slice(5).trim();
        if (!rawData) return false;
        if (rawData === '[DONE]') return true;

        let parsed;
        try {
            parsed = JSON.parse(rawData);
        } catch {
            return false;
        }

        if (parsed?.error) {
            const errStatus = Number(parsed.error.code) || 502;
            const errMsg = parsed.error.message || 'OpenRouter SSE stream error';
            throw createProviderError(errStatus, errMsg, parsed, response.headers);
        }

        if (parsed.id) id = parsed.id;
        if (parsed.model) actualModel = parsed.model;
        if (parsed.provider) actualProvider = parsed.provider;
        if (parsed.usage) usage = parsed.usage;

        const choice = parsed.choices?.[0];
        if (choice) {
            const delta = choice.delta || choice.message || {};
            const deltaText = deltaContentToText(delta.content);
            if (deltaText) {
                if (ttftMs === null) ttftMs = Date.now() - startedAt;
                content += deltaText;
            }
            if (typeof delta.reasoning === 'string' && delta.reasoning) {
                if (ttftMs === null) ttftMs = Date.now() - startedAt;
                reasoningText += delta.reasoning;
            }
            if (Array.isArray(delta.annotations) && delta.annotations.length > 0) {
                annotations = mergeAnnotations(annotations, delta.annotations);
            }
            if (Array.isArray(choice.message?.annotations) && choice.message.annotations.length > 0) {
                annotations = mergeAnnotations(annotations, choice.message.annotations);
            }
            if (choice.finish_reason) {
                finishReason = choice.finish_reason;
            }
        }
        if (Array.isArray(parsed.annotations) && parsed.annotations.length > 0) {
            annotations = mergeAnnotations(annotations, parsed.annotations);
        }
        return false;
    };

    try {
        let done = false;
        while (!done) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunk.value && chunk.value.byteLength > 0) {
                resetIdleWatchdog();
                buffer += decoder.decode(chunk.value, { stream: true });
                let newlineIdx = buffer.indexOf('\n');
                while (newlineIdx !== -1) {
                    const line = buffer.slice(0, newlineIdx).replace(/\r$/, '');
                    buffer = buffer.slice(newlineIdx + 1);
                    if (handleSseLine(line)) {
                        done = true;
                        break;
                    }
                    newlineIdx = buffer.indexOf('\n');
                }
            }
        }
        buffer += decoder.decode();
        if (!done && buffer.trim()) {
            for (const trailingLine of buffer.split(/\r?\n/)) {
                if (handleSseLine(trailingLine.trim())) break;
            }
        }
    } finally {
        reader.releaseLock?.();
    }

    return {
        content,
        reasoningText,
        usage,
        annotations: annotations.length > 0 ? annotations : undefined,
        actualModel,
        actualProvider,
        finishReason,
        id,
        ttftMs,
    };
}

function createOpenRouterClient({
    model,
    temperature,
    maxTokens,
    responseFormat,
    reasoning,
    provider,
    plugins,
    stream = true,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    totalTimeoutMs = DEFAULT_TOTAL_TIMEOUT_MS,
    traceStore = null,
    runId = null,
    taskType = null,
    docHash = null,
    segmentId = null,
    promptHash = null,
    userPrompt = null,
} = {}) {
    if (typeof model !== 'string' || !model.trim()) {
        throw new Error('OpenRouter model is required.');
    }

    return {
        async invoke(input, invokeOpts = {}) {
            const apiKey = process.env.OPENROUTER_API_KEY;
            if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');
            const messages = typeof input === 'string'
                ? [{ role: 'user', content: input }]
                : input;
            if (!Array.isArray(messages)) throw new TypeError('OpenRouter input must be a string or messages array.');

            const payload = { model, messages };
            if (Number.isFinite(temperature)) payload.temperature = temperature;
            if (Number.isFinite(maxTokens)) payload.max_tokens = maxTokens;
            if (responseFormat) payload.response_format = responseFormat;
            if (reasoning) payload.reasoning = reasoning;
            if (provider) payload.provider = provider;
            const effectivePlugins = invokeOpts.plugins || plugins;
            if (Array.isArray(effectivePlugins) && effectivePlugins.length > 0) {
                payload.plugins = effectivePlugins;
            }
            const useStream = invokeOpts.stream !== undefined ? invokeOpts.stream : stream;
            if (useStream !== false) {
                payload.stream = true;
                payload.stream_options = { include_usage: true };
            }

            const callerSignal = invokeOpts.signal;
            if (callerSignal?.aborted) {
                throw callerSignal.reason || Object.assign(new Error('OpenRouter call aborted.'), { name: 'AbortError' });
            }

            const controller = new AbortController();
            let abortCause = null;
            let idleTimer = null;
            let totalTimer = null;

            const abortWith = (err) => {
                if (!abortCause) abortCause = err;
                if (!controller.signal.aborted) controller.abort(err);
            };

            const onCallerAbort = () => {
                abortWith(
                    callerSignal.reason instanceof Error
                        ? callerSignal.reason
                        : Object.assign(new Error('OpenRouter call aborted.'), { name: 'AbortError' }),
                );
            };
            callerSignal?.addEventListener?.('abort', onCallerAbort, { once: true });

            const resetIdleWatchdog = () => {
                if (idleTimer) clearTimeout(idleTimer);
                if (Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0) {
                    idleTimer = setTimeout(() => {
                        abortWith(Object.assign(
                            new Error(`OpenRouter SSE stream idle for >${idleTimeoutMs}ms`),
                            { name: 'TimeoutError', code: 'ERR_STREAM_IDLE_TIMEOUT' },
                        ));
                    }, idleTimeoutMs);
                }
            };

            if (Number.isFinite(totalTimeoutMs) && totalTimeoutMs > 0) {
                totalTimer = setTimeout(() => {
                    abortWith(Object.assign(
                        new Error(`OpenRouter request timed out after ${totalTimeoutMs}ms`),
                        { name: 'TimeoutError', code: 'ERR_TOTAL_TIMEOUT' },
                    ));
                }, totalTimeoutMs);
            }

            const startedAt = Date.now();
            let tracePayload = {
                id: crypto.randomUUID(),
                runId,
                taskType: taskType || invokeOpts.taskType || null,
                docHash: docHash || invokeOpts.docHash || null,
                segmentId: segmentId || invokeOpts.segmentId || null,
                promptHash: promptHash || invokeOpts.promptHash || null,
                userPrompt: userPrompt || (typeof input === 'string' ? input : null),
                requestParams: {
                    model,
                    temperature: payload.temperature ?? null,
                    max_tokens: payload.max_tokens ?? null,
                    stream: Boolean(payload.stream),
                    provider: payload.provider ?? null,
                },
                requestedModel: model,
                actualModel: null,
                actualProvider: null,
                finishReason: null,
                rawResponse: null,
                ttftMs: null,
                latencyMs: null,
                inputTokens: null,
                outputTokens: null,
                cachedTokens: null,
                reasoningTokens: null,
                costUsd: null,
                errorMessage: null,
            };

            try {
                resetIdleWatchdog();
                const response = await fetch(OPENROUTER_URL, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${apiKey}`,
                        'content-type': 'application/json',
                        'http-referer': process.env.OPENROUTER_SITE_URL || 'http://localhost',
                        'x-title': process.env.OPENROUTER_APP_NAME || 'our_chattie',
                    },
                    body: JSON.stringify(payload),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    const body = typeof response.json === 'function'
                        ? await response.json().catch(() => null)
                        : null;
                    const detail = body?.error?.message || body?.message || response.statusText || 'request failed';
                    const err = createProviderError(response.status, detail, body, response.headers);
                    tracePayload.actualModel = body?.model || model;
                    tracePayload.actualProvider = err.actualProvider;
                    tracePayload.errorMessage = err.message;
                    tracePayload.rawResponse = body ? JSON.stringify(body) : null;
                    throw err;
                }

                const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
                const canStream = Boolean(response.body && typeof response.body.getReader === 'function')
                    && !contentType.includes('application/json')
                    && (contentType.includes('text/event-stream') || typeof response.json !== 'function' || payload.stream === true);

                let normalized;
                if (canStream) {
                    const streamed = await consumeSseResponse(response, {
                        requestedModel: model,
                        startedAt,
                        resetIdleWatchdog,
                    });
                    const baseUsage = normalizeUsage(streamed.usage);
                    const detailedUsage = extractDetailedUsage(streamed.usage);
                    normalized = {
                        content: streamed.content,
                        annotations: streamed.annotations,
                        usage_metadata: baseUsage,
                        response_metadata: {
                            model: streamed.actualModel || model,
                            provider: streamed.actualProvider || null,
                            finish_reason: streamed.finishReason || null,
                            id: streamed.id || null,
                            ttft_ms: streamed.ttftMs,
                            annotations: streamed.annotations,
                            usageDetails: detailedUsage,
                            ...(streamed.reasoningText ? { reasoning: streamed.reasoningText } : {}),
                        },
                    };
                } else {
                    const body = await response.json().catch(() => null);
                    if (body?.error) {
                        const errStatus = Number(body.error.code) || 502;
                        throw createProviderError(errStatus, body.error.message || 'OpenRouter error payload', body, response.headers);
                    }
                    const choice = body?.choices?.[0];
                    const annotations = choice?.message?.annotations || body?.annotations;
                    const baseUsage = normalizeUsage(body?.usage);
                    const detailedUsage = extractDetailedUsage(body?.usage);
                    normalized = {
                        content: choice?.message?.content ?? '',
                        ...(annotations ? { annotations } : {}),
                        usage_metadata: baseUsage,
                        response_metadata: {
                            model: body?.model || model,
                            provider: body?.provider || null,
                            finish_reason: choice?.finish_reason || null,
                            id: body?.id || null,
                            ttft_ms: Date.now() - startedAt,
                            ...(annotations ? { annotations } : {}),
                            usageDetails: detailedUsage,
                        },
                    };
                }

                tracePayload.actualModel = normalized.response_metadata.model;
                tracePayload.actualProvider = normalized.response_metadata.provider;
                tracePayload.finishReason = normalized.response_metadata.finish_reason;
                tracePayload.rawResponse = typeof normalized.content === 'string'
                    ? normalized.content
                    : JSON.stringify(normalized.content);
                tracePayload.ttftMs = normalized.response_metadata.ttft_ms;
                tracePayload.inputTokens = normalized.usage_metadata?.input_tokens ?? null;
                tracePayload.outputTokens = normalized.usage_metadata?.output_tokens ?? null;
                tracePayload.cachedTokens = normalized.response_metadata.usageDetails?.cached_tokens ?? null;
                tracePayload.reasoningTokens = normalized.response_metadata.usageDetails?.reasoning_tokens ?? null;
                tracePayload.costUsd = normalized.response_metadata.usageDetails?.cost_usd ?? null;

                return normalized;
            } catch (err) {
                const thrown = abortCause || err;
                tracePayload.errorMessage = thrown?.message || String(thrown);
                if (thrown?.actualProvider) {
                    tracePayload.actualProvider = thrown.actualProvider;
                }
                throw thrown;
            } finally {
                if (idleTimer) clearTimeout(idleTimer);
                if (totalTimer) clearTimeout(totalTimer);
                callerSignal?.removeEventListener?.('abort', onCallerAbort);
                tracePayload.latencyMs = Date.now() - startedAt;
                if (traceStore?.insertLlmTrace) {
                    try {
                        traceStore.insertLlmTrace(tracePayload);
                    } catch {
                        // Telemetry persistence must never mask or crash model calls.
                    }
                }
            }
        },
    };
}

module.exports = {
    OPENROUTER_URL,
    DEFAULT_IDLE_TIMEOUT_MS,
    DEFAULT_TOTAL_TIMEOUT_MS,
    createOpenRouterClient,
    normalizeUsage,
    extractDetailedUsage,
};
