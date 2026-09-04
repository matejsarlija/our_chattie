// backend/court-analysis/reasoning/grounding.js
//
// Per-document grounding check: deterministic quote-containment verification
// applied at extraction time (one stage earlier than cluster-level
// isClaimCited). Reuses normalizeText from indexer.js; tolerant of
// whitespace/line-break/OCR noise via whitespace collapsing.
//
// Never throws: empty/missing quotes degrade to grounded:false.
// Forward-only: no retroactive re-verification of cached analyses.

const { normalizeText } = require('./indexer');

function collapseWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForGrounding(value) {
    return collapseWhitespace(normalizeText(value));
}

/**
 * Deterministic containment check: does `quote` appear in `sourceText`?
 * @param {string} quote - verbatim supporting quote from the model.
 * @param {string} sourceText - raw document text.
 * @returns {boolean} true when grounded, false otherwise (incl. missing quote).
 */
function isQuoteGrounded(quote, sourceText) {
    if (typeof quote !== 'string' || !quote.trim()) return false;
    if (typeof sourceText !== 'string' || !sourceText.trim()) return false;
    const normalizedQuote = normalizeForGrounding(quote);
    if (!normalizedQuote) return false;
    // Very short quotes (<4 chars normalized) are too generic to verify.
    if (normalizedQuote.length < 4) return false;
    const normalizedSource = normalizeForGrounding(sourceText);
    if (!normalizedSource) return false;
    return normalizedSource.includes(normalizedQuote);
}

/**
 * Marks every entry in amounts[] + propertyFlow[] with grounded:true/false.
 * Mutates copies, never throws; missing arrays degrade to [].
 * @param {object} aiResult - per-document analysis result.
 * @param {string} sourceText - raw document text.
 * @returns {object} the same aiResult object (for chaining).
 */
function applyGroundingToAnalysis(aiResult, sourceText) {
    if (!aiResult || typeof aiResult !== 'object') return aiResult;
    for (const key of ['amounts', 'propertyFlow']) {
        const entries = aiResult[key];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            try {
                entry.grounded = isQuoteGrounded(entry.quote, sourceText);
            } catch {
                entry.grounded = false;
            }
        }
    }
    return aiResult;
}

/**
 * Counts grounded/total claims across amounts[] + propertyFlow[].
 * Entries without a verified quote count toward total but not grounded.
 * @param {Array<object>} analyses - attached analyses (carrying amounts/propertyFlow).
 * @returns {{groundedClaims: number, totalClaims: number}}
 */
function countGroundedClaims(analyses) {
    let groundedClaims = 0;
    let totalClaims = 0;
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        for (const key of ['amounts', 'propertyFlow']) {
            const entries = analysis?.[key];
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
                totalClaims += 1;
                if (entry?.grounded === true) groundedClaims += 1;
            }
        }
    }
    return { groundedClaims, totalClaims };
}

module.exports = {
    isQuoteGrounded,
    applyGroundingToAnalysis,
    countGroundedClaims,
    normalizeForGrounding,
};
