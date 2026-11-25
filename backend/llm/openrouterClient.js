'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

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

function createOpenRouterClient({
    model,
    temperature,
    maxTokens,
    responseFormat,
    reasoning,
    provider,
} = {}) {
    if (typeof model !== 'string' || !model.trim()) {
        throw new Error('OpenRouter model is required.');
    }

    return {
        async invoke(input, { signal } = {}) {
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

            const response = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${apiKey}`,
                    'content-type': 'application/json',
                    'http-referer': process.env.OPENROUTER_SITE_URL || 'http://localhost',
                    'x-title': process.env.OPENROUTER_APP_NAME || 'our_chattie',
                },
                body: JSON.stringify(payload),
                signal,
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
                const detail = body?.error?.message || body?.message || response.statusText || 'request failed';
                const error = new Error(`OpenRouter request failed (${response.status}): ${detail}`);
                error.status = response.status;
                error.response = {
                    status: response.status,
                    headers: {
                        'retry-after': response.headers?.get?.('retry-after'),
                        'x-retry-after-ms': response.headers?.get?.('x-retry-after-ms'),
                    },
                    data: body,
                };
                throw error;
            }

            const choice = body?.choices?.[0];
            return {
                content: choice?.message?.content ?? '',
                usage_metadata: normalizeUsage(body?.usage),
                response_metadata: {
                    model: body?.model || model,
                    provider: body?.provider || null,
                    finish_reason: choice?.finish_reason || null,
                    id: body?.id || null,
                },
            };
        },
    };
}

module.exports = { createOpenRouterClient, normalizeUsage };
