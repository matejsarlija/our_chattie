// backend/court-analysis/reasoning/analysisLab/runExperiment.js
//
// LE-1 — Analysis Lab comparison orchestrator (spec §§4–5, 8).
//
// Runs the three built-in profiles from one frozen evidence package:
// Deterministic retrieval runs ONCE against an isolated clone; all three
// variants receive the same snapshotted evidence. Each variant then runs with
// its own usage tracker, timing, trace collector, temporary context, and error
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
} = require('../../../services/canonicalJson');
const { validateClusterEvidencePackage } = require('../evidencePackage');
const { retrieveEvidence } = require('../retriever');
const { computeVariantScorecard } = require('../runScorecard');
const { generateClusterReport } = require('../reportService');
const { createContextNodeLlm } = require('./contextNodeSummary');
const { createUsageTracker } = require('../../../helpers/geminiUsage');
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
 * Runs deterministic retrieval once against an isolated clone of the frozen
 * package so every Lab variant receives the same evidence set.
 */
function prepareSharedReportArtifacts(evidencePackage, deps = {}) {
    const {
        retrieveEvidence: doRetrieve = retrieveEvidence,
        retrievalOptions = {},
    } = deps || {};
    const sharedClone = cloneEvidencePackage(evidencePackage);
    const retrieval = doRetrieve(sharedClone, retrievalOptions);
    return {
        retrieval,
        sharedUsage: createUsageTracker().snapshot(),
        hashes: {
            retrievalHash: hashSharedArtifact(retrieval),
        },
    };
}

/**
 * Default per-variant report seam: one isolated `generateClusterReport` call
 * with the shared artifacts, Lab profile, and the variant's own tracker.
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

    // Shared deterministic retrieval runs on an isolated clone; verify the
    // frozen input remains untouched before comparing variants.
    const shared = prepareSharedReportArtifacts(evidencePackage, deps.shared || {});
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
        const sharedUpstreamForVariant = {
            retrieval: cloneEvidencePackage(shared.retrieval),
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
