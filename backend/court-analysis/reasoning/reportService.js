const { synthesizeReport } = require('./synthesizer');
const { verifyReport } = require('./verifier');
const { retrieveEvidence } = require('./retriever');
const { rerankEvidence } = require('./reranker');
const { buildSynthesisInput } = require('./synthesisInputBuilder');
const logger = require('../../helpers/logger');

async function generateClusterReport(clusterEvidencePackage, options = {}) {
    const retrieval = retrieveEvidence(clusterEvidencePackage, options.retrieval || {});
    logger.info('reportService.retrieve', 'Evidence retrieval completed', {
        queries: Array.isArray(retrieval?.queries) ? retrieval.queries.length : 0,
        results: Array.isArray(retrieval?.results) ? retrieval.results.length : 0,
    });

    const rerankedRetrieval = rerankEvidence(retrieval, options.rerank || {});
    logger.info('reportService.rerank', 'Evidence rerank completed', {
        status: rerankedRetrieval?.rerankStatus || null,
        results: Array.isArray(rerankedRetrieval?.results) ? rerankedRetrieval.results.length : 0,
    });

    const reasoningEvidence = buildSynthesisInput(clusterEvidencePackage, retrieval, rerankedRetrieval);
    logger.info('reportService.synthesize', 'Synthesis input built', {
        timeline: Array.isArray(reasoningEvidence?.timeline) ? reasoningEvidence.timeline.length : 0,
        claims: Array.isArray(reasoningEvidence?.claims) ? reasoningEvidence.claims.length : 0,
    });

    const report = await synthesizeReport(reasoningEvidence);
    logger.info('reportService.synthesize', 'Report synthesized', {
        findings: Array.isArray(report?.findings) ? report.findings.length : 0,
    });

    options.onStage?.({
        step: 'verifying',
        progress: 90,
        message: 'Provjeravam nalaze prema dokazima...'
    });

    const verifiedReport = await verifyReport(report, reasoningEvidence);
    logger.info('reportService.verify', 'Report verified', {
        findings: Array.isArray(verifiedReport?.findings) ? verifiedReport.findings.length : 0,
        verified: Array.isArray(verifiedReport?.verifiedFindings) ? verifiedReport.verifiedFindings.length : 0,
        openQuestions: Array.isArray(verifiedReport?.openQuestions) ? verifiedReport.openQuestions.length : 0,
        conflicts: Array.isArray(verifiedReport?.conflicts) ? verifiedReport.conflicts.length : 0,
    });

    return {
        ...verifiedReport,
        meta: {
            ...(verifiedReport?.meta || {}),
            retrieval,
            rerank: rerankedRetrieval
        }
    };
}

module.exports = {
    generateClusterReport,
    buildSynthesisInput
};
