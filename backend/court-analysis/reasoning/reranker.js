// backend/court-analysis/reasoning/reranker.js
//
// Purpose: Evidence reranking over lexical retrieval results (Phase 1.2).
//          Pure orchestration core + INJECTED `llmRerank` function, so the
//          Gemini client never leaks into unit tests and the cost contract is
//          enforceable here: at most ONE model call per run, over at most
//          MAX_RERANK_CANDIDATES unique candidates.
//
// Status contract (stable, consumed by run meta):
//   'skipped'  — reranking not attempted (disabled, or ambiguity gate not met)
//   'fallback' — attempted but no/failed model result; lexical order preserved
//   'active'   — model scores applied; matches re-sorted within each query

const MAX_RERANK_CANDIDATES = 24;
const CANDIDATE_SNIPPET_CHARS = 400;
// A query is "ambiguous" when its runner-up is nearly as strong as its best
// match — exactly the case where lexical order is not trustworthy.
const AMBIGUITY_RATIO = 0.8;

function resolveRerankStatus(options = {}) {
    return options.enabled ? 'fallback' : 'skipped';
}

/**
 * Collects unique rerank candidates across all queries in lexical order.
 * Dedupe by sourceId keeps one snippet per source — a listwise call billing
 * the same text twice would be pure waste.
 */
function collectCandidates(retrievalResult) {
    const seen = new Set();
    const candidates = [];
    for (const queryResult of retrievalResult?.results || []) {
        for (const match of queryResult.matches || []) {
            if (!match?.sourceId || seen.has(match.sourceId)) continue;
            seen.add(match.sourceId);
            candidates.push({
                id: match.sourceId,
                text: String(match.text || '').slice(0, CANDIDATE_SNIPPET_CHARS),
                queryIds: [queryResult.query?.id || null]
            });
        }
        if (candidates.length >= MAX_RERANK_CANDIDATES) break;
    }
    return candidates.slice(0, MAX_RERANK_CANDIDATES);
}

/**
 * Ambiguity gate: any query whose second-best match scores ≥80% of its best
 * match makes the candidate set worth a model pass. Deterministic and cheap.
 */
function isAmbiguous(retrievalResult) {
    for (const { matches } of retrievalResult?.results || []) {
        const scores = (matches || []).map((m) => m.score).filter((s) => typeof s === 'number');
        if (scores.length >= 2 && scores[1] >= AMBIGUITY_RATIO * scores[0]) return true;
    }
    return false;
}

function applyRerankScores(retrievalResult, scoreById) {
    const results = (retrievalResult?.results || []).map((queryResult) => ({
        ...queryResult,
        rerankStatus: 'active',
        matches: (queryResult.matches || [])
            .map((match) => ({
                ...match,
                rerankStatus: 'active',
                rerankScore: Object.prototype.hasOwnProperty.call(scoreById, match.sourceId)
                    ? scoreById[match.sourceId]
                    : null
            }))
            // Model score first, lexical rank as deterministic tiebreak.
            .sort((a, b) => (b.rerankScore ?? -1) - (a.rerankScore ?? -1) || (a.lexicalRank ?? 0) - (b.lexicalRank ?? 0))
    }));
    return { ...retrievalResult, results, rerankStatus: 'active' };
}

async function rerankEvidence(retrievalResult, options = {}) {
    const queries = Array.isArray(retrievalResult?.queries) ? retrievalResult.queries : [];
    const base = (() => {
        const rerankStatus = resolveRerankStatus(options);
        const results = (retrievalResult?.results || []).map((result) => ({
            ...result,
            rerankStatus,
            matches: (Array.isArray(result.matches) ? result.matches : []).map((match, matchIndex) => ({
                ...match,
                lexicalRank: matchIndex + 1,
                rerankStatus,
                rerankScore: null
            }))
        }));
        return {
            ...(retrievalResult || {}),
            queries,
            results,
            rerankStatus,
            metrics: {
                ...(retrievalResult?.metrics || {}),
                rerankedMatchCount: results.reduce((sum, result) => sum + result.matches.length, 0)
            }
        };
    })();

    const llmRerank = typeof options.llmRerank === 'function' ? options.llmRerank : null;
    if (!options.enabled || !llmRerank) return base;

    // Ambiguity gate unless explicitly forced (manual override switch).
    if (!options.force && !isAmbiguous(retrievalResult)) {
        return {
            ...base,
            rerankStatus: 'skipped',
            metrics: { ...base.metrics, rerankReason: 'not-ambiguous' }
        };
    }

    const candidates = collectCandidates(retrievalResult);
    let scored;
    try {
        scored = await llmRerank({ candidates });
    } catch (err) {
        return { ...base, metrics: { ...base.metrics, rerankReason: `model-error:${err.message}` } };
    }

    if (!Array.isArray(scored)) {
        return { ...base, metrics: { ...base.metrics, rerankReason: 'invalid-model-output' } };
    }

    const scoreById = {};
    for (const entry of scored) {
        if (!entry || typeof entry.id !== 'string' || !Number.isFinite(entry.score)) continue;
        scoreById[entry.id] = Math.max(0, Math.min(1, entry.score));
    }
    if (Object.keys(scoreById).length === 0) {
        return { ...base, metrics: { ...base.metrics, rerankReason: 'no-usable-scores' } };
    }

    return applyRerankScores(base, scoreById);
}

module.exports = {
    rerankEvidence,
    collectCandidates,
    isAmbiguous,
    MAX_RERANK_CANDIDATES,
    CANDIDATE_SNIPPET_CHARS
};
