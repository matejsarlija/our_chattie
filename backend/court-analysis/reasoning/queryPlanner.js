// backend/court-analysis/reasoning/queryPlanner.js
//
// Purpose: Model-planned retrieval queries (Phase 1.3). The fixed Croatian
//          template queries miss most real-corpus content (measured: 13%
//          recall@5 on the real-document probe vs 100% targeted-probe ceiling
//          — see `npm run eval:reasoning`). One small planner call lets the
//          model emit case-specific queries from a deterministic inventory,
//          merged with (never replacing) the templates.
//
// Failure contract: ANY problem — missing content, transport error, garbage
// JSON, wrong shapes — degrades to an empty planned list. Templates always
// run; the planner only ever adds. REASONING_PLANNER=off disables the call;
// =force always runs (see reportService.shouldRunOptionalPass).
//
// Cost contract: exactly ONE call per run; ≤6 planned queries; the merge cap
// bounds total queries so synthesis/verifier input stays budgeted downstream.

const { createGeminiClient, outputCapWarning } = require('../../helpers/geminiConfig');
const { withGeminiRetry, withGeminiTimeout } = require('../../helpers/geminiRetry');
const { trackGeminiInvoke } = require('../../helpers/geminiUsage');
const { extractJsonBlock } = require('../../helpers/jsonExtract');
const agentLog = require('../../helpers/agentLog');
const { normalizeText } = require('./indexer');

const MAX_PLANNED_QUERIES = 6;
const MAX_TOTAL_QUERIES = 8;
const MAX_INVENTORY_FILES = 15;

// Lazy client: importing this module must not require an API key.
let gemini = null;

function getGemini() {
    if (!gemini) gemini = createGeminiClient('planner');
    return gemini;
}

/**
 * Deterministic case inventory — everything the planner may reference.
 * Bounded: file lists truncate so dense clusters cannot balloon the prompt.
 */
function buildInventory(evidencePackage) {
    const pkg = evidencePackage || {};
    const fileNames = [
        ...(pkg.analyses || []).map((analysis) => analysis.fileName).filter(Boolean),
        ...new Set((pkg.chunks || []).map((chunk) => chunk.metadata?.fileName).filter(Boolean))
    ].slice(0, MAX_INVENTORY_FILES);

    const dates = (pkg.entries || [])
        .map((entry) => entry.date)
        .filter(Boolean)
        .sort();

    return {
        clusterId: pkg.clusterId || null,
        queryType: pkg.query?.type || null,
        queryValue: pkg.query?.value || null,
        entryCount: (pkg.entries || []).length,
        documentCount: new Set([
            ...(pkg.analyses || []).map((a) => a.fileName),
            ...(pkg.chunks || []).map((c) => c.metadata?.fileName)
        ].filter(Boolean)).size,
        fileNames,
        dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null,
        parties: [...new Set([
            ...(pkg.identity?.participantNames || []),
            ...(pkg.entries || []).flatMap((entry) => (entry.participants || []).map((p) => p.name)).filter(Boolean)
        ])].slice(0, 10),
        moneyTotalsByCurrency: pkg.moneyFlow?.currencyTotals || {}
    };
}

function formatInventory(inventory) {
    return JSON.stringify(inventory, null, 1);
}

function buildPlannerPrompt(inventory) {
    return [
        'Ti si pomoćnik za pravnu analizu hrvatskih sudskih predmeta (e-Oglasna).',
        'Dolazi inventar jednog predmeta. Generiraj 3-6 CILJANIH upita za leksičko pretraživanje dokaznog korpusa predmeta.',
        'Upiti moraju kombinirati specifične pojmove iz inventara (nazivi dokumenata, stranke, datumi, iznosi) s pravnim ključnim riječima u hrvatskom jeziku.',
        'Svaki upit je niz pojmova razdvojenih razmacima. Vrati strogo JSON polje bez ikakvog drugog teksta:',
        '[{"id":"kratki-slug","purpose":"timeline|financial-amounts|procedural-status|party-roles|asset-disposition|...","text":"pojmovi upita"}]',
        '',
        'INVENTAR PREDMETA:',
        formatInventory(inventory)
    ].join('\n');
}

/**
 * Validates and maps raw planner output into retrieval-query shape.
 * Invalid entries are dropped silently; anchors mirror the template queries
 * so identity boosting behaves identically for planned queries.
 */
function mapPlannedQueries(raw, evidencePackage) {
    if (!Array.isArray(raw)) return [];

    const anchors = [
        evidencePackage.query?.value,
        evidencePackage.primaryCaseNumber || evidencePackage.clusterId,
        ...(evidencePackage.identity?.participantOibs || []),
        ...(evidencePackage.identity?.participantNames || [])
    ].filter(Boolean);
    const queryType = ['oib', 'case_number', 'text'].includes(evidencePackage.query?.type)
        ? evidencePackage.query.type
        : 'text';

    const seenTexts = new Set();
    const mapped = [];
    for (const entry of raw) {
        if (!entry || typeof entry.text !== 'string') continue;
        const text = entry.text.trim();
        if (text.length < 3) continue;
        const dedupeKey = normalizeText(text);
        if (seenTexts.has(dedupeKey)) continue;
        seenTexts.add(dedupeKey);

        mapped.push({
            id: typeof entry.id === 'string' && entry.id.trim() ? `planned-${entry.id.trim().slice(0, 40)}` : `planned-${mapped.length + 1}`,
            purpose: typeof entry.purpose === 'string' && entry.purpose.trim() ? entry.purpose.trim().slice(0, 60) : 'planned',
            text,
            anchors,
            queryType
        });
        if (mapped.length >= MAX_PLANNED_QUERIES) break;
    }
    return mapped;
}

/** Pure merge: planned first, template duplicates dropped, total capped. */
function mergeRetrievalQueries(planned, templates) {
    const seen = new Set();
    const merged = [];
    for (const query of [...planned, ...templates]) {
        const key = normalizeText(query.text);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(query);
        if (merged.length >= MAX_TOTAL_QUERIES) break;
    }
    return merged;
}

async function runQueryPlanner(evidencePackage, options = {}) {
    const { plannerLlm, tracker = null, onUsage = null } = options;

    // Quota conservation guard: nothing indexable → nothing to plan for.
    const hasContent = (evidencePackage?.analyses?.length || 0) + (evidencePackage?.chunks?.length || 0) > 0;
    if (!hasContent) return [];
    if (typeof plannerLlm !== 'function') return [];

    try {
        const inventory = buildInventory(evidencePackage);
        const response = await plannerLlm({
            prompt: buildPlannerPrompt(inventory),
            tracker,
            onUsage
        });
        const parsed = extractJsonBlock(response);
        if (!Array.isArray(parsed)) {
            agentLog.warn(outputCapWarning('planner'));
            agentLog.error('[QueryPlanner] Non-array planner output; using templates.', String(response || '').slice(0, 200));
            return [];
        }
        return mapPlannedQueries(parsed, evidencePackage);
    } catch (err) {
        agentLog.warn(`[QueryPlanner] Planning failed; using templates (${err.message})`);
        return [];
    }
}

module.exports = {
    buildInventory,
    buildPlannerPrompt,
    mapPlannedQueries,
    mergeRetrievalQueries,
    runQueryPlanner,
    MAX_PLANNED_QUERIES,
    MAX_TOTAL_QUERIES
};
