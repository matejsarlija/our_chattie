// backend/court-analysis/reasoning/findingProvenance.js
//
// M-09 — link findings back to the retrieval that surfaced them. A finding's
// citation answers "which document says this" (grounding proves the claim
// matches that document); `retrievedBy` answers the other half — "which
// retrieval query pulled that document in, and why did it score highly
// enough to matter" (query text, match score, match reasons).
//
// Pure deterministic join over persisted shapes, never a model call:
// citation `{source, fileName}` ↔ retrieval match `{sourceId, fileName}`.
// No match → no `retrievedBy` key (payload stays lean). Never throws.

const MAX_LINKS_PER_CITATION = 3;

function norm(value) {
    return String(value || '').trim().toLowerCase();
}

function citationKeys(citation) {
    const keys = new Set();
    for (const raw of [citation?.source, citation?.sourceId, citation?.fileName]) {
        const key = norm(raw);
        if (key) keys.add(key);
    }
    return keys;
}

function matchKeys(match) {
    const keys = new Set();
    for (const raw of [match?.sourceId, match?.fileName, match?.metadata?.fileName]) {
        const key = norm(raw);
        if (key) keys.add(key);
    }
    return keys;
}

function matchesCitation(citation, match) {
    const cKeys = citationKeys(citation);
    if (cKeys.size === 0) return false;
    const mKeys = matchKeys(match);
    for (const key of cKeys) {
        if (mKeys.has(key)) return true;
    }
    return false;
}

/**
 * @param {Array} findings - Report findings carrying `citations` arrays.
 * @param {object} retrieval - Raw retrieval output (`results[].{query, matches[]}`
 * with match `{score, reasons}`).
 * @returns {Array} Findings with per-citation `retrievedBy` links where the
 * join hits. Input is never mutated.
 */
function annotateFindingsWithRetrieval(findings, retrieval) {
    if (!Array.isArray(findings)) return findings;
    const results = Array.isArray(retrieval?.results) ? retrieval.results : [];
    if (results.length === 0) return findings;

    return findings.map((finding) => {
        if (!finding || typeof finding !== 'object' || !Array.isArray(finding.citations)) {
            return finding;
        }
        const citations = finding.citations.map((citation) => {
            if (!citation || typeof citation !== 'object') return citation;
            const links = [];
            for (const result of results) {
                const query = result?.query || {};
                for (const match of result?.matches || []) {
                    if (!matchesCitation(citation, match)) continue;
                    links.push({
                        queryId: query?.id || null,
                        queryText: query?.text || null,
                        queryPurpose: query?.purpose || null,
                        planned: String(query?.id || '').startsWith('planned-'),
                        score: typeof match?.score === 'number'
                            ? Number(match.score.toFixed(3))
                            : null,
                        reasons: Array.isArray(match?.reasons) ? match.reasons.slice(0, 8) : [],
                    });
                }
            }
            if (links.length === 0) return citation;
            links.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
            return { ...citation, retrievedBy: links.slice(0, MAX_LINKS_PER_CITATION) };
        });
        return { ...finding, citations };
    });
}

module.exports = {
    annotateFindingsWithRetrieval,
    MAX_LINKS_PER_CITATION,
};
