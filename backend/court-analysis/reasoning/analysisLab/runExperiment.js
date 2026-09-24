// backend/court-analysis/reasoning/analysisLab/runExperiment.js
//
// LE-1 — Analysis Lab comparison orchestrator (spec §§4–5, 8).
//
// Runs the three built-in profiles from one frozen evidence package:
// retrieval, reranking, claim-judge and significance passes run ONCE against
// an isolated clone of the frozen package; their outputs are snapshotted and
// supplied identically to all three variants. Each variant then runs with its
// own usage tracker, timing, trace collector, temporary context, and error
// boundary. A single-variant failure yields a `partial` experiment — it never
// erases a successful baseline.
//
// The orchestrator never invokes the scraper, downloader, or OCR/native-PDF
// routing. Report-generation model calls are allowed in real Lab use (via the
// default `generateVariantReport` seam over `generateClusterReport`) but are
// mocked in tests through the injectable `deps`.
//
// Snapshots enable setup replay, not byte-identical model output: model calls
// remain stochastic and provider behavior may change.

const crypto = require('crypto');

const {
    PROFILE_IDS,
    isKnownProfile,
    snapshotProfile,
    snapshotExecutionSettings,
} = require('./profiles');
const {
    stableStringify,
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('./evidenceIdentity');
const { validateClusterEvidencePackage } = require('../evidencePackage');
const { retrieveEvidence } = require('../retriever');
const { computeVariantScorecard } = require('./scorecard');
const { rerankEvidence, isAmbiguous } = require('../reranker');
const { shouldAttemptRerank, resolveRerankMode } = require('../rerankerClient');
const {
    selectClaimJudgePairs,
    runClaimJudge,
    applyClaimVerdicts,
    createClaimJudge,
} = require('../claimJudge');
const {
    buildSignificanceShortlist,
    runSignificance,
    applySignificance,
} = require('../significance');
const { runQueryPlanner, mergeRetrievalQueries } = require('../queryPlanner');
const { generateClusterReport } = require('../reportService');
const { createContextNodeLlm } = require('./contextNodeSummary');
const { createLlmRerank } = require('../rerankerClient');
const { createUsageTracker } = require('../../../helpers/geminiUsage');
const {
    resolveReasoningPlanner,
    resolveReasoningClaimJudge,
    resolveReasoningSignificance,
} = require('../../../helpers/reasoningSettings');
const { createAnalysisLabStore } = require('../../../services/analysisLabStore');
const agentLog = require('../../../helpers/agentLog');

function sha256Hex(canonicalString) {
    return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

function hashSharedArtifact(value) {
    return sha256Hex(stableStringify(value === undefined ? null : value));
}

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function validateProfilesOrThrow(profiles) {
    if (!Array.isArray(profiles) || profiles.length === 0) {
        throw badRequest('Experiment profiles must be a non-empty array of known profile ids.');
    }
    const unknown = profiles.filter((id) => !isKnownProfile(id));
    if (unknown.length > 0) {
        throw badRequest(`Unknown analysis-lab profile: ${unknown.join(', ')}. Known profiles: ${PROFILE_IDS.join(', ')}.`);
    }
    const missing = PROFILE_IDS.filter((id) => !profiles.includes(id));
    if (missing.length > 0) {
        throw badRequest(`Experiment must include all three built-in profiles; missing: ${missing.join(', ')}.`);
    }
}

function buildInputSummary(evidencePackage) {
    return {
        caseNumber: evidencePackage?.clusterId || evidencePackage?.primaryCaseNumber || null,
        documents: Array.isArray(evidencePackage?.analyses) ? evidencePackage.analyses.length : 0,
        entries: Array.isArray(evidencePackage?.entries) ? evidencePackage.entries.length : 0,
    };
}

function resolveCodeRevision(runtimeMetadata) {
    if (runtimeMetadata && typeof runtimeMetadata.codeRevision === 'string' && runtimeMetadata.codeRevision.trim()) {
        return runtimeMetadata.codeRevision;
    }
    if (typeof process.env.GIT_SHA === 'string' && process.env.GIT_SHA.trim()) {
        return process.env.GIT_SHA.trim();
    }
    return 'unknown';
}

/**
 * Runs the shared retrieval/rerank/advisory passes once against an isolated
 * clone of the frozen package (spec §5.1 boundary). Never mutates the frozen
 * input. Returns snapshotted artifacts plus their hashes.
 *
 * Seams (`deps`) mirror `generateClusterReport`'s upstream so tests stay
 * offline: `runQueryPlanner`/`llmRerank`/`judgeLlm`/`significanceLlm` are only
 * invoked when both the gate is on and a seam is supplied.
 */
async function prepareSharedReportArtifacts(evidencePackage, executionSnapshot, deps = {}) {
    const {
        runQueryPlanner: runPlanner = runQueryPlanner,
        mergeQueries = mergeRetrievalQueries,
        retrieveEvidence: doRetrieve = retrieveEvidence,
        rerankEvidence: doRerank = rerankEvidence,
        plannerLlm = null,
        llmRerank = null,
        selectPairs = selectClaimJudgePairs,
        runJudge = runClaimJudge,
        applyVerdicts = applyClaimVerdicts,
        judgeLlm = null,
        judgeTracker = null,
        buildShortlist = buildSignificanceShortlist,
        runRank = runSignificance,
        applyRanking = applySignificance,
        significanceLlm = null,
        significanceTracker = null,
        production = false,
        retrievalOptions: extraRetrievalOptions = {},
        rerankOptions: extraRerankOptions = {},
    } = deps || {};

    const sharedClone = cloneEvidencePackage(evidencePackage);
    const gates = executionSnapshot?.gates || {};
    const sharedTracker = createUsageTracker();
    let effectivePlannerLlm = plannerLlm;
    let effectiveLlmRerank = llmRerank;
    if (production && typeof effectivePlannerLlm !== 'function') {
        const { createGeminiClient } = require('../../../helpers/geminiConfig');
        const { withGeminiRetry, withGeminiTimeout } = require('../../../helpers/geminiRetry');
        const { trackGeminiInvoke } = require('../../../helpers/geminiUsage');
        const gemini = createGeminiClient('planner');
        effectivePlannerLlm = async ({ prompt }) => {
            const response = await withGeminiRetry(() => withGeminiTimeout(
                (signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: sharedTracker, onUsage: null })
            ));
            return response.content;
        };
    }
    if (production && typeof effectiveLlmRerank !== 'function') {
        effectiveLlmRerank = createLlmRerank({ tracker: sharedTracker, onUsage: null });
    }

    // Planner (optional, once): only when the gate is on AND a model seam is
    // supplied. Offline/test lanes pass no seam and keep template queries.
    const retrievalOptions = { ...extraRetrievalOptions };
    const hasPresetQueries = Array.isArray(retrievalOptions.queries) && retrievalOptions.queries.length > 0;
    let plannedQueryCount = 0;
    const plannerGate = gates.planner ?? resolveReasoningPlanner();
    if (!hasPresetQueries && plannerGate !== 'off' && typeof effectivePlannerLlm === 'function') {
        try {
            const planned = await runPlanner(sharedClone, {
                plannerLlm: effectivePlannerLlm,
                tracker: sharedTracker,
                onUsage: null,
            });
            if (Array.isArray(planned) && planned.length > 0) {
                const { createRetrievalQueries } = require('../retrievalQueries');
                const templates = createRetrievalQueries({
                    query: sharedClone?.query,
                    clusterId: sharedClone?.clusterId,
                    primaryCaseNumber: sharedClone?.primaryCaseNumber,
                    identity: sharedClone?.identity,
                });
                retrievalOptions.queries = mergeQueries(planned, templates);
                plannedQueryCount = planned.length;
            }
        } catch (err) {
            agentLog.warn(`[LabShared] Planner failed; using templates (${err.message})`);
        }
    }

    const retrieval = doRetrieve(sharedClone, retrievalOptions);

    // Rerank gate mirrors reportService: explicit mode wins, else
    // ambiguous-only. A model call happens only with an `llmRerank` seam.
    const configuredMode = executionSnapshot?.rerank?.mode;
    const mode = configuredMode === 'force' || configuredMode === 'off' || configuredMode === 'auto'
        ? configuredMode
        : resolveRerankMode();
    const rerankOptions = { ...extraRerankOptions };
    if (mode === 'force') {
        rerankOptions.enabled = true;
        rerankOptions.force = true;
    } else if (mode === 'off') {
        rerankOptions.enabled = false;
    } else if (rerankOptions.enabled === undefined) {
        rerankOptions.enabled = shouldAttemptRerank({ ambiguous: isAmbiguous(retrieval) });
    }
    if (rerankOptions.enabled && typeof rerankOptions.llmRerank !== 'function' && typeof effectiveLlmRerank === 'function') {
        rerankOptions.llmRerank = effectiveLlmRerank;
    }
    const rerankedRetrieval = await doRerank(retrieval, rerankOptions);

    // Advisory passes (claim-judge + significance): bounded, advisory-only,
    // applied to the isolated clone. Each degrades to unannotated output on
    // any failure; neither ever removes or merges items.
    let claimLinks = null;
    let significanceRanking = null;
    try {
        const reconciliation = sharedClone?.reconciliation || null;
        const claimJudgeGate = gates.claimJudge ?? resolveReasoningClaimJudge();
        if (reconciliation && claimJudgeGate === 'on') {
            const pairs = selectPairs(reconciliation, sharedClone?.flows, {});
            if (Array.isArray(pairs) && pairs.length > 0) {
                const verdicts = await runJudge(pairs, {
                    ...(typeof judgeLlm === 'function' ? { judgeLlm } : {
                        judgeLlm: createClaimJudge({ tracker: sharedTracker, onUsage: null }),
                    }),
                    tracker: judgeTracker || sharedTracker,
                    onUsage: null,
                });
                const applied = applyVerdicts(reconciliation, pairs, verdicts);
                claimLinks = Array.isArray(applied?.claimLinks) ? applied.claimLinks : [];
            }
        }
        const significanceGate = gates.significance ?? resolveReasoningSignificance();
        if (reconciliation && significanceGate === 'on') {
            const shortlist = buildShortlist(reconciliation);
            if (Array.isArray(shortlist) && shortlist.length > 0) {
                const ranking = await runRank(shortlist, {
                    ...(typeof significanceLlm === 'function' ? { significanceLlm } : {}),
                    tracker: significanceTracker || sharedTracker,
                    onUsage: null,
                });
                if (ranking) {
                    applyRanking(reconciliation, shortlist, ranking);
                    significanceRanking = ranking;
                }
            }
        }
    } catch (err) {
        agentLog.warn(`[LabShared] Claim-judge/significance failed; continuing unannotated (${err.message})`);
    }

    return {
        retrieval,
        rerankedRetrieval,
        claimLinks,
        significanceRanking,
        plannedQueryCount,
        sharedUsage: sharedTracker.snapshot(),
        hashes: {
            retrievalHash: hashSharedArtifact(retrieval),
            rerankHash: hashSharedArtifact(rerankedRetrieval),
            advisoryHash: hashSharedArtifact({ claimLinks, significanceRanking }),
        },
    };
}

/**
 * Default per-variant report seam: one isolated `generateClusterReport` call
 * with the shared artifacts, Lab profile, disabled follow-up (enforced inside
 * reportService for any `labProfile`), and the variant's own tracker.
 */
async function defaultGenerateVariantReport({
    evidenceClone,
    profileId,
    sharedUpstream,
    tracker,
    onUsage,
    summarizeLlm,
}) {
    const result = await generateClusterReport(evidenceClone, {
        labProfile: profileId,
        sharedUpstream,
        summarizeLlm: profileId === 'context-tree-summarized-v1'
            ? (summarizeLlm || createContextNodeLlm({ tracker }))
            : null,
        tracker,
        onUsage,
    });
    return {
        report: result,
        trace: result?.meta?.contextTrace || result?.meta || null,
    };
}

/**
 * Runs a full three-profile comparison from one frozen evidence package.
 *
 * @param {object} args - `{ evidencePackage, evidencePackageRef,
 *   profiles?, runtimeMetadata?, summarizeLlm?, store?, deps?, now? }`.
 * @returns {Promise<object>} The finalized immutable experiment record
 *   (`complete`, `partial`, or `error`).
 */
async function runExperiment({
    evidencePackage,
    evidencePackageRef,
    profiles = [...PROFILE_IDS],
    runtimeMetadata = {},
    summarizeLlm = null,
    production = false,
    store = null,
    deps = {},
    now = () => Date.now(),
} = {}) {
    if (!evidencePackage || typeof evidencePackage !== 'object' || Array.isArray(evidencePackage)) {
        throw badRequest('runExperiment: evidencePackage must be a frozen evidence-package object.');
    }
    if (!evidencePackageRef || typeof evidencePackageRef !== 'string') {
        throw badRequest('runExperiment: evidencePackageRef is required (saved-run or fixture id).');
    }
    validateProfilesOrThrow(profiles);

    const validation = validateClusterEvidencePackage(evidencePackage);
    if (!validation.valid) {
        throw badRequest(`runExperiment: invalid frozen evidence package (${validation.error})`);
    }

    const frozenDigest = evidencePackageDigest(evidencePackage);
    const codeRevision = resolveCodeRevision(runtimeMetadata);
    const executionSnapshot = snapshotExecutionSettings(runtimeMetadata);
    const labStore = store || createAnalysisLabStore();

    // Shared passes run once on an isolated clone; the frozen input is
    // re-checked immediately after so a leaky seam fails loudly.
    const shared = await prepareSharedReportArtifacts(evidencePackage, executionSnapshot, {
        ...(deps.shared || {}),
        production: production || deps.shared?.production === true,
    });
    if (evidencePackageDigest(evidencePackage) !== frozenDigest) {
        throw new Error('runExperiment: frozen evidence package was mutated during shared preparation; refusing to compare.');
    }

    const sharedUpstreamHashes = { ...shared.hashes };
    const experiment = await labStore.createExperiment({
        evidencePackageRef,
        evidencePackageHash: frozenDigest,
        inputSummary: buildInputSummary(evidencePackage),
        executionSnapshot,
        sharedUpstream: sharedUpstreamHashes,
        sharedUsage: shared.sharedUsage,
    });
    const experimentId = experiment.id;

    const generateVariantReport = deps.generateVariantReport || defaultGenerateVariantReport;

    for (const profileId of profiles) {
        const variantClone = cloneEvidencePackage(evidencePackage);
        if (evidencePackageDigest(variantClone) !== frozenDigest) {
            await labStore.failExperimentVariant({
                experimentId,
                profileId,
                errorCode: 'input-hash-mismatch',
                errorMessage: 'Variant input digest differs from the frozen evidence hash; refusing to compare.',
            });
            continue;
        }
        // Supply the exact shared artifacts to every variant. Advisory deltas
        // are applied to the per-variant clone (reportService also applies
        // them defensively when `sharedUpstream` is passed).
        try {
            const reconciliation = variantClone?.reconciliation;
            if (reconciliation && typeof reconciliation === 'object') {
                if (reconciliation.claimLinks == null && shared.claimLinks != null) {
                    reconciliation.claimLinks = cloneEvidencePackage(shared.claimLinks);
                }
                if (reconciliation.significanceRanking == null && shared.significanceRanking != null) {
                    reconciliation.significanceRanking = cloneEvidencePackage(shared.significanceRanking);
                }
            }
        } catch (err) {
            agentLog.warn(`[LabExperiment] Advisory application failed for ${profileId}; continuing (${err.message})`);
        }
        const sharedUpstreamForVariant = {
            retrieval: cloneEvidencePackage(shared.retrieval),
            rerankedRetrieval: cloneEvidencePackage(shared.rerankedRetrieval),
            claimLinks: cloneEvidencePackage(shared.claimLinks),
            significanceRanking: cloneEvidencePackage(shared.significanceRanking),
            plannedQueryCount: shared.plannedQueryCount,
        };

        const tracker = createUsageTracker();
        const usageEvents = [];
        const onUsage = (snapshot) => {
            if (snapshot && typeof snapshot === 'object') usageEvents.push(snapshot);
        };
        const profileSnapshot = snapshotProfile(profileId, { ...runtimeMetadata, codeRevision });
        const startedAt = now();
        try {
            const { report, trace } = await generateVariantReport({
                evidenceClone: variantClone,
                profileId,
                profileSnapshot,
                sharedUpstream: sharedUpstreamForVariant,
                sharedHashes: { ...sharedUpstreamHashes },
                evidencePackageHash: frozenDigest,
                executionSnapshot,
                tracker,
                onUsage,
                summarizeLlm,
            });
            const elapsedMs = Math.max(0, now() - startedAt);
            const usage = { ...tracker.snapshot(), elapsedMs };
            // LE-2 — descriptive scorecard from the frozen package plus this
            // variant's report/trace/usage. Never fails the run: a scorecard
            // error degrades to null while the report stays recorded.
            const traceForRecord = trace && typeof trace === 'object'
                ? { ...trace, elapsedMs, evidencePackageHash: frozenDigest, sharedUpstream: { ...sharedUpstreamHashes } }
                : { elapsedMs, evidencePackageHash: frozenDigest, sharedUpstream: { ...sharedUpstreamHashes } };
            let deterministicScorecard = null;
            try {
                deterministicScorecard = computeVariantScorecard({
                    evidencePackage,
                    report,
                    trace: traceForRecord,
                    usage,
                    profileSnapshot,
                    evidencePackageHash: frozenDigest,
                });
            } catch (err) {
                agentLog.warn(`[LabExperiment] Scorecard failed for ${profileId}; storing null (${err.message})`);
            }
            await labStore.completeExperimentVariant({
                experimentId,
                profileId,
                profileSnapshot,
                report,
                trace: traceForRecord,
                usage,
                deterministicScorecard,
            });
        } catch (err) {
            const elapsedMs = Math.max(0, now() - startedAt);
            const usage = { ...tracker.snapshot(), elapsedMs };
            agentLog.warn(`[LabExperiment] Variant ${profileId} failed; recording partial (${err.message})`);
            await labStore.failExperimentVariant({
                experimentId,
                profileId,
                errorCode: 'variant-error',
                errorMessage: String(err?.message || err || 'Variant failed.').slice(0, 500),
                usage,
            });
        }
        if (evidencePackageDigest(evidencePackage) !== frozenDigest) {
            throw new Error('runExperiment: frozen evidence package was mutated during a variant run; aborting comparison.');
        }
    }

    await labStore.completeExperiment({ experimentId });
    return labStore.getExperiment({ id: experimentId });
}

module.exports = {
    runExperiment,
    prepareSharedReportArtifacts,
    defaultGenerateVariantReport,
    buildInputSummary,
};
