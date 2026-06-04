function resolveRerankStatus(options = {}) {
    return options.enabled ? 'fallback' : 'skipped';
}

function rerankEvidence(retrievalResult, options = {}) {
    const rerankStatus = resolveRerankStatus(options);
    const queries = Array.isArray(retrievalResult?.queries) ? retrievalResult.queries : [];
    const results = Array.isArray(retrievalResult?.results) ? retrievalResult.results : [];

    const rerankedResults = results.map((result) => ({
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
        results: rerankedResults,
        rerankStatus,
        metrics: {
            ...(retrievalResult?.metrics || {}),
            rerankedMatchCount: rerankedResults.reduce((sum, result) => sum + result.matches.length, 0)
        }
    };
}

module.exports = {
    rerankEvidence
};
