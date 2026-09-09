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

// Token-overlap fallback threshold. Exact containment above stays the fast
// path; this only rescues quotes with a single paraphrased/OCR-mangled
// token out of several — a wholly invented quote still fails (see tests).
// MIN_TOKENS is 5, not 4: at 4 tokens a single mismatch is 3/4 = 0.75,
// which fails the 0.8 threshold, so "tolerates one mismatched word" only
// actually holds true starting at 5 tokens (4/5 = 0.8).
const GROUNDING_TOKEN_OVERLAP_THRESHOLD = 0.8;
const GROUNDING_FUZZY_MIN_TOKENS = 5;

function groundingTokens(value) {
    return normalizeForGrounding(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
}

/**
 * Deterministic containment check: does `quote` appear in `sourceText`?
 * Exact normalized containment first; failing that, a token-overlap
 * fallback (≥80% of the quote's ≥3-char tokens present in the source, quotes
 * with ≥4 such tokens only) tolerates one paraphrased or OCR-mangled word
 * without letting invented quotes through.
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
    if (normalizedSource.includes(normalizedQuote)) return true;
    const quoteTokens = groundingTokens(quote);
    if (quoteTokens.length < GROUNDING_FUZZY_MIN_TOKENS) return false;
    const sourceTokenSet = new Set(normalizedSource.split(/[^a-z0-9]+/));
    const hits = quoteTokens.filter((token) => sourceTokenSet.has(token)).length;
    return hits / quoteTokens.length >= GROUNDING_TOKEN_OVERLAP_THRESHOLD;
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
