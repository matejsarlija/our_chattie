// Token-usage accounting for OpenRouter calls across the analysis pipeline.
//
// The client normalizes provider usage into `{ input_tokens, output_tokens,
// total_tokens }`. This module accumulates it per run for streaming and
// persistence.

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
 * Extracts normalized usage from an OpenRouter response.
 * Returns null when the response carries no usage metadata.
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
 * Invokes the model client and records returned usage against `tracker`,
 * firing `onUsage` with the updated cumulative snapshot. Returns the raw
 * normalized response so call sites keep using `.content` as before.
 *
 * Must be called inside the request retry/timeout closure so every attempt
 * (which may consume tokens) is accounted for.
 *
 * @param {{ invoke: Function }} client
 * @param {any} input
 * @param {{ signal?: AbortSignal, tracker?: object, onUsage?: (snapshot: object) => void }} [options]
 * @returns {Promise<object>} The normalized model response.
 */
async function trackUsageInvoke(client, input, options = {}) {
    const { signal, tracker, onUsage } = options;
    const response = await client.invoke(input, signal ? { signal } : {});

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
    trackUsageInvoke,
};
