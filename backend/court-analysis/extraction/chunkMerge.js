'use strict';

const OVERLAP_ANCHOR_CHARS = 400;

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function findQuoteIndexInSegmentRange(sourceText, segment, quote) {
    const text = String(sourceText || '');
    const q = String(quote || '').trim();
    if (!text || !q) return -1;

    const segStart = Number.isFinite(segment?.startIndex) ? segment.startIndex : 0;
    const segEnd = Number.isFinite(segment?.endIndex) ? segment.endIndex : text.length;
    const searchStart = Math.max(0, segStart - OVERLAP_ANCHOR_CHARS);
    const searchEnd = Math.min(text.length, segEnd + OVERLAP_ANCHOR_CHARS);

    const windowSlice = text.slice(searchStart, searchEnd);
    const exactOffset = windowSlice.indexOf(q);
    if (exactOffset !== -1) {
        return searchStart + exactOffset;
    }

    // Fallback: normalized whitespace match strictly within the bounded window
    const normWindow = normalizeWhitespace(windowSlice);
    const normQuote = normalizeWhitespace(q);
    if (normQuote && normWindow.includes(normQuote)) {
        return Math.max(searchStart, segStart);
    }

    // Last resort: check exact text only if its match falls within [searchStart, searchEnd]
    const globalMatch = text.indexOf(q, searchStart);
    if (globalMatch !== -1 && globalMatch < searchEnd) {
        return globalMatch;
    }

    return -1;
}

function resolveDecisionDateAcrossChunks(successes) {
    if (!Array.isArray(successes) || successes.length === 0) return null;
    const first = successes[0]?.value?.decisionDate;
    if (first) return first;
    const last = successes[successes.length - 1]?.value?.decisionDate;
    if (last) return last;
    return successes.find(({ value }) => value?.decisionDate)?.value.decisionDate || null;
}

function buildFactOverlapIdentity(field, fact, quote) {
    const val = fact?.amountEur ?? fact?.amount ?? fact?.value ?? null;
    const cur = fact?.currency || '';
    const reg = fact?.claimRegistryNumber || '';
    const normQ = normalizeWhitespace(quote).slice(0, 120);
    if (normQ) {
        return JSON.stringify([field, val, cur, reg || null, normQ]);
    }
    return JSON.stringify(Object.keys(fact || {}).sort().map((key) => [key, fact[key]]));
}

function mergeAnalysisChunkResults(chunkResults, sourceText = '') {
    const ordered = [...(chunkResults || [])].sort(
        (a, b) => (a?.segment?.startIndex ?? 0) - (b?.segment?.startIndex ?? 0),
    );
    const successes = ordered.filter((result) => result && result.value);

    const factsFor = (field) => {
        const merged = [];
        const seen = new Map();
        for (const { segment, value } of successes) {
            for (const fact of Array.isArray(value[field]) ? value[field] : []) {
                const quote = typeof fact?.quote === 'string' ? fact.quote.trim() : '';
                const identity = (quote || fact?.claimRegistryNumber)
                    ? buildFactOverlapIdentity(field, fact, quote)
                    : null;
                const quoteStart = quote
                    ? findQuoteIndexInSegmentRange(sourceText, segment, quote)
                    : (Number.isFinite(segment?.startIndex) ? segment.startIndex : -1);
                const quoteLen = quote ? quote.length : 0;

                const duplicateFromOverlap = identity && quoteStart >= 0
                    ? (seen.get(identity) || []).some((prior) => {
                        const overlapStart = Math.max(prior.segment.startIndex ?? 0, segment.startIndex ?? 0);
                        const overlapEnd = Math.min(prior.segment.endIndex ?? 0, segment.endIndex ?? 0);
                        if (overlapStart >= overlapEnd) return false;
                        if (!quote) return Boolean(fact?.claimRegistryNumber);
                        return quoteStart < overlapEnd && (quoteStart + quoteLen) > overlapStart;
                    })
                    : false;
                if (duplicateFromOverlap) continue;

                const mergedFact = {
                    ...fact,
                    sourceChunkId: segment.id,
                    sourceStartIndex: segment.startIndex,
                    sourceEndIndex: segment.endIndex,
                    sourcePages: segment.pageNumbers,
                };
                merged.push(mergedFact);
                if (identity) {
                    const prior = seen.get(identity) || [];
                    prior.push({ segment, fact: mergedFact });
                    seen.set(identity, prior);
                }
            }
        }
        return merged;
    };

    const summaries = [...new Set(successes.map(({ value }) => value.summary).filter(Boolean))];
    const keyClaims = [...new Set(
        successes.flatMap(({ value }) => (Array.isArray(value.keyClaims) ? value.keyClaims : [])),
    )].slice(0, 12);
    const citedFilingReferences = [...new Set(
        successes.flatMap(({ value }) => (Array.isArray(value.citedFilingReferences) ? value.citedFilingReferences : [])),
    )];

    const decisionOutcome = successes.find(({ value }) => value.decisionOutcome && value.decisionOutcome !== 'unknown')?.value.decisionOutcome
        || (successes.some(({ value }) => value.decisionOutcome === 'unknown') ? 'unknown' : null);

    return {
        caseNumber: successes.find(({ value }) => value.caseNumber)?.value.caseNumber || null,
        decisionDate: resolveDecisionDateAcrossChunks(successes),
        summary: summaries.join('\n\n'),
        ...(keyClaims.length > 0 ? { keyClaims } : {}),
        decisionOutcome,
        documentParties: factsFor('documentParties'),
        amounts: factsFor('amounts'),
        propertyFlow: factsFor('propertyFlow'),
        proceduralEvents: factsFor('proceduralEvents'),
        citedFilingReferences,
        gaps: successes.flatMap(({ segment, gaps }) => (
            (gaps || []).map((gap) => ({ ...gap, chunkId: segment.id }))
        )),
        assignmentCueGaps: successes
            .filter((result) => result.assignmentCueGap)
            .map(({ segment, assignmentCueGap }) => ({ ...assignmentCueGap, chunkId: segment.id })),
    };
}

module.exports = {
    OVERLAP_ANCHOR_CHARS,
    findQuoteIndexInSegmentRange,
    resolveDecisionDateAcrossChunks,
    mergeAnalysisChunkResults,
};
