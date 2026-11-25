// Token-usage and cost accounting for OpenRouter calls across the analysis pipeline.

function toNonNegativeInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric >= 0 ? Math.round(numeric) : null;
}

function toNonNegativeNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return null;
    return numeric;
}

/**
 * Creates a cumulative usage tracker for a single analysis run.
 */
function createUsageTracker() {
    const totals = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        reasoningTokens: 0,
        costUsd: 0,
        calls: 0,
    };

    return {
        record(usage) {
            if (!usage || typeof usage !== 'object') return;
            const input = toNonNegativeInt(usage.inputTokens ?? usage.input_tokens);
            const output = toNonNegativeInt(usage.outputTokens ?? usage.output_tokens);
            const total = toNonNegativeInt(usage.totalTokens ?? usage.total_tokens);
            const cached = toNonNegativeInt(usage.cachedTokens ?? usage.cached_tokens);
            const reasoning = toNonNegativeInt(usage.reasoningTokens ?? usage.reasoning_tokens);
            const costUsd = toNonNegativeNumber(usage.costUsd ?? usage.cost_usd ?? usage.cost);

            const hasBreakdown = input !== null || output !== null;

            if (input !== null) totals.inputTokens += input;
            if (output !== null) totals.outputTokens += output;
            if (total !== null) {
                totals.totalTokens += total;
            } else if (hasBreakdown) {
                totals.totalTokens += (input || 0) + (output || 0);
            }
            if (cached !== null) totals.cachedTokens += cached;
            if (reasoning !== null) totals.reasoningTokens += reasoning;
            if (costUsd !== null) totals.costUsd = Number((totals.costUsd + costUsd).toFixed(8));

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

        detailedSnapshot() {
            return {
                inputTokens: totals.inputTokens,
                outputTokens: totals.outputTokens,
                totalTokens: totals.totalTokens,
                cachedTokens: totals.cachedTokens,
                reasoningTokens: totals.reasoningTokens,
                costUsd: totals.costUsd,
                calls: totals.calls,
            };
        },

        reset() {
            totals.inputTokens = 0;
            totals.outputTokens = 0;
            totals.totalTokens = 0;
            totals.cachedTokens = 0;
            totals.reasoningTokens = 0;
            totals.costUsd = 0;
            totals.calls = 0;
        },
    };
}

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

function extractUsageTelemetry(response) {
    const base = extractUsageFromResponse(response);
    const details = response?.response_metadata?.usageDetails || null;
    if (!base && !details) return null;
    return {
        inputTokens: base?.inputTokens ?? null,
        outputTokens: base?.outputTokens ?? null,
        totalTokens: base?.totalTokens ?? null,
        cachedTokens: toNonNegativeInt(details?.cached_tokens ?? response?.usage_metadata?.cached_tokens),
        reasoningTokens: toNonNegativeInt(details?.reasoning_tokens ?? response?.usage_metadata?.reasoning_tokens),
        costUsd: toNonNegativeNumber(details?.cost_usd ?? response?.usage_metadata?.cost_usd),
    };
}

async function trackUsageInvoke(client, input, options = {}) {
    const { signal, tracker, onUsage, ...rest } = options;
    const invokeOpts = { ...(signal ? { signal } : {}), ...rest };
    const response = await client.invoke(input, invokeOpts);

    if (tracker) {
        const telemetry = extractUsageTelemetry(response);
        if (telemetry) {
            tracker.record(telemetry);
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
    extractUsageTelemetry,
    trackUsageInvoke,
};
