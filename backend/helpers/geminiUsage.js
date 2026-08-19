// Token-usage accounting for Gemini calls across the analysis pipeline.
//
// @langchain/google-genai `invoke` returns an AIMessage whose `usage_metadata`
// carries `{ input_tokens, output_tokens, total_tokens }`. Every call site used
// to discard it. This module centralizes extraction and per-run accumulation so
// token usage can be streamed live and persisted on the analysis run.

/**
 * Creates a cumulative usage tracker for a single analysis run.
 * @returns {{
 *   record: (usage: object|null) => void,
 *   snapshot: () => object,
 *   reset: () => void
 * }}
 */
function createUsageTracker() {
    const totals = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        calls: 0,
    };

    return {
        record(usage) {
            if (!usage || typeof usage !== 'object') return;
            const input = toNonNegativeInt(usage.inputTokens ?? usage.input_tokens);
            const output = toNonNegativeInt(usage.outputTokens ?? usage.output_tokens);
            const total = toNonNegativeInt(usage.totalTokens ?? usage.total_tokens);

            // If only total is available (no input/output breakdown), still
            // accumulate it so the run reflects every counted token.
            const hasBreakdown = input !== null || output !== null;

            if (input !== null) totals.inputTokens += input;
            if (output !== null) totals.outputTokens += output;
            if (total !== null) {
                totals.totalTokens += total;
            } else if (hasBreakdown) {
                totals.totalTokens += (input || 0) + (output || 0);
            }

            totals.calls += 1;
        },

        snapshot() {
            return {
                inputTokens: totals.inputTokens,
                outputTokens: totals.outputTokens,
                totalTokens: totals.totalTokens,
                calls: totals.calls,
            };
        },

        reset() {
            totals.inputTokens = 0;
            totals.outputTokens = 0;
            totals.totalTokens = 0;
            totals.calls = 0;
        },
    };
}

function toNonNegativeInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric >= 0 ? Math.round(numeric) : null;
}

/**
 * Extracts a normalized usage object from a LangChain AIMessage response.
 * Returns null when the response carries no usage metadata (e.g. a refusal).
 * @param {object|null} response
 * @returns {{ inputTokens: number|null, outputTokens: number|null, totalTokens: number|null }|null}
 */
function extractUsageFromResponse(response) {
    const meta = response?.usage_metadata;
    if (!meta || typeof meta !== 'object') return null;

    const usage = {
        inputTokens: toNonNegativeInt(meta.input_tokens),
        outputTokens: toNonNegativeInt(meta.output_tokens),
        totalTokens: toNonNegativeInt(meta.total_tokens),
    };

    const hasAny = usage.inputTokens !== null
        || usage.outputTokens !== null
        || usage.totalTokens !== null;

    return hasAny ? usage : null;
}

/**
 * Invokes the Gemini client and records any returned usage against `tracker`,
 * firing `onUsage` with the updated cumulative snapshot. Returns the raw
 * AIMessage so call sites keep using `.content` as before.
 *
 * Must be called inside the existing withGeminiRetry/withGeminiTimeout closure
 * so every retry attempt (which still consumes tokens) is accounted for.
 *
 * @param {import('@langchain/google-genai').ChatGoogleGenerativeAI} gemini
 * @param {any} input
 * @param {{ signal?: AbortSignal, tracker?: object, onUsage?: (snapshot: object) => void }} [options]
 * @returns {Promise<object>} The AIMessage response.
 */
async function trackGeminiInvoke(gemini, input, options = {}) {
    const { signal, tracker, onUsage } = options;
    const response = await gemini.invoke(input, signal ? { signal } : {});

    if (tracker) {
        const usage = extractUsageFromResponse(response);
        if (usage) {
            tracker.record(usage);
            if (typeof onUsage === 'function') {
                onUsage(tracker.snapshot());
            }
        }
    }

    return response;
}

module.exports = {
    createUsageTracker,
    extractUsageFromResponse,
    trackGeminiInvoke,
};
