// backend/court-analysis/reasoning/followUpVerification.js
//
// Purpose: Conflict-triggered re-verification (Phase 1.1). When the report
//          carries conflicts — model-found contradictions or deterministic
//          reconciliation mismatches — pull `around()` passages from the
//          indexed ground truth for BOTH sides and run ONE targeted
//          re-verify call. Hard cap: exactly one call per run.
//
// Conservative merge contract: outcomes ANNOTATE (conflict.followUp), never
// delete findings or conflicts — same passthrough-diet ethos as verifier.js.
// A refuted conflict surfaces as an openQuestion so a human looks at it,
// instead of silently flipping report semantics on one model opinion.

const { buildLexicalIndex, tokenize, normalizeText } = require('./indexer');
const { retrieveEvidence } = require('./retriever');
const { extractJsonBlock } = require('../../helpers/jsonExtract');

const MAX_CONFLICTS_PER_PASS = 3;
const PASSAGES_PER_CONFLICT = 2;
const AROUND_WINDOW_CHARS = 280;
const QUERY_TOKEN_LIMIT = 8;

function needsFollowUp(report) {
    return Array.isArray(report?.conflicts) && report.conflicts.length > 0;
}

/**
 * Builds a focused query from a conflict's finding text: rarest long tokens
 * first (they discriminate documents better than boilerplate legal vocab).
 */
function conflictQueryText(findingText) {
    const tokens = [...new Set(tokenize(String(findingText || '')))]
        .filter((token) => token.length >= 4)
        .slice(0, QUERY_TOKEN_LIMIT);
    return tokens.join(' ');
}

/**
 * Extracts an `around()` passage: the ±AROUND_WINDOW_CHARS window centered on
 * the first matched token occurrence in the source text.
 */
function aroundPassage(sourceText, queryTokens) {
    const normalized = normalizeText(sourceText);
    let cut = -1;
    for (const token of queryTokens) {
        const index = normalized.indexOf(normalizeText(token));
        if (index >= 0) { cut = index; break; }
    }
    if (cut < 0) return String(sourceText || '').slice(0, AROUND_WINDOW_CHARS);
    const start = Math.max(0, cut - Math.floor(AROUND_WINDOW_CHARS / 2));
    return sourceText.slice(start, start + AROUND_WINDOW_CHARS * 2);
}

/**
 * Collects ground-truth passages for up to MAX_CONFLICTS_PER_PASS conflicts.
 * Deterministic given (report, pkg): no RNG, stable order.
 */
function collectConflictPassages(report, evidencePackage) {
    const indexSource = {
        ...evidencePackage,
        chunks: evidencePackage.chunks || []
    };
    let index;
    try {
        index = buildLexicalIndex(indexSource);
    } catch (err) {
        return [];
    }
    if (!index.sources.length) return [];

    const conflicts = (report.conflicts || []).slice(0, MAX_CONFLICTS_PER_PASS);
    const collected = [];
    for (const conflict of conflicts) {
        const queryTokens = tokenize(conflictQueryText(conflict.finding));
        if (queryTokens.length === 0) continue;

        const retrieval = retrieveEvidence(indexSource, {
            index,
            queries: [{ id: 'follow-up', purpose: 'conflict-grounding', text: queryTokens.join(' '), anchors: [], queryType: 'text' }],
            topK: PASSAGES_PER_CONFLICT
        });

        const passages = (retrieval.results[0]?.matches || []).map((match) => ({
            sourceId: match.sourceId,
            passage: aroundPassage(match.text, queryTokens)
        }));
        if (passages.length > 0) {
            collected.push({ finding: conflict.finding, reason: conflict.reason || '', passages });
        }
    }
    return collected;
}

function buildFollowUpPrompt(collected) {
    const sections = collected.map((entry, index) => [
        `KONFLIKT ${index + 1}: ${entry.finding}`,
        entry.reason ? `Razlog konflikta: ${entry.reason}` : null,
        ...entry.passages.map((p) => `DOKAZ [${p.sourceId}]: …${p.passage}…`),
        null
    ].filter(Boolean).join('\n'));

    return [
        'Ti si strog pravni verifikacijski mehanizam. Za SVAKI konflikt dolje odluči podržavaju li navedeni dokazi iz izvornih dokumenata tu zamjerku.',
        'Odgovori strogo JSON poljem bez ikakvog drugog teksta:',
        '[{"index":1,"verdict":"upheld|refuted|unclear","reason":"kratko objašnjenje na hrvatskom"}]',
        '',
        sections.join('\n')
    ].join('\n');
}

/**
 * Runs the single follow-up verification pass. Never throws — any failure
 * returns the original report untouched (the pipeline must not regress).
 *
 * @param {object} report - Verified report.
 * @param {object} evidencePackage - Cluster evidence package (with chunks).
 * @param {object} options - { followUpLlm: async (prompt) => string content,
 *                             tracker, onUsage, logger }
 */
async function runFollowUpVerification(report, evidencePackage, options = {}) {
    const { followUpLlm, tracker = null, onUsage = null } = options;
    const logger = options.logger || { warn: () => {}, error: () => {} };

    if (typeof followUpLlm !== 'function' || !needsFollowUp(report)) {
        return { report, called: false };
    }

    const collected = collectConflictPassages(report, evidencePackage);
    if (collected.length === 0) {
        return { report, called: false };
    }

    // Exactly ONE model call per run — the cap is structural, not advisory.
    let verdicts;
    try {
        const response = await followUpLlm({
            prompt: buildFollowUpPrompt(collected),
            tracker,
            onUsage
        });
        verdicts = extractJsonBlock(response);
    } catch (err) {
        logger.warn(`[FollowUp] Re-verification failed; report unchanged (${err.message})`);
        return { report, called: true };
    }

    if (!verdicts) {
        logger.warn('[FollowUp] Unparseable re-verification output; report unchanged.');
        return { report, called: true };
    }

    const verdictByIndex = new Map();
    for (const v of verdicts) {
        if (v && Number.isFinite(v.index) && ['upheld', 'refuted', 'unclear'].includes(v.verdict)) {
            verdictByIndex.set(v.index, v);
        }
    }

    const openQuestions = [...(report.openQuestions || [])];
    const annotatedConflicts = report.conflicts.map((conflict, i) => {
        const verdict = verdictByIndex.get(i + 1);
        if (!verdict) return conflict;
        if (verdict.verdict === 'refuted') {
            openQuestions.push(`Prvotno uočeni konflikt "${String(conflict.finding).slice(0, 120)}" nije potvrđen izvornim dokazima — provjeriti ručno.`);
        }
        return { ...conflict, followUp: { verdict: verdict.verdict, reason: verdict.reason || '' } };
    });

    return {
        report: { ...report, conflicts: annotatedConflicts, openQuestions },
        called: true
    };
}

module.exports = {
    needsFollowUp,
    collectConflictPassages,
    runFollowUpVerification,
    buildFollowUpPrompt,
    aroundPassage,
    conflictQueryText,
    MAX_CONFLICTS_PER_PASS
};
