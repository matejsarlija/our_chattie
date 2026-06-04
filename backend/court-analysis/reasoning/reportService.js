const { synthesizeReport } = require('./synthesizer');
const { verifyReport } = require('./verifier');
const { retrieveEvidence } = require('./retriever');
const { rerankEvidence } = require('./reranker');
const { buildSynthesisInput } = require('./synthesisInputBuilder');

async function generateClusterReport(clusterEvidencePackage, options = {}) {
    const retrieval = retrieveEvidence(clusterEvidencePackage, options.retrieval || {});
    const rerankedRetrieval = rerankEvidence(retrieval, options.rerank || {});
    const reasoningEvidence = buildSynthesisInput(clusterEvidencePackage, retrieval, rerankedRetrieval);
    const report = await synthesizeReport(reasoningEvidence);
    options.onStage?.({
        step: 'verifying',
        progress: 90,
        message: 'Provjeravam nalaze prema dokazima...'
    });

    const verifiedReport = await verifyReport(report, reasoningEvidence);
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
