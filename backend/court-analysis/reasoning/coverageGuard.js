function isPoorDocumentCoverage(coverage) {
    if (!coverage || !Number.isFinite(coverage.total) || coverage.total <= 0) {
        return false;
    }

    const analyzed = Number.isFinite(coverage.analyzed) ? coverage.analyzed : 0;
    const failed = Number.isFinite(coverage.failed) ? coverage.failed : Math.max(0, coverage.total - analyzed);

    // A majority of unavailable analyses means titles and download links can
    // describe the corpus, but cannot safely support substantive conclusions.
    return analyzed === 0 || failed >= analyzed;
}

function coverageOpenQuestion(coverage) {
    return `Analiza dokumenata nije potpuna (${coverage.analyzed || 0} od ${coverage.total || 0} uspješno obrađeno); zaključci utemeljeni samo na naslovima i poveznicama ostaju otvoreni.`;
}

function analysisSourceIds(evidencePackage) {
    return new Set((evidencePackage?.claims || []).flatMap((claim) =>
        (claim.evidence || [])
            .filter((evidence) => evidence?.metadata?.sourceType === 'analysis')
            .map((evidence) => evidence.sourceId)
            .filter(Boolean)
    ));
}

function findingHasAnalysisCitation(finding, sourceIds) {
    return (finding?.citations || []).some((citation) => {
        const sourceId = typeof citation === 'string'
            ? citation
            : citation?.sourceId || citation?.source;
        return sourceIds.has(sourceId);
    });
}

function applyCoverageConfidenceGuard(findings, evidencePackage) {
    const coverage = evidencePackage?.meta?.coverage;
    if (!isPoorDocumentCoverage(coverage)) return Array.isArray(findings) ? findings : [];

    const sourceIds = analysisSourceIds(evidencePackage);
    return (findings || []).map((finding) => (
        findingHasAnalysisCitation(finding, sourceIds)
            ? finding
            : { ...finding, confidence: 'low' }
    ));
}

module.exports = {
    isPoorDocumentCoverage,
    coverageOpenQuestion,
    applyCoverageConfidenceGuard
};
