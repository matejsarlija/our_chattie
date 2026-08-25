const { synthesizeReport } = require('./synthesizer');
const { verifyReport } = require('./verifier');
const { retrieveEvidence } = require('./retriever');
const { rerankEvidence, isAmbiguous } = require('./reranker');
const { shouldAttemptRerank, createLlmRerank, resolveRerankMode } = require('./rerankerClient');
const { runFollowUpVerification } = require('./followUpVerification');
const { runQueryPlanner, mergeRetrievalQueries } = require('./queryPlanner');
const { buildSynthesisInput } = require('./synthesisInputBuilder');
const { createGeminiClient } = require('../../helpers/geminiConfig');
const { withGeminiRetry, withGeminiTimeout } = require('../../helpers/geminiRetry');
const { trackGeminiInvoke } = require('../../helpers/geminiUsage');
const { resolveReasoningPlanner, resolveReasoningFollowUp } = require('../../helpers/reasoningSettings');
const agentLog = require('../../helpers/agentLog');
const logger = require('../../helpers/logger');

// Follow-up re-verification reuses the strict 'verify' role policy
// (temperature 0.1, bounded output) — it is the same concern, one pass later.
// Lazy construction: importing this module must not require an API key.
let followUpGemini = null;

function getFollowUpGemini() {
    if (!followUpGemini) followUpGemini = createGeminiClient('verify');
    return followUpGemini;
}

// Planner reuses the 'planner' role policy — lazy for the same reason.
let plannerGemini = null;

function getPlannerGemini() {
    if (!plannerGemini) plannerGemini = createGeminiClient('planner');
    return plannerGemini;
}

// Gate for the optional LLM passes (planner / follow-up): "off" never runs;
// everything else ("on" default, or "force" from env) runs. The free tier is
// no longer supported, so there is no plan check here.
function shouldRunOptionalPass(mode) {
    return mode !== 'off';
}

async function generateClusterReport(clusterEvidencePackage, options = {}) {
    // Query planning (Phase 1.3): one small call lets the model add case-
    // specific queries on top of the fixed templates. Off/plan-gated via
    // shouldRunOptionalPass; any planner failure silently degrades to templates.
    const retrievalOptions = { ...(options.retrieval || {}) };
    const hasPresetQueries = Array.isArray(retrievalOptions.queries) && retrievalOptions.queries.length > 0;
    let plannedQueryCount = 0;
    if (!hasPresetQueries && shouldRunOptionalPass(resolveReasoningPlanner())) {
        try {
            const planned = await runQueryPlanner(clusterEvidencePackage, {
                plannerLlm: async ({ prompt }) => {
                    const response = await withGeminiRetry(() => withGeminiTimeout(
                        (signal) => trackGeminiInvoke(getPlannerGemini(), prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })
                    ));
                    return response.content;
                },
                tracker: options.tracker,
                onUsage: options.onUsage
            });
            if (planned.length > 0) {
                const { createRetrievalQueries } = require('./retrievalQueries');
                const templates = createRetrievalQueries({
                    query: clusterEvidencePackage?.query,
                    clusterId: clusterEvidencePackage?.clusterId,
                    primaryCaseNumber: clusterEvidencePackage?.primaryCaseNumber,
                    identity: clusterEvidencePackage?.identity
                });
                retrievalOptions.queries = mergeRetrievalQueries(planned, templates);
                plannedQueryCount = planned.length;
            }
        } catch (err) {
            agentLog.warn(`[QueryPlanner] Unexpected failure; using templates (${err.message})`);
        }
    }

    const retrieval = retrieveEvidence(clusterEvidencePackage, retrievalOptions);
    logger.info('reportService.retrieve', 'Evidence retrieval completed', {
        queries: Array.isArray(retrieval?.queries) ? retrieval.queries.length : 0,
        plannedQueries: plannedQueryCount,
        results: Array.isArray(retrieval?.results) ? retrieval.results.length : 0,
        sourceTypes: retrieval?.metrics?.sourceTypeCounts || null,
    });

    // Rerank gate: dashboard/env mode override wins; otherwise ambiguous-only.
    // resolveRerankMode() already folds settings over env.
    const mode = resolveRerankMode();
    const rerankOptions = { ...(options.rerank || {}) };
    if (mode === 'force') {
        rerankOptions.enabled = true;
        rerankOptions.force = true;
    } else if (mode === 'off') {
        rerankOptions.enabled = false;
    } else {
        rerankOptions.enabled = shouldAttemptRerank({ ambiguous: isAmbiguous(retrieval) });
    }
    if (rerankOptions.enabled && typeof rerankOptions.llmRerank !== 'function') {
        rerankOptions.llmRerank = createLlmRerank({ tracker: options.tracker, onUsage: options.onUsage });
    }

    const rerankedRetrieval = await rerankEvidence(retrieval, rerankOptions);
    logger.info('reportService.rerank', 'Evidence rerank completed', {
        status: rerankedRetrieval?.rerankStatus || null,
        reason: rerankedRetrieval?.metrics?.rerankReason || null,
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

    // Conflict-triggered re-verification (Phase 1.1): exactly ONE extra call
    // per run when conflicts exist, grounding both sides in indexed chunks.
    // Off/plan-gated via shouldRunOptionalPass; failure leaves the report
    // untouched.
    let finalReport = verifiedReport;
    if (shouldRunOptionalPass(resolveReasoningFollowUp())) {
        try {
            const followUp = await runFollowUpVerification(verifiedReport, clusterEvidencePackage, {
                followUpLlm: async ({ prompt }) => {
                    const response = await withGeminiRetry(() => withGeminiTimeout(
                        (signal) => trackGeminiInvoke(getFollowUpGemini(), prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })
                    ));
                    return response.content;
                },
                tracker: options.tracker,
                onUsage: options.onUsage,
                logger: { warn: (msg) => agentLog.warn(msg), error: (msg) => agentLog.error(msg) }
            });
            finalReport = followUp.report;
            if (followUp.called) {
                logger.info('reportService.followUp', 'Conflict re-verification ran', {
                    conflicts: Array.isArray(finalReport?.conflicts) ? finalReport.conflicts.length : 0,
                });
            }
        } catch (err) {
            agentLog.error(`[FollowUp] Unexpected failure; report unchanged (${err.message})`);
        }
    }

    return {
        ...finalReport,
        meta: {
            ...(finalReport?.meta || {}),
            retrieval: stripRetrievalText(retrieval),
            rerank: rerankedRetrieval
        }
    };
}

// Persistence diet: the reranked result (meta.rerank) already carries the full
// match text because rerankEvidence spreads the lexical retrieval, so the raw
// `retrieval` copy only needs the query/metrics scaffolding for telemetry.
// Stripping `matches[].text` from the raw copy halved the chunk payload in
// runs.json without losing any information the detail page reads.
function stripRetrievalText(retrieval) {
    if (!retrieval) return retrieval;
    return {
        ...retrieval,
        results: (retrieval.results || []).map((result) => ({
            ...result,
            matches: (result.matches || []).map(({ text, ...match }) => match)
        }))
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
