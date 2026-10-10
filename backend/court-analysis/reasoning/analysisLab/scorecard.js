// backend/court-analysis/reasoning/analysisLab/scorecard.js
//
// LE-2 — deterministic scorecard and variant-difference view model (spec §6).
//
// Descriptive only: per-variant counts plus labeled deltas. No composite
// score, no ranking, no winner — a single numeric score cannot decide legal
// usefulness (spec G5). Every measure is computed from variant report/trace
// and the frozen source package; model prose is never parsed.
//
// Conventions:
// - Source-claim counts (denominator: extracted source claims) and report
//   finding counts (denominator: report findings) keep distinct labels and
//   never share an ambiguous "supported claims" label.
// - Missing data degrades to `'unknown'`, never to a silent zero.
// - Context-node fields on the flat profile are `'n/a'`
//   ("not applicable to flat profile"), explicitly distinct from zero.

const UNKNOWN = 'unknown';
const NOT_APPLICABLE = 'n/a';

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function countOrUnknown(value) {
    if (value === NOT_APPLICABLE) return NOT_APPLICABLE;
    return Number.isInteger(value) && value >= 0 ? value : UNKNOWN;
}

function pickFirst(...candidates) {
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null) return candidate;
    }
    return null;
}

function hasValidCitationId(citation) {
    if (!citation || typeof citation !== 'object') return false;
    const id = citation.sourceId || citation.source || citation.id || citation.fileName || null;
    return typeof id === 'string' && id.trim().length > 0;
}

function findingHasValidCitation(finding) {
    const citations = [...asArray(finding?.citations), ...asArray(finding?.evidence)];
    return citations.some(hasValidCitationId);
}

function isDegradedFinding(finding) {
    if (!finding || typeof finding !== 'object') return false;
    if (finding.degraded === true || finding.grounded === false) return true;
    const status = typeof finding.status === 'string' ? finding.status.toLowerCase() : '';
    return status === 'unsupported' || status === 'contradicted' || status === 'partial';
}

function conflictCurrencies(conflict) {
    const currencies = new Set();
    for (const amount of asArray(conflict?.amounts)) {
        if (typeof amount?.currency === 'string' && amount.currency.trim()) {
            currencies.add(amount.currency.trim().toUpperCase());
        }
    }
    return currencies;
}

/**
 * Computes the descriptive per-variant scorecard from the frozen source
 * package plus one variant's report/trace/usage. Pure and total: any
 * unexpected shape degrades the affected field to `'unknown'`, never throws
 * for missing optional sections (a missing section must not fail a run).
 */
