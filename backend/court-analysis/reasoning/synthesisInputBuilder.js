const { normalizeReasoningEvidence } = require('./synthesizer');

function isSelectedClusterMatch(match, clusterId) {
    const matchCaseNumber = match?.metadata?.caseNumber;
    return !clusterId || !matchCaseNumber || matchCaseNumber === clusterId;
}

function buildRetrievedEvidenceClaims(rerankedRetrieval, clusterEvidencePackage) {
    const clusterId = clusterEvidencePackage?.clusterId;

    return (rerankedRetrieval?.results || []).flatMap((result, resultIndex) => (
        (result.matches || [])
            .filter((match) => isSelectedClusterMatch(match, clusterId))
            .map((match, matchIndex) => ({
                id: `retrieved-${result.query?.id || resultIndex + 1}-${matchIndex + 1}`,
                text: `Relevantni izvor (${result.query?.purpose || result.query?.id || 'retrieval'}): ${match.text}`,
                confidence: 'medium',
                evidence: [{
                    sourceId: match.sourceId || `retrieved-${resultIndex + 1}-${matchIndex + 1}`,
                    text: match.text,
                    retrievalScore: match.score,
                    retrievalReasons: match.reasons || [],
                    lexicalRank: match.lexicalRank ?? null,
                    rerankStatus: match.rerankStatus || rerankedRetrieval?.rerankStatus || null,
                    rerankScore: match.rerankScore ?? null,
                    metadata: match.metadata || null
                }]
            }))
    ));
}

function buildSynthesisInput(clusterEvidencePackage, retrieval, rerankedRetrieval = retrieval) {
    const normalizedEvidence = normalizeReasoningEvidence(clusterEvidencePackage);
    const retrievedClaims = buildRetrievedEvidenceClaims(rerankedRetrieval, clusterEvidencePackage);

    return {
        ...(normalizedEvidence || {}),
        timeline: normalizedEvidence?.timeline || [],
        claims: [
            ...(normalizedEvidence?.claims || []),
            ...retrievedClaims
        ],
        meta: {
            ...(normalizedEvidence?.meta || {}),
            retrieval,
            rerank: rerankedRetrieval
        }
    };
}

module.exports = {
    buildSynthesisInput,
    buildRetrievedEvidenceClaims
};
