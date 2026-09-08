const { synthesizeReport } = require('./synthesizer');
const { verifyReport } = require('./verifier');
const { retrieveEvidence } = require('./retriever');
const { annotateFindingsWithRetrieval } = require('./findingProvenance');
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
// everything else ("on" default, or "force" from env) runs.
function shouldRunOptionalPass(mode) {
    return mode !== 'off';
}

async function generateClusterReport(clusterEvidencePackage, options = {}) {
    // Run correlation, same plumbing shape as tracker/onUsage: callers pass
    // options.runId (null outside real runs); every logger.* call below
    // carries it so one run's lines isolate with a single grep.
    const runId = options.runId || null;
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
        runId,
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
        runId,
        status: rerankedRetrieval?.rerankStatus || null,
        reason: rerankedRetrieval?.metrics?.rerankReason || null,
        results: Array.isArray(rerankedRetrieval?.results) ? rerankedRetrieval.results.length : 0,
    });

    const reasoningEvidence = buildSynthesisInput(clusterEvidencePackage, retrieval, rerankedRetrieval);
    logger.info('reportService.synthesize', 'Synthesis input built', {
        runId,
        timeline: Array.isArray(reasoningEvidence?.timeline) ? reasoningEvidence.timeline.length : 0,
        claims: Array.isArray(reasoningEvidence?.claims) ? reasoningEvidence.claims.length : 0,
    });

    const report = await synthesizeReport(reasoningEvidence, {
        tracker: options.tracker,
        onUsage: options.onUsage,
    });
    logger.info('reportService.synthesize', 'Report synthesized', {
        runId,
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
        runId,
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
                    runId,
                    conflicts: Array.isArray(finalReport?.conflicts) ? finalReport.conflicts.length : 0,
                });
            }
        } catch (err) {
            agentLog.error(`[FollowUp] Unexpected failure; report unchanged (${err.message})`);
        }
    }

    // M-09 — each finding citation links back to the retrieval query
    // that surfaced it (raw retrieval: full match score/reasons).
    const annotatedFindings = annotateFindingsWithRetrieval(finalReport?.findings, retrieval);
    return {
        ...finalReport,
        findings: annotatedFindings,
        ...(Array.isArray(finalReport?.verifiedFindings)
            ? { verifiedFindings: annotateFindingsWithRetrieval(finalReport.verifiedFindings, retrieval) }
            : {}),
        meta: {
            ...(finalReport?.meta || {}),
            retrieval: stripRetrievalText(retrieval),
            rerank: rerankedRetrieval
        }
    };
}

// Persistence diet (M-06): the reranked result (meta.rerank) already carries the
// full match text, so the raw `retrieval` copy keeps a trimmed-but-real
// provenance record per match — bounded snippet + score + reasons +
// sourceId/fileName — instead of dropping everything. Telemetry (M-07/M-08)
// expands into this data; without it the query table has nothing to show.
const RETRIEVAL_SNIPPET_MAX_CHARS = 500;

function buildProvenanceMatch(match) {
    const text = typeof match?.text === 'string' ? match.text : '';
    const snippet = text.length > RETRIEVAL_SNIPPET_MAX_CHARS
        ? `${text.slice(0, RETRIEVAL_SNIPPET_MAX_CHARS)}…`
        : text;
    return {
        sourceId: match?.sourceId || null,
        score: typeof match?.score === 'number' ? match.score : null,
        reasons: Array.isArray(match?.reasons) ? match.reasons : [],
        snippet,
        fileName: match?.metadata?.fileName || match?.fileName || null,
        sourceType: match?.metadata?.sourceType || null,
        metadata: match?.metadata || null,
    };
}

function stripRetrievalText(retrieval) {
    if (!retrieval) return retrieval;
    return {
        ...retrieval,
        results: (retrieval.results || []).map((result) => ({
            query: result.query,
            matches: (result.matches || []).map(buildProvenanceMatch)
        }))
    };
}

// Single-source narrative: the structured report is the only LLM synthesis of
// a run. The human-facing overview (persisted as result_text) is composed
// deterministically from that report, so the two surfaces can never disagree
// and the pipeline spends one narrative call instead of two.
//
// M-03: findings are NOT duplicated here. The canonical findings surface is
// the structured `report.findings` rendered by AnalysisReportAnnex (with
// citations); echoing them into the markdown produced the same findings twice
// (prose narrative + annex). The overview keeps narrative + open questions +
// next steps only.
function openQuestionText(question) {
    if (typeof question === 'string') return question.trim();
    if (question && typeof question === 'object') {
        for (const key of ['text', 'question', 'description']) {
            if (typeof question[key] === 'string' && question[key].trim()) return question[key].trim();
        }
    }
    return '';
}

function composeOverviewMarkdown(report) {
    if (!report) return '';
    const sections = [];

    const narrative = String(report.narrative || '').trim();
    if (narrative) sections.push(narrative);

    const openQuestions = (Array.isArray(report.openQuestions) ? report.openQuestions : [])
        .map(openQuestionText)
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
    composeOverviewMarkdown,
    stripRetrievalText,
    RETRIEVAL_SNIPPET_MAX_CHARS
};
