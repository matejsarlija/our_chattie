const { createRetrievalQueries } = require('./retrievalQueries');
const { buildLexicalIndex, collectSources, normalizeText, tokenize } = require('./indexer');

// Hybrid token scoring weights (Phase 0.4). Substring matching stays as a
// fallback signal — it acts as accidental Croatian stemming (trazbina matches
// trazbine) — but exact-token agreement earns full weight and IDF scaling
// demotes generic vocabulary that appears in nearly every source.
const EXACT_TOKEN_WEIGHT = 1;
const STEM_MATCH_WEIGHT = 0.4;

function scoreSource(source, retrievalQuery, evidencePackage, idfStats = null) {
    const normalizedSource = normalizeText(source.text);
    const sourceTokenSet = new Set(source.tokens || []);
    const queryTokens = tokenize(retrievalQuery.text);
    const reasons = [];
    let score = 0;

    for (const token of queryTokens) {
        let weight = 0;
        let reasonKind = null;
        if (sourceTokenSet.has(token)) {
            weight = EXACT_TOKEN_WEIGHT;
            reasonKind = `token:${token}`;
        } else if (normalizedSource.includes(token)) {
            // Substring hit on the normalized text — pseudo-stemming credit.
            weight = STEM_MATCH_WEIGHT;
            reasonKind = `stem:${token}`;
        }
        if (weight === 0) continue;

        if (idfStats && idfStats.totalSources > 0) {
            const documentFrequency = idfStats.df?.[token] || 0;
            const idf = Math.log(1 + idfStats.totalSources / (documentFrequency || 0.5));
            // Squash to (0, 1] so scores stay comparable with/without stats.
            weight *= idf / (idf + 1);
        }
        score += weight;
        reasons.push(reasonKind);
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
                const scored = scoreSource(source, query, evidencePackage, index.idfStats || null);
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
            sourceTypeCounts: index.metrics.sourceTypeCounts,
            matchCount: results.reduce((sum, result) => sum + result.matches.length, 0)
        }
    };
}

module.exports = {
    collectSources,
    retrieveEvidence,
    tokenize
};
