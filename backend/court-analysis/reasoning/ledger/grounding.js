// backend/court-analysis/reasoning/grounding.js
//
// Per-document grounding check: deterministic quote-containment verification
// applied at extraction time (one stage earlier than cluster-level
// isClaimCited). Reuses normalizeText from indexer.js; tolerant of
// whitespace/line-break/OCR noise via whitespace collapsing.
//
// Never throws: empty/missing quotes degrade to grounded:false.
// Forward-only: no retroactive re-verification of cached analyses.

const { normalizeText } = require('../retrieval/indexer');

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

// Party identifiers are identity evidence, not approximate prose. Only spaces
// and hyphens between digits are formatting separators; never repair digits
// or discard arbitrary characters to manufacture an OIB match.
function isDocumentPartyGrounded(entry, sourceText) {
    if (typeof entry.oib !== 'string' || !/^[\d\s-]+$/.test(entry.oib)) return false;
    const oib = entry.oib.replace(/[\s-]/g, '');
    if (!/^\d{11}$/.test(oib)) return false;
    if (typeof entry.quote !== 'string' || typeof sourceText !== 'string') return false;
    const normalizeEvidence = (text) => normalizeForGrounding(text)
        .replace(/(\d)[\s-]+(?=\d)/g, '$1');
    const quote = normalizeEvidence(entry.quote);
    const source = normalizeEvidence(sourceText);
    const identifier = new RegExp(`(^|[^a-z0-9])${oib}(?![a-z0-9])`);
    if (!identifier.test(quote)) return false;
    const escapedQuote = quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startBoundary = /^[a-z0-9]/.test(quote) ? '(?<![a-z0-9])' : '';
    const endBoundary = /[a-z0-9]$/.test(quote) ? '(?![a-z0-9])' : '';
    return new RegExp(`${startBoundary}${escapedQuote}${endBoundary}`).test(source);
}

/**
 * Marks every entry in amounts[] + propertyFlow[] + proceduralEvents[] with
 * grounded:true/false.
 * Mutates copies, never throws; missing arrays degrade to [].
 * @param {object} aiResult - per-document analysis result.
 * @param {string} sourceText - raw document text.
 * @returns {object} the same aiResult object (for chaining).
 */
function applyGroundingToAnalysis(aiResult, sourceText) {
    if (!aiResult || typeof aiResult !== 'object') return aiResult;
    for (const key of ['documentParties', 'amounts', 'propertyFlow', 'proceduralEvents']) {
        const entries = aiResult[key];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            try {
                entry.grounded = key === 'documentParties'
                    ? isDocumentPartyGrounded(entry, sourceText)
                    : isQuoteGrounded(entry.quote, sourceText);
            } catch {
                entry.grounded = false;
            }
        }
    }
    return aiResult;
}

/**
 * Counts grounded/total claims across amounts + propertyFlow, and separately
 * counts procedural events so existing claim ratios keep their meaning.
 */
function countGroundedClaims(analyses) {
    let groundedClaims = 0;
    let totalClaims = 0;
    let groundedProceduralEvents = 0;
    let totalProceduralEvents = 0;
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        for (const key of ['amounts', 'propertyFlow']) {
            const entries = analysis?.[key];
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
                totalClaims += 1;
                if (entry?.grounded === true) groundedClaims += 1;
            }
        }
        for (const event of Array.isArray(analysis?.proceduralEvents) ? analysis.proceduralEvents : []) {
            totalProceduralEvents += 1;
            if (event?.grounded === true) groundedProceduralEvents += 1;
        }
    }
    const counts = { groundedClaims, totalClaims };
    if (totalProceduralEvents > 0) {
        counts.groundedProceduralEvents = groundedProceduralEvents;
        counts.totalProceduralEvents = totalProceduralEvents;
    }
    return counts;
}

module.exports = {
    isQuoteGrounded,
    applyGroundingToAnalysis,
    countGroundedClaims,
    normalizeForGrounding,
};