function computeVariantScorecard({
    evidencePackage = null,
    report = null,
    trace = null,
    usage = null,
    profileSnapshot = null,
    evidencePackageHash = null,
} = {}) {
    const pkg = evidencePackage && typeof evidencePackage === 'object' ? evidencePackage : {};
    const profileId = profileSnapshot?.id || trace?.profileId || UNKNOWN;
    const isFlat = profileId === 'baseline-flat-v1' || trace?.baseline === true || trace?.strategy === 'flat';

    // --- Input identity (§6 row 1) ---
    const coverage = pkg.coverage && typeof pkg.coverage === 'object' ? pkg.coverage : {};
    const reconciliation = pkg.reconciliation && typeof pkg.reconciliation === 'object' ? pkg.reconciliation : {};
    const conflicts = asArray(reconciliation.conflicts);
    const openQuestions = asArray(reconciliation.openQuestions);
    const totalSourceClaims = Number.isInteger(coverage.totalClaims) ? coverage.totalClaims : UNKNOWN;
    const groundedSourceClaims = Number.isInteger(coverage.groundedClaims) ? coverage.groundedClaims : UNKNOWN;

    // --- Source support (§6 row 2): report findings are a different
    // denominator from source claims and keep their own labels. ---
    const findings = asArray(report?.findings);
    const findingsWithValidCitations = findings.filter(findingHasValidCitation).length;
    const unsupportedOrDegradedFindings = findings.filter(
        (finding) => !findingHasValidCitation(finding) || isDegradedFinding(finding)
    ).length;

    // --- Coverage and honesty (§6 row 3) ---
    const reportScope = report?.meta?.scope && typeof report.meta.scope === 'object' ? report.meta.scope : null;
    const packageScope = pkg.scope && typeof pkg.scope === 'object' ? pkg.scope : null;
    const scopeStatus = pickFirst(reportScope?.analysisStatus, reportScope?.status, packageScope?.status) || UNKNOWN;
    const blockedConclusions = asArray(pickFirst(reportScope?.blocked, packageScope?.blockedConclusions, []));
    const failedFiles = asArray(coverage.failedFiles);
    const criticalFailedDocuments = Number.isInteger(coverage.failed) ? coverage.failed : failedFiles.length || UNKNOWN;
    const coverageGaps = asArray(coverage.gaps);
    const analyses = asArray(pkg.analyses);
    const truncatedAnalyses = analyses.filter((analysis) => {
        if (!analysis || typeof analysis !== 'object') return false;
        return analysis.truncated === true || analysis.ocrTruncated === true || analysis.degraded === true;
    }).length;

    // --- Reconciliation safety (§6 row 4) ---
    const currencyConflicts = conflicts.filter((conflict) => {
        if (!conflict || typeof conflict !== 'object') return false;
        if (typeof conflict.kind === 'string' && conflict.kind.toLowerCase().includes('currency')) return true;
        return conflictCurrencies(conflict).size > 1;
    }).length;
    const identityUnresolvedLinks = openQuestions.filter((question) => {
        if (!question || typeof question !== 'object') return false;
        const kind = typeof question.kind === 'string' ? question.kind.toLowerCase() : '';
        return kind.includes('identity') || kind.includes('lifecycle') || kind.includes('possibly-related');
    }).length;
    const duplicateSuppressions = conflicts.filter((conflict) => {
        const kind = typeof conflict?.kind === 'string' ? conflict.kind.toLowerCase() : '';
        return kind.includes('duplicate');
    }).length;
    const claimLinks = asArray(reconciliation.claimLinks);

    // --- Context/report shape (§6 row 5) ---
    const selectedCluster = pkg.discovery?.selectedCluster && typeof pkg.discovery.selectedCluster === 'object'
        ? pkg.discovery.selectedCluster
        : {};
    const timelineSpanDays = Number.isFinite(selectedCluster.entryDateSpanDays)
        ? selectedCluster.entryDateSpanDays
        : UNKNOWN;
    const claimCounts = trace?.claims && typeof trace.claims === 'object' ? trace.claims : null;
    const selection = trace?.selection && typeof trace.selection === 'object' ? trace.selection : null;
    const dagTrace = trace?.dag && typeof trace.dag === 'object' ? trace.dag : null;
    const selectedNodes = asArray(selection?.selected);
    const summaries = trace?.summaries && typeof trace.summaries === 'object' ? trace.summaries : null;
    const summaryOutcomes = asArray(summaries?.outcomes);
    const summaryStats = summaries?.stats && typeof summaries.stats === 'object' ? summaries.stats : {};
    const partialNodeIds = new Set();
    if (!isFlat) {
        selectedNodes.forEach((node, index) => {
            if (node?.status === 'partial') partialNodeIds.add(node.nodeId || `selected-${index}`);
        });
        summaryOutcomes.forEach((outcome, index) => {
            if (outcome?.status === 'partial') partialNodeIds.add(outcome.nodeId || `summary-${index}`);
        });
    }
    const partialNodes = isFlat ? NOT_APPLICABLE : partialNodeIds.size;
    const unresolvedNodes = isFlat
        ? NOT_APPLICABLE
        : selectedNodes.filter((node) => node?.kind === 'unresolved').length;

    // --- Reliability (§6 row 6) ---
    const reportMeta = report?.meta && typeof report.meta === 'object' ? report.meta : {};
    const schemaRepairFailures = countOrUnknown(pickFirst(
        Number.isInteger(reportMeta.schemaRepairFailures) ? reportMeta.schemaRepairFailures : undefined,
        Number.isInteger(trace?.schemaRepairFailures) ? trace.schemaRepairFailures : undefined,
        0
    ));
    const reportErrors = countOrUnknown(asArray(report?.errors).length);
    const verifierErrors = countOrUnknown(pickFirst(
        Number.isInteger(reportMeta.verifierErrors) ? reportMeta.verifierErrors : undefined,
        0
    ));
    const fallbackUsed = reportMeta.fallbackUsed === true || trace?.fallbackUsed === true;

    // --- Cost and time (§6 row 7) ---
    const usageRecord = usage && typeof usage === 'object' ? usage : {};
    const calls = Number.isFinite(usageRecord.calls) ? usageRecord.calls : UNKNOWN;
    const inputTokens = Number.isFinite(usageRecord.inputTokens) ? usageRecord.inputTokens : UNKNOWN;
    const outputTokens = Number.isFinite(usageRecord.outputTokens) ? usageRecord.outputTokens : UNKNOWN;
    const totalTokens = Number.isFinite(usageRecord.totalTokens) ? usageRecord.totalTokens : UNKNOWN;
    const elapsedMs = Number.isFinite(usageRecord.elapsedMs) ? usageRecord.elapsedMs : UNKNOWN;
    const nodeSummaryCalls = isFlat
        ? NOT_APPLICABLE
        : (Number.isInteger(summaryStats.calls) ? summaryStats.calls : UNKNOWN);

    return {
        version: 1,
        profileId,
        input: {
            evidencePackageHash,
            evidencePackageHashMatches: typeof evidencePackageHash === 'string'
                && typeof trace?.evidencePackageHash === 'string'
                ? trace.evidencePackageHash === evidencePackageHash
                : UNKNOWN,
            documents: analyses.length,
            entries: asArray(pkg.entries).length,
            totalSourceClaims,
        },
        sourceSupport: {
            groundedSourceClaims,
            totalSourceClaims,
            reportFindingsTotal: findings.length,
            reportFindingsWithValidCitations: findingsWithValidCitations,
            unsupportedOrDegradedFindings,
        },
        coverage: {
            scopeStatus,
            blockedConclusions: blockedConclusions.length,
            criticalFailedDocuments,
            failedFiles: failedFiles.map((file) => file?.fileName || file?.code || 'unknown').slice(0, 20),
            ocrOrNativeTruncations: truncatedAnalyses,
            coverageGaps: coverageGaps.length,
        },
        reconciliation: {
            conflictsTotal: conflicts.length,
            currencyConflicts,
            identityUnresolvedLinks,
            duplicateSuppressions,
            unresolvedLifecycleLinks: identityUnresolvedLinks,
            openQuestionsTotal: openQuestions.length,
            advisoryClaimLinks: claimLinks.length,
        },
        shape: {
            timelineSpanDays,
            flatClaims: claimCounts && Number.isInteger(claimCounts.flat) ? claimCounts.flat : UNKNOWN,
            branchClaims: isFlat
                ? NOT_APPLICABLE
                : (claimCounts && Number.isInteger(claimCounts.branch) ? claimCounts.branch : UNKNOWN),
            derivedClaims: isFlat
                ? NOT_APPLICABLE
                : (claimCounts && Number.isInteger(claimCounts.derived) ? claimCounts.derived : UNKNOWN),
            selectedContextNodes: isFlat ? NOT_APPLICABLE : selectedNodes.length,
            partialNodes,
            unresolvedNodes,
            dagNodeCount: dagTrace && Number.isInteger(dagTrace.nodeCount) ? dagTrace.nodeCount : UNKNOWN,
        },
        reliability: {
            schemaRepairFailures,
            reportErrors,
            verifierErrors,
            fallbackUsed,
        },
        cost: {
            calls,
            inputTokens,
            outputTokens,
            totalTokens,
            elapsedMs,
            nodeSummaryCalls,
        },
    };
}

