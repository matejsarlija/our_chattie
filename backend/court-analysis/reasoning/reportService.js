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

    const report = await synthesizeReport(reasoningEvidence, {
        tracker: options.tracker,
        onUsage: options.onUsage,
    });
    logger.info('reportService.synthesize', 'Report synthesized', {
        findings: Array.isArray(report?.findings) ? report.findings.length : 0,
    });

    options.onStage?.({
        step: 'verifying',
        progress: 90,
        message: 'Provjeravam nalaze prema dokazima...'
    });

    const verifiedReport = await verifyReport(report, reasoningEvidence, {
        tracker: options.tracker,
        onUsage: options.onUsage,
    });
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

// Single-source narrative: the structured report is the only LLM synthesis of
// a run. The human-facing overview (persisted as result_text) is composed
// deterministically from that report, so the two surfaces can never disagree
// and the pipeline spends one narrative call instead of two.
// Confidence values arrive from the model as English tokens; the overview is
// user-facing Croatian prose, so they are translated here. Unknown tokens fall
// through untranslated rather than disappearing.
const CONFIDENCE_LABELS_HR = { high: 'visoka', medium: 'srednja', low: 'niska' };

function composeOverviewMarkdown(report) {
    if (!report) return '';
    const sections = [];

    const narrative = String(report.narrative || '').trim();
    if (narrative) sections.push(narrative);

    const findings = Array.isArray(report.findings) ? report.findings : [];
    const findingLines = findings
        .map((finding) => {
            const text = String(finding?.text || '').trim();
            if (!text) return null;
            const rawConfidence = String(finding?.confidence || '').toLowerCase();
            const confidenceLabel = CONFIDENCE_LABELS_HR[rawConfidence] || finding?.confidence;
            const confidence = confidenceLabel ? ` _(pouzdanost: ${confidenceLabel})_` : '';
            return `- ${text}${confidence}`;
        })
        .filter(Boolean);
    if (findingLines.length > 0) {
        sections.push(`## Ključni nalazi\n${findingLines.join('\n')}`);
    }

    const openQuestions = (Array.isArray(report.openQuestions) ? report.openQuestions : [])
        .map((question) => String(question || '').trim())
        .filter(Boolean);
    if (openQuestions.length > 0) {
        sections.push(`## Otvorena pitanja\n${openQuestions.map((question) => `- ${question}`).join('\n')}`);
    }

    const nextSteps = (Array.isArray(report.nextSteps) ? report.nextSteps : [])
        .map((step) => String(step || '').trim())
        .filter(Boolean);
    if (nextSteps.length > 0) {
        sections.push(`## Sljedeći koraci\n${nextSteps.map((step) => `- ${step}`).join('\n')}`);
    }

    return sections.join('\n\n').trim();
}

module.exports = {
    generateClusterReport,
    buildSynthesisInput,
    composeOverviewMarkdown
};
