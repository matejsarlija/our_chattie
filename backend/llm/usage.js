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

function mapTaskToStage(taskType) {
    const t = String(taskType || '');
    if (t === 'TranscribePage' || t.includes('Ocr') || t.includes('OCR')) return 'ocr';
    if (t === 'SynthesizeCase') return 'synthesis';
    if (t === 'VerifyReport') return 'verify';
    return 'extraction';
}

function buildEnrichedTokenUsage({ usageTracker, sqliteStore = null, runId = null, processedCases = [] } = {}) {
    const base = typeof usageTracker?.detailedSnapshot === 'function'
        ? usageTracker.detailedSnapshot()
        : {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cachedTokens: 0,
            reasoningTokens: 0,
            costUsd: 0,
            calls: 0,
        };

    const byStage = {
        ocr: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costUsd: 0, calls: 0 },
        extraction: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costUsd: 0, calls: 0 },
        synthesis: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costUsd: 0, calls: 0 },
        verify: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, costUsd: 0, calls: 0 },
    };
    const modelsUsed = new Set();

    if (sqliteStore?.db && runId) {
        try {
            const rows = sqliteStore.db.prepare(`
                SELECT task_type, COALESCE(actual_model, requested_model) AS model,
                       input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd
                FROM llm_traces WHERE run_id = ?
            `).all(runId);
            let traceCost = 0;
            let traceCached = 0;
            let traceReasoning = 0;
            for (const row of rows) {
                const stage = mapTaskToStage(row.task_type);
                const bucket = byStage[stage];
                const inTok = Number(row.input_tokens) || 0;
                const outTok = Number(row.output_tokens) || 0;
                const cachedTok = Number(row.cached_tokens) || 0;
                const reasonTok = Number(row.reasoning_tokens) || 0;
                const cost = Number(row.cost_usd) || 0;
                bucket.inputTokens += inTok;
                bucket.outputTokens += outTok;
                bucket.cachedTokens += cachedTok;
                bucket.reasoningTokens += reasonTok;
                bucket.costUsd = Number((bucket.costUsd + cost).toFixed(6));
                bucket.calls += 1;
                traceCost += cost;
                traceCached += cachedTok;
                traceReasoning += reasonTok;
                if (row.model) modelsUsed.add(row.model);
            }
            if (rows.length > 0) {
                base.costUsd = Number(Math.max(base.costUsd, traceCost).toFixed(6));
                base.cachedTokens = Math.max(base.cachedTokens, traceCached);
                base.reasoningTokens = Math.max(base.reasoningTokens, traceReasoning);
            }
        } catch {
            // Non-fatal trace aggregation
        }
    }

    let cacheHitDocs = 0;
    let adminFastPathDocs = 0;
    for (const pc of Array.isArray(processedCases) ? processedCases : []) {
        for (const item of Array.isArray(pc?.analysis?.individualAnalyses) ? pc.analysis.individualAnalyses : []) {
            if (item?.fromCache) cacheHitDocs += 1;
            if (item?.adminFastPath) adminFastPathDocs += 1;
        }
    }

    return {
        ...base,
        byStage,
        cacheHitDocs,
        adminFastPathDocs,
        modelsUsed: [...modelsUsed],
    };
}

module.exports = {
    createUsageTracker,
    extractUsageFromResponse,
    extractUsageTelemetry,
    trackUsageInvoke,
    buildEnrichedTokenUsage,
};
