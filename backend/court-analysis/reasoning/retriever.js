const { createRetrievalQueries } = require('./retrievalQueries');
const { buildLexicalIndex, collectSources, normalizeText, tokenize } = require('./indexer');

function scoreSource(source, retrievalQuery, evidencePackage) {
    const normalizedSource = normalizeText(source.text);
    const queryTokens = tokenize(retrievalQuery.text);
    const reasons = [];
    let score = 0;

    for (const token of queryTokens) {
        if (normalizedSource.includes(token)) {
            score += 1;
            reasons.push(`token:${token}`);
        }
    }

    for (const anchor of retrievalQuery.anchors || []) {
        const normalizedAnchor = normalizeText(anchor);
        if (normalizedAnchor && normalizedSource.includes(normalizedAnchor)) {
            const boost = retrievalQuery.queryType === 'oib' && /^\d{11}$/.test(String(anchor)) ? 5 : 3;
            score += boost;
            reasons.push(`anchor:${anchor}`);
        }
    }

    const sourceCaseNumber = source.metadata?.caseNumber;
    if (sourceCaseNumber && evidencePackage?.clusterId && sourceCaseNumber === evidencePackage.clusterId) {
        score += 2;
        reasons.push('same-cluster');
    }

    return {
        score,
        reasons
    };
}

function retrieveEvidence(evidencePackage, options = {}) {
    const queries = Array.isArray(options.queries) && options.queries.length > 0
        ? options.queries
        : createRetrievalQueries({
            query: evidencePackage?.query,
            clusterId: evidencePackage?.clusterId,
            primaryCaseNumber: evidencePackage?.primaryCaseNumber,
            identity: evidencePackage?.identity
        });
    const topK = options.topK || 5;
    const index = options.index || buildLexicalIndex(evidencePackage);

    const results = queries.map((query) => {
        const matches = index.sources
            .map((source, sourceIndex) => {
                const scored = scoreSource(source, query, evidencePackage);
                return {
                    sourceId: source.id,
                    text: source.text,
                    score: scored.score,
                    reasons: scored.reasons,
                    metadata: source.metadata,
                    sourceIndex
                };
            })
            .filter((match) => match.score > 0)
            .sort((a, b) => b.score - a.score || a.sourceIndex - b.sourceIndex)
            .slice(0, topK)
            .map(({ sourceIndex, ...match }) => match);

        return {
            query,
            matches
        };
    });

    return {
        queries,
        results,
        metrics: {
            queryCount: queries.length,
            sourceCount: index.sources.length,
            indexBuildTimeMs: index.metrics.buildTimeMs,
            tokenCount: index.metrics.tokenCount,
            matchCount: results.reduce((sum, result) => sum + result.matches.length, 0)
        }
    };
}

module.exports = {
    collectSources,
    retrieveEvidence,
    tokenize
};
