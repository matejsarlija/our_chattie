// court-analysis/reasoning/significance.js
//
// TX-2 significance ranking (ticket TX-2): one lite-model call over the
// final deduped shortlist (conflicts + open questions), ranking legal
// significance. Rank ONLY, never filter: every item survives with or without
// a rank, and a failed ranking call leaves the report untouched.
//
// Output: per-item `heuristicRank` ({rank, significance, reason}, additive)
// plus the verbatim parsed ranking array (`significanceRanking`) for audit.
// The UI badge reads `heuristicRank` and renders nothing when it is absent.

const { extractJsonBlock } = require('../../helpers/jsonExtract');
const { withGeminiRetry, withGeminiTimeout } = require('../../helpers/geminiRetry');
const { trackGeminiInvoke } = require('../../helpers/geminiUsage');
const { createGeminiClient, outputCapWarning } = require('../../helpers/geminiConfig');
const agentLog = require('../../helpers/agentLog');

const MAX_SIGNIFICANCE_ITEMS = 20;
const SIGNIFICANCE_LEVELS = ['high', 'medium', 'low'];

function getGemini() {
    if (!getGemini.cached) getGemini.cached = createGeminiClient('significance');
    return getGemini.cached;
}

function itemText(item) {
    if (!item || typeof item !== 'object') return null;
    for (const key of ['finding', 'text', 'question', 'description']) {
        if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
    }
    return null;
}

/**
 * Builds the bounded ranking shortlist (pure). Conflicts first (they carry
 * verdicts), then open questions; textless items never reach the model.
 */
function buildSignificanceShortlist(reconciliation, options = {}) {
    const maxItems = Number.isFinite(options.maxItems) && options.maxItems >= 0
        ? Math.floor(options.maxItems)
        : MAX_SIGNIFICANCE_ITEMS;
    const shortlist = [];
    const push = (list, item, itemIndex) => {
        if (shortlist.length >= maxItems) return;
        const text = itemText(item);
        if (!text) return;
        shortlist.push({
            list,
            itemIndex,
            kind: item.kind || null,
            text: text.slice(0, 600)
        });
    };
    (Array.isArray(reconciliation?.conflicts) ? reconciliation.conflicts : [])
        .forEach((item, itemIndex) => push('conflict', item, itemIndex));
    (Array.isArray(reconciliation?.openQuestions) ? reconciliation.openQuestions : [])
        .forEach((item, itemIndex) => push('openQuestion', item, itemIndex));
    return shortlist;
}

function buildSignificancePrompt(shortlist) {
    const lines = shortlist.map((item, index) =>
        `${index}. [${item.list}/${item.kind || '?'}] ${item.text}`
    );
    return `SIGNIFICANCE RANK. Rank these findings from a Croatian bankruptcy case analysis by LEGAL significance to the case outcome (effect on claims, distributions, procedural posture). Rank every listed item exactly once; never drop or merge items.\n\n${lines.join('\n')}\n\nReturn ONLY a JSON array: [{"index": <shortlist number>, "rank": <1 = most significant>, "significance": "high" | "medium" | "low", "reason": "<a few words in Croatian>"}]. Provide ONLY the json array and nothing else.`;
}

function parseSignificanceRanking(content, shortlist) {
    const parsed = extractJsonBlock(typeof content === 'string' ? content : '');
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const size = Array.isArray(shortlist) ? shortlist.length : 0;
    const ranking = [];
    for (const row of parsed) {
        if (!row || typeof row !== 'object') continue;
        if (!Number.isInteger(row.index) || row.index < 0 || row.index >= size) continue;
        if (!SIGNIFICANCE_LEVELS.includes(row.significance)) continue;
        ranking.push({
            index: row.index,
            rank: Number.isInteger(row.rank) && row.rank > 0 ? row.rank : null,
            significance: row.significance,
            reason: typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : null
        });
    }
    return ranking.length > 0 ? ranking : null;
}

function createSignificanceJudge({ tracker = null, onUsage = null } = {}) {
    return async function judgeSignificance(shortlist) {
        const prompt = buildSignificancePrompt(shortlist);
        const response = await withGeminiRetry(() => withGeminiTimeout(
            (signal) => trackGeminiInvoke(getGemini(), prompt, { signal, tracker, onUsage })
        ));
        const ranking = parseSignificanceRanking(response?.content, shortlist);
        if (!ranking) {
            agentLog.warn(outputCapWarning('significance'));
            agentLog.error('[Significance] Failed to parse ranking JSON:', String(response?.content || '').slice(0, 200));
        }
        return ranking;
    };
}

/**
 * Runs significance over the shortlist (at most one call). Returns the
 * parsed ranking or null; never throws.
 */
async function runSignificance(shortlist, options = {}) {
    const list = Array.isArray(shortlist) ? shortlist : [];
    if (list.length === 0) return null;
    const judgeLlm = typeof options.significanceLlm === 'function'
        ? options.significanceLlm
        : createSignificanceJudge(options);
    try {
        return await judgeLlm(list);
    } catch (err) {
        agentLog.warn(`[Significance] Ranking failed; leaving items unranked (${err.message})`);
        return null;
    }
}

/**
 * Applies a ranking as advisory per-item badges. Returns the applied count;
 * invalid rows are skipped, valid ones kept verbatim.
 */
function applySignificance(reconciliation, shortlist, ranking) {
    const list = Array.isArray(shortlist) ? shortlist : [];
    let applied = 0;
    for (const row of Array.isArray(ranking) ? ranking : []) {
        if (!row || typeof row !== 'object') continue;
        const slot = list[row.index];
        if (!slot) continue;
        const bucket = slot.list === 'conflict' ? reconciliation?.conflicts : reconciliation?.openQuestions;
        const item = Array.isArray(bucket) ? bucket[slot.itemIndex] : null;
        if (!item || typeof item !== 'object') continue;
        item.heuristicRank = { rank: row.rank ?? null, significance: row.significance, reason: row.reason ?? null };
        applied += 1;
    }
    return { applied };
}

module.exports = {
    MAX_SIGNIFICANCE_ITEMS,
    SIGNIFICANCE_LEVELS,
    buildSignificanceShortlist,
    buildSignificancePrompt,
    parseSignificanceRanking,
    createSignificanceJudge,
    runSignificance,
    applySignificance
};
