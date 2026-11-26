const { synthesizeReport } = require('./synthesizer');
const { verifyReport } = require('./verifier');
const { retrieveEvidence } = require('../retrieval/retriever');
const { annotateFindingsWithRetrieval } = require('../retrieval/findingProvenance');
const { buildScopeContract } = require('../ledger/scopeContract');
const { buildSynthesisInput } = require('./synthesisInputBuilder');
const { buildProfileReportInput } = require('../contextReportAdapter');
const logger = require('../../../services/logger');


async function generateClusterReport(clusterEvidencePackage, options = {}) {
    // Run correlation, same plumbing shape as tracker/onUsage: callers pass
    // options.runId (null outside real runs); structured stage records below
    // carry it so one run's lines isolate with a single grep.
    const runId = options.runId || null;
    const sharedUpstream = options.sharedUpstream || null;
    const retrieval = sharedUpstream?.retrieval
        || retrieveEvidence(clusterEvidencePackage, {
            ...(options.retrieval || {}),
            analysisStore: options.analysisStore,
            runId,
        });
    logger.info('reportService.retrieve', 'Evidence retrieval completed', {
        runId,
        queries: Array.isArray(retrieval?.queries) ? retrieval.queries.length : 0,
        results: Array.isArray(retrieval?.results) ? retrieval.results.length : 0,
        sourceTypes: retrieval?.metrics?.sourceTypeCounts || null,
    });

    const labProfile = options.labProfile || null;
    let reasoningEvidence;
    let contextTrace = null;
    if (labProfile) {
        const adapted = await buildProfileReportInput({
            evidencePackage: clusterEvidencePackage,
            retrieval,
            profileId: labProfile,
            summarizeLlm: options.summarizeLlm || null,
            tracker: options.tracker,
            onUsage: options.onUsage,
        });
        reasoningEvidence = adapted.input;
        contextTrace = adapted.trace;
        logger.info('reportService.context', 'Context report input built', {
            runId,
            profile: labProfile,
            rootId: contextTrace?.rootId || null,
            branchClaims: contextTrace?.claims?.branch ?? 0,
            derivedClaims: contextTrace?.claims?.derived ?? 0,
        });
    } else {
        reasoningEvidence = buildSynthesisInput(clusterEvidencePackage, retrieval);
    }
    logger.info('reportService.synthesize', 'Synthesis input built', {
        runId,
        timeline: Array.isArray(reasoningEvidence?.timeline) ? reasoningEvidence.timeline.length : 0,
        claims: Array.isArray(reasoningEvidence?.claims) ? reasoningEvidence.claims.length : 0,
    });

    const report = await synthesizeReport(reasoningEvidence, {
        tracker: options.tracker,
        onUsage: options.onUsage,
        signal: options.signal,
        sqliteStore: options.analysisStore || null,
        creditLatch: options.creditLatch || null,
        taskRouter: options.taskRouter,
        runId,
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
        signal: options.signal,
        sqliteStore: options.analysisStore || null,
        creditLatch: options.creditLatch || null,
        taskRouter: options.taskRouter,
        runId,
    });
    logger.info('reportService.verify', 'Report verification result', {
        runId,
        findings: Array.isArray(verifiedReport?.findings) ? verifiedReport.findings.length : 0,
        status: verifiedReport?.meta?.verification?.status || 'unknown',
        verified: verifiedReport?.meta?.verification?.verifiedCount ?? 0,
        failed: verifiedReport?.meta?.verification?.failedCount ?? 0,
        openQuestions: Array.isArray(verifiedReport?.openQuestions) ? verifiedReport.openQuestions.length : 0,
        conflicts: Array.isArray(verifiedReport?.conflicts) ? verifiedReport.conflicts.length : 0,
    });

    // M-09 — each finding citation links back to the retrieval query
    // that surfaced it (raw retrieval: full match score/reasons).
    const annotatedFindings = annotateFindingsWithRetrieval(verifiedReport?.findings, retrieval);
    // T1-1 — machine-readable conclusion contract: what this report's
    // evidence can and cannot support. Pure function over the evidence
    // package; never throws (a missing contract must not fail a run).
    let scope = null;
    try {
        scope = buildScopeContract({
            coverage: clusterEvidencePackage?.coverage || null,
            discovery: clusterEvidencePackage?.discovery || null,
            analyses: clusterEvidencePackage?.analyses || [],
            // Cluster-scoped docket entries for the current-status chronology
            // gate; absent on legacy packages, which then degrade safely.
            entries: clusterEvidencePackage?.entries || [],
            envBudgetCap: typeof process.env.ANALYSIS_SCRAPE_LIMIT === 'string'
                && process.env.ANALYSIS_SCRAPE_LIMIT.trim() !== ''
        });
    } catch (err) {
        logger.agent.warn(`[ScopeContract] Contract build failed; persisting null (${err.message})`);
    }
    logger.info('reportService.scope', 'Conclusion contract built', {
        runId,
        analysisStatus: scope?.analysisStatus || null,
        blocked: scope?.blocked || null,
    });
    return {
        ...verifiedReport,
        findings: annotatedFindings,
        ...(Array.isArray(verifiedReport?.verifiedFindings)
            ? { verifiedFindings: annotateFindingsWithRetrieval(verifiedReport.verifiedFindings, retrieval) }
            : {}),
        meta: {
            ...(verifiedReport?.meta || {}),
            retrieval: stripRetrievalText(retrieval),
            scope,
            // Lab-only: context profiles persist their bounded trace.
            ...(contextTrace ? { contextTrace } : {}),
        }
    };
}

// Persistence diet (M-06): the raw `retrieval` copy keeps a trimmed-but-real
// provenance record per match — bounded snippet + score/reasons +
// sourceId/fileName — instead of dropping everything. Telemetry expands this
// data into the persisted query table.
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