function numericDeltaLabel(from, to, singular, plural) {
    if (from === UNKNOWN || to === UNKNOWN || from === NOT_APPLICABLE || to === NOT_APPLICABLE) return null;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return null;
    const diff = to - from;
    const noun = Math.abs(diff) === 1 ? singular : plural;
    return diff > 0 ? `${diff} more ${noun}` : `${Math.abs(diff)} fewer ${noun}`;
}

/**
 * Labeled, descriptive differences between two variant scorecards — never a
 * composite score or winner. Returns `{ from, to, deltas }` where `deltas`
 * is an array of human-readable labels such as "4 more report findings with
 * valid citations".
 */
function describeVariantDelta(fromScorecard, toScorecard) {
    const from = fromScorecard && typeof fromScorecard === 'object' ? fromScorecard : {};
    const to = toScorecard && typeof toScorecard === 'object' ? toScorecard : {};
    const deltas = [];
    const push = (label) => {
        if (label) deltas.push(label);
    };

    push(numericDeltaLabel(
        from.sourceSupport?.reportFindingsWithValidCitations,
        to.sourceSupport?.reportFindingsWithValidCitations,
        'report finding with valid citations',
        'report findings with valid citations'
    ));
    push(numericDeltaLabel(
        from.sourceSupport?.unsupportedOrDegradedFindings,
        to.sourceSupport?.unsupportedOrDegradedFindings,
        'unsupported or degraded finding',
        'unsupported or degraded findings'
    ));
    push(numericDeltaLabel(
        from.reconciliation?.openQuestionsTotal,
        to.reconciliation?.openQuestionsTotal,
        'reconciliation open question',
        'reconciliation open questions'
    ));
    push(numericDeltaLabel(
        from.coverage?.blockedConclusions,
        to.coverage?.blockedConclusions,
        'blocked conclusion',
        'blocked conclusions'
    ));
    if (to.shape?.unresolvedNodes !== UNKNOWN && to.shape?.unresolvedNodes !== NOT_APPLICABLE
        && Number.isFinite(to.shape.unresolvedNodes) && to.shape.unresolvedNodes > 0) {
        deltas.push(`${to.shape.unresolvedNodes} unresolved ${to.shape.unresolvedNodes === 1 ? 'branch' : 'branches'}`);
    }
    if (to.shape?.partialNodes !== UNKNOWN && to.shape?.partialNodes !== NOT_APPLICABLE
        && Number.isFinite(to.shape.partialNodes) && to.shape.partialNodes > 0) {
        deltas.push(`${to.shape.partialNodes} partial ${to.shape.partialNodes === 1 ? 'node' : 'nodes'}`);
    }
    push(numericDeltaLabel(
        from.cost?.totalTokens,
        to.cost?.totalTokens,
        'total token',
        'total tokens'
    ));
    push(numericDeltaLabel(
        from.cost?.calls,
        to.cost?.calls,
        'model call',
        'model calls'
    ));

    return {
        from: from.profileId || UNKNOWN,
        to: to.profileId || UNKNOWN,
        deltas,
    };
}

