// court-analysis/reasoning/nearDuplicateReview.js
//
// TX-3 research spike: near-duplicate attachment review WITHOUT merging.
//
// Same document re-scanned or re-saved under a new upload gets fresh bytes,
// so the content-hash dedupe (factLedger/flow) cannot see it as identical.
// This module flags CANDIDATE pairs on deterministic, reviewable signals
// only — same normalized filename with different bytes, same title+date
// with different bytes — and records `verdict: 'review-needed'` for a human
// or a future deterministic criterion. It never deletes, suppresses, or
// skips anything: both sources are always retained.
//
// Deliberately NOT wired into the pipeline (see the TX-3 go/no-go note in
// analysis-quality-tickets.md): filename signals are too weak for production
// (generic e-Oglasna names like `Podnesak.pdf` collide constantly across
// genuinely distinct filings — proven distinct by the TD-1 census), and true
// content similarity needs embeddings no deterministic rule can supply.

function normalizeFileKey(name) {
    if (typeof name !== 'string') return null;
    const base = name.split(/[\\/]/).pop().trim().toLowerCase();
    return base || null;
}

function pairKey(a, b) {
    return [String(a), String(b)].sort().join('::');
}

/**
 * Finds near-duplicate candidate pairs among attached analyses.
 * @param {Array<object>} analyses - Normalized analysis records (id,
 *   fileName, filePath, caseNumber, decisionDate/entryDate, contentHash).
 * @returns {{ candidates: Array, reviewedPairs: number }}
 *   Each candidate: `{ analysisIds, fileNames, signals, verdict }` where
 *   `verdict` is always `'review-needed'`.
 */
function findNearDuplicateCandidates(analyses) {
    const list = (Array.isArray(analyses) ? analyses : []).filter((a) => a && typeof a === 'object');
    const candidates = [];
    const seen = new Set();
    let reviewedPairs = 0;

    for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
            reviewedPairs += 1;
            const a = list[i];
            const b = list[j];
            // Identical bytes are the dedupe path's job, not a candidate.
            if (a.contentHash && b.contentHash && a.contentHash === b.contentHash) continue;
            // Without bytes on both sides, similarity is unprovable.
            if (!a.contentHash || !b.contentHash) continue;

            const signals = [];
            const keyA = normalizeFileKey(a.fileName || a.filePath);
            const keyB = normalizeFileKey(b.fileName || b.filePath);
            if (keyA && keyB && keyA === keyB) signals.push('same-filename-different-bytes');
            // Deliberately no weaker signal (same case/date, similar titles):
            // prototyped during this spike, it fires on nearly every pair in
            // a cluster (shared case + shared publish day) and produces
            // review noise proportional to n² instead of a review instrument.
            // See the TX-3 go/no-go note in analysis-quality-tickets.md.
            if (signals.length === 0) continue;

            const key = pairKey(a.id || `idx-${i}`, b.id || `idx-${j}`);
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({
                analysisIds: [a.id || null, b.id || null],
                fileNames: [a.fileName || a.filePath || null, b.fileName || b.filePath || null],
                signals,
                verdict: 'review-needed'
            });
        }
    }
    return { candidates, reviewedPairs };
}

module.exports = {
    findNearDuplicateCandidates,
    normalizeFileKey
};
