'use strict';

const axios = require('axios');
const { readCache } = require('../scripts/lib/capabilities');
const { createOpenRouterClient } = require('../llm/openrouterClient');
const { scoreReferenceFreeExtraction } = require('./metrics');

const CROATIAN_SMOKE_BUDGET_USD = 0.002;
const CROATIAN_SMOKE_TEXT = 'Trgovački sud u Splitu u stečajnom postupku St-2/2013 nad dužnikom KERUM d.o.o. (OIB 66124057408) utvrđuje tražbinu od 1.250,00 EUR.';

function profileTailLatency(latenciesMs = []) {
    const sorted = (Array.isArray(latenciesMs) ? latenciesMs : [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
    if (!sorted.length) {
        return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
    }
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
    return {
        count: sorted.length,
        minMs: sorted[0],
        p50Ms: pct(50),
        p95Ms: pct(95),
        p99Ms: pct(99),
        maxMs: sorted[sorted.length - 1],
    };
}

function listBenchModels({ sqliteStore = null } = {}) {
    const capCache = readCache();
    const pricingRows = sqliteStore?.db
        ? sqliteStore.db.prepare('SELECT * FROM model_pricing_cache ORDER BY model_id ASC').all()
        : [];
    const byId = new Map();

    for (const row of pricingRows) {
        let caps = {};
        try {
            caps = row.capabilities_json ? JSON.parse(row.capabilities_json) : {};
        } catch {
            caps = {};
        }
        byId.set(row.model_id, {
            modelId: row.model_id,
            contextLength: row.context_length ?? null,
            maxCompletionTokens: row.max_completion_tokens ?? null,
            inputUsdPerM: row.input_usd_per_m ?? null,
            outputUsdPerM: row.output_usd_per_m ?? null,
            capabilities: caps,
            fetchedAt: row.fetched_at || null,
            gbenchGate: caps.gbenchGate || null,
        });
    }

    for (const [modelId, entry] of Object.entries(capCache.models || {})) {
        const existing = byId.get(modelId) || {
            modelId,
            contextLength: null,
            maxCompletionTokens: null,
            inputUsdPerM: null,
            outputUsdPerM: null,
            capabilities: {},
            fetchedAt: null,
            gbenchGate: null,
        };
        existing.capabilities = {
            ...(existing.capabilities || {}),
            ...(entry?.capabilities || {}),
        };
        byId.set(modelId, existing);
    }

    return {
        models: [...byId.values()],
        smokeBudgetUsd: CROATIAN_SMOKE_BUDGET_USD,
    };
}

async function syncOpenRouterModels({ sqliteStore, httpGet = axios.get, apiKey = process.env.OPENROUTER_API_KEY } = {}) {
    if (!sqliteStore?.db) throw new Error('SQLite store is required to sync models.');
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const response = await httpGet('https://openrouter.ai/api/v1/models', { headers, timeout: 15000 });
    const data = Array.isArray(response?.data?.data) ? response.data.data : [];
    const now = new Date().toISOString();
    const upsert = sqliteStore.db.prepare(`
        INSERT INTO model_pricing_cache (
            model_id, context_length, max_completion_tokens, input_usd_per_m, output_usd_per_m, capabilities_json, fetched_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(model_id) DO UPDATE SET
            context_length = excluded.context_length,
            max_completion_tokens = excluded.max_completion_tokens,
            input_usd_per_m = excluded.input_usd_per_m,
            output_usd_per_m = excluded.output_usd_per_m,
            fetched_at = excluded.fetched_at
    `);
    const tx = sqliteStore.db.transaction((items) => {
        let count = 0;
        for (const m of items) {
            if (!m?.id) continue;
            const promptPrice = Number(m?.pricing?.prompt);
            const completionPrice = Number(m?.pricing?.completion);
            const inputUsdPerM = Number.isFinite(promptPrice) ? Number((promptPrice * 1_000_000).toFixed(4)) : null;
            const outputUsdPerM = Number.isFinite(completionPrice) ? Number((completionPrice * 1_000_000).toFixed(4)) : null;
            upsert.run(
                m.id,
                Number(m.context_length) || null,
                Number(m?.top_provider?.max_completion_tokens) || null,
                inputUsdPerM,
                outputUsdPerM,
                JSON.stringify({
                    supportedParameters: m.supported_parameters || [],
                    architecture: m.architecture || null,
                }),
                now,
            );
            count += 1;
        }
        return count;
    });
    const synced = tx(data);
    return { synced, fetchedAt: now };
}

async function runCroatianSmokeGate({
    model = 'z-ai/glm-5.3-flash',
    dryRun = false,
    approved = false,
    maxCost = 0,
    sqliteStore = null,
    clientFactory = createOpenRouterClient,
} = {}) {
    if (!dryRun) {
        if (approved !== true) throw new Error('Explicit approval is required to run the live gbench smoke gate.');
        if (!Number.isFinite(Number(maxCost)) || Number(maxCost) <= 0) {
            throw new Error('Set a strict positive maxCost > 0 for live gbench runs.');
        }
    }
    if (dryRun) {
        return {
            model,
            dryRun: true,
            budgetUsd: CROATIAN_SMOKE_BUDGET_USD,
            passed: true,
            estimatedCostUsd: 0.0008,
        };
    }

    const started = Date.now();
    const client = clientFactory({
        model,
        taskType: 'GbenchSmokeGate',
        traceStore: sqliteStore,
    });
    const prompt = `Izvuci JSON { "caseNumber": string, "oib": string, "amountEur": number } iz teksta: ${CROATIAN_SMOKE_TEXT}`;
    const response = await client.invoke(prompt);
    const latencyMs = Date.now() - started;
    const costUsd = Number(response?.usage?.costUsd || 0);
    let parsed = {};
    let validJson = false;
    try {
        parsed = typeof response?.content === 'string' ? JSON.parse(response.content) : (response?.content || {});
        validJson = Boolean(parsed && typeof parsed === 'object');
    } catch {
        validJson = false;
    }
    const passed = validJson && costUsd <= CROATIAN_SMOKE_BUDGET_USD;
    const gateResult = {
        model,
        dryRun: false,
        validJson,
        costUsd,
        budgetUsd: CROATIAN_SMOKE_BUDGET_USD,
        latencyMs,
        passed,
        checkedAt: new Date().toISOString(),
        score: scoreReferenceFreeExtraction({ aiResult: parsed, sourceText: CROATIAN_SMOKE_TEXT }),
    };

    if (sqliteStore?.db) {
        const existing = sqliteStore.db.prepare('SELECT capabilities_json FROM model_pricing_cache WHERE model_id = ?').get(model);
        let caps = {};
        try {
            caps = existing?.capabilities_json ? JSON.parse(existing.capabilities_json) : {};
        } catch {
            caps = {};
        }
        caps.gbenchGate = gateResult;
        sqliteStore.db.prepare(`
            INSERT INTO model_pricing_cache (model_id, capabilities_json, fetched_at)
            VALUES (?, ?, ?)
            ON CONFLICT(model_id) DO UPDATE SET capabilities_json = excluded.capabilities_json
        `).run(model, JSON.stringify(caps), gateResult.checkedAt);
    }

    return gateResult;
}

module.exports = {
    CROATIAN_SMOKE_BUDGET_USD,
    profileTailLatency,
    listBenchModels,
    syncOpenRouterModels,
    runCroatianSmokeGate,
};