/**
 * Builds the persisted comparison view model for one experiment record:
 * scorecards stay per-variant; differences are reported as the two
 * spec-acceptance pairs — flat→DAG (organizing effect) and
 * DAG→DAG-plus-summaries (summaries' added effect, §9 item 8) — with the
 * summaries' incremental calls/tokens/time spelled out separately.
 */
function buildComparisonViewModel(experiment) {
    const variants = experiment?.variants && typeof experiment.variants === 'object' ? experiment.variants : {};
    const flat = variants['baseline-flat-v1']?.deterministicScorecard || null;
    const dag = variants['context-tree-v1']?.deterministicScorecard || null;
    const summarized = variants['context-tree-summarized-v1']?.deterministicScorecard || null;

    const flatToDag = flat && dag ? describeVariantDelta(flat, dag) : null;
    const dagToSummarized = dag && summarized ? describeVariantDelta(dag, summarized) : null;

    let summaryIncrementalCost = UNKNOWN;
    if (dag && summarized) {
        const keys = ['calls', 'inputTokens', 'outputTokens', 'totalTokens', 'elapsedMs'];
        const incremental = {};
        let comparable = true;
        for (const key of keys) {
            const base = dag.cost?.[key];
            const next = summarized.cost?.[key];
            if (!Number.isFinite(base) || !Number.isFinite(next)) {
                comparable = false;
                break;
            }
            incremental[key] = next - base;
        }
        summaryIncrementalCost = comparable ? incremental : UNKNOWN;
    }

    return {
        evidencePackageHash: experiment?.evidencePackageHash || UNKNOWN,
        inputHashMatches: experiment?.comparison?.inputHashMatches ?? UNKNOWN,
        status: experiment?.status || UNKNOWN,
        sharedUsage: experiment?.sharedUsage || UNKNOWN,
        flatToDag,
        dagToSummarized,
        summaryIncrementalCost,
    };
}

module.exports = {
    UNKNOWN,
    NOT_APPLICABLE,
    computeVariantScorecard,
    describeVariantDelta,
    buildComparisonViewModel,
};
