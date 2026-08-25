// backend/court-analysis/reasoning/eval/scorers.js
//
// Purpose: Pure metric functions for the offline reasoning eval harness.
//          Retrieval recall/MRR against gold citation spans; amount
//          precision/recall/F1 against gold amounts; conflict detection rate
//          against applied mutations.
//
// Contract (RL-ready): every scorer takes plain JSON in, returns plain JSON
// out, never throws on empty inputs (returns value 0 with details explaining
// why), and has no I/O or clock access. Each result is a reward component:
//   { metric, value, details }  where value ∈ [0, 1] unless stated otherwise.

const { normalizeText } = require('../indexer');

function result(metric, value, details) {
    return { metric, value, details };
}

function flattenMatches(retrievalResult) {
    return (retrievalResult?.results || []).flatMap((queryResult) =>
        (queryResult.matches || []).map((match, index) => ({
            ...match,
            queryId: queryResult.query?.id || null,
            rank: index + 1
        }))
    );
}

function spanMatchesMatch(span, match) {
    if (span.sourceId && match.sourceId !== span.sourceId) return false;
    const haystack = normalizeText(match.text || '');
    return haystack.includes(normalizeText(span.textIncludes));
}

/**
 * Fraction of gold citation spans surfaced within the top-k matches per query,
 * unioned across queries — mirroring how synthesisInputBuilder consumes all
 * results regardless of which query produced them.
 */
function retrievalRecallAtK(retrievalResult, goldLabels, k) {
    const spans = goldLabels?.citationSpans || [];
    if (spans.length === 0) {
        return result(`retrieval.recall@${k}`, 0, { k, reason: 'no-gold-spans', hit: [] });
    }

    const perQuery = (retrievalResult?.results || []).map((qr) => (qr.matches || []).slice(0, k));
    const hit = spans.map((span) => perQuery.some((matches) => matches.some((match) => spanMatchesMatch(span, match))));
    const hits = hit.filter(Boolean).length;

    // Metric name embeds k so threshold configs can target specific windows
    // (e.g. "retrieval.recall@10") without ambiguous matching.
    return result(`retrieval.recall@${k}`, spans.length ? hits / spans.length : 0, {
        k,
        totalSpans: spans.length,
        hits,
        missedSpanIndexes: hit.reduce((acc, isHit, i) => (isHit ? acc : [...acc, i]), [])
    });
}

/** Mean reciprocal rank of the first gold span across the union of matches. */
function retrievalMrr(retrievalResult, goldLabels) {
    const spans = goldLabels?.citationSpans || [];
    if (spans.length === 0) return result('retrieval.mrr', 0, { reason: 'no-gold-spans' });

    const matches = flattenMatches(retrievalResult);
    let reciprocalSum = 0;
    for (const span of spans) {
        const rank = matches.findIndex((match) => spanMatchesMatch(span, match));
        if (rank >= 0) reciprocalSum += 1 / (rank + 1);
    }
    return result('retrieval.mrr', spans.length ? reciprocalSum / spans.length : 0, { totalSpans: spans.length });
}

const ABSOLUTE_AMOUNT_EPSILON = 0.01;

function amountMatches(goldAmount, entry) {
    if (!entry || typeof entry.amount !== 'number') return false;
    const currencyGold = String(goldAmount.currency || '').toUpperCase();
    const currencyEntry = String(entry.currency || '').toUpperCase();
    if (currencyGold && currencyEntry && currencyGold !== currencyEntry) return false;

    // descriptionIncludes disambiguates equal-value entries (e.g. two 25.000
    // EUR lines); normalized matching keeps it diacritics/case-insensitive.
    if (goldAmount.descriptionIncludes && !normalizeText(entry.description || '').includes(normalizeText(goldAmount.descriptionIncludes))) {
        return false;
    }

    // Relative tolerance wins when provided; otherwise a tight absolute epsilon.
    const tolerance = Number.isFinite(goldAmount.tolerancePct)
        ? Math.abs(goldAmount.value) * goldAmount.tolerancePct
        : ABSOLUTE_AMOUNT_EPSILON;
    return Math.abs(entry.amount - goldAmount.value) <= Math.max(tolerance, ABSOLUTE_AMOUNT_EPSILON);
}

/**
 * Amount extraction quality: greedy matching of gold amounts to extracted
 * money-flow entries. Precision penalizes hallucinated figures ONLY relative
 * to gold — so gold files should list every substantive amount to keep the
 * precision term meaningful.
 */
function amountScore(moneyFlowEntries, goldLabels) {
    const gold = goldLabels?.expectedAmounts || [];
    const entries = Array.isArray(moneyFlowEntries) ? moneyFlowEntries : [];

    if (gold.length === 0 && entries.length === 0) {
        return result('amount.f1', 1, { tp: 0, fp: 0, fn: 0, reason: 'both-empty' });
    }

    const used = new Set();
    let tp = 0;
    for (const goldAmount of gold) {
        const matchIndex = entries.findIndex((entry, i) => !used.has(i) && amountMatches(goldAmount, entry));
        if (matchIndex >= 0) {
            used.add(matchIndex);
            tp += 1;
        }
    }
    const fp = entries.length - tp;
    const fn = gold.length - tp;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return result('amount.f1', f1, {
        tp,
        fp,
        fn,
        precision,
        recall,
        unmatchedExtracted: entries.filter((_, i) => !used.has(i)).map((e) => e.amount)
    });
}

/**
 * Conflict detection rate over applied seeded mutations.
 * @param {Array<object>} applied - Ledger from conflictMutator.
 * @param {string[]} detectedTexts - Text from conflicts/openQuestions surfaces.
 */
function conflictDetectionRate(applied, detectedTexts) {
    const { mutationDetected } = require('./conflictMutator');
    const ledger = Array.isArray(applied) ? applied : [];
    if (ledger.length === 0) {
        return result('verify.conflictDetectionRate', 0, { reason: 'nothing-applied', appliedCount: 0 });
    }
    const perMutation = ledger.map((mutation) => ({
        kind: mutation.kind,
        path: mutation.path,
        detected: mutationDetected(mutation, detectedTexts)
    }));
    const detectedCount = perMutation.filter((m) => m.detected).length;
    return result('verify.conflictDetectionRate', detectedCount / ledger.length, {
        appliedCount: ledger.length,
        detectedCount,
        perMutation
    });
}

module.exports = {
    retrievalRecallAtK,
    retrievalMrr,
    amountScore,
    conflictDetectionRate
};
