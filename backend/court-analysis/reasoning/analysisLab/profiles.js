// court-analysis/reasoning/analysisLab/profiles.js
//
// LA-1 — Lab profile registry and immutable snapshots.
//
// Exactly three built-in profiles (no user-editable profile system in this
// phase). Snapshots are self-contained, serializable, and secret-free: they
// capture the profile id, context strategy, resolved role model/config
// identifiers, prompt/schema versions, feature flags, node budgets, and the
// supplied code revision, plus the effective Lab execution settings. All
// snapshots are deep copies — later mutation of config/profile objects cannot
// mutate an existing snapshot.

const {
    GEMINI_ROLE_CONFIG,
    DEFAULT_GEMINI_MODEL,
    CONTEXT_NODE_PROMPT_VERSION,
} = require('../../../helpers/geminiConfig');
const { EXTRACTION_SCHEMA_VERSION } = require('../extractionSchema');
const { SCHEMA_VERSION: REPORT_SCHEMA_VERSION } = require('../schema');

// Evidence-package schema version: the ClusterEvidencePackage builder stamps
// `schemaVersion: 1` (see evidencePackage.js buildClusterEvidencePackage).
const EVIDENCE_SCHEMA_VERSION = 1;

// Prompt versions snapshotted with each profile. There is no standalone
// synthesis prompt-version constant in the codebase, so the current flat
// synthesis prompt is recorded as `vCurrent`; the node-summary prompt version
// is the single source in geminiConfig (LC-2 owns the role itself).
const LAB_PROMPT_VERSIONS = {
    contextNode: CONTEXT_NODE_PROMPT_VERSION,
    synthesis: 'vCurrent',
};

const CONTEXT_STRATEGIES = ['flat', 'case-context'];

const PROFILE_IDS = [
    'baseline-flat-v1',
    'context-tree-v1',
    'context-tree-summarized-v1',
];

const BUILT_IN_PROFILES = {
    'baseline-flat-v1': {
        id: 'baseline-flat-v1',
        contextStrategy: 'flat',
        nodeSummaries: 'off',
        budgets: { maxContextNodes: 0, maxNodeCalls: 0 },
        featureFlags: {},
    },
    'context-tree-v1': {
        id: 'context-tree-v1',
        contextStrategy: 'case-context',
        nodeSummaries: 'off',
        budgets: { maxContextNodes: 24, maxNodeCalls: 0 },
        featureFlags: {},
    },
    'context-tree-summarized-v1': {
        id: 'context-tree-summarized-v1',
        contextStrategy: 'case-context',
        nodeSummaries: 'on',
        budgets: { maxContextNodes: 24, maxNodeCalls: 4 },
        featureFlags: {},
    },
};

// Matches credential-bearing keys (apiKey, GOOGLE_API_KEY, secrets) without
// eating usage telemetry: `inputTokens`/`outputTokens`/`totalTokens` must
// survive redaction so per-variant cost stays inspectable.
const SECRET_KEY_PATTERN = /api[_-]?key|secret|credential|password|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|(^|[_-])tokens?([_-]|$)|(^|[_-])auth([_-]|$)/i;

function isKnownProfile(profileId) {
    return Object.prototype.hasOwnProperty.call(BUILT_IN_PROFILES, profileId);
}

function deepCopy(value) {
    if (value === null || value === undefined) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/**
 * Recursively strips secret-bearing keys so snapshots can never persist
 * credentials, even if a caller passes a config object that contains them.
 */
function stripSecrets(value) {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value)) {
            if (SECRET_KEY_PATTERN.test(key)) continue;
            out[key] = stripSecrets(value[key]);
        }
        return out;
    }
    return value;
}

/**
 * Resolves the effective model id + generation parameters for a Gemini role,
 * read-only from the central role config. The `GEMINI_MODEL` env override
 * wins, mirroring `createGeminiClient`.
 */
function resolveRoleSnapshot(role) {
    const roleConfig = GEMINI_ROLE_CONFIG?.[role] || {};
    return {
        model: process.env.GEMINI_MODEL || roleConfig.model || DEFAULT_GEMINI_MODEL,
        temperature: roleConfig.temperature ?? null,
        maxOutputTokens: roleConfig.maxOutputTokens ?? null,
    };
}

/**
 * Returns an isolated copy of a built-in profile definition. Throws on
 * unknown ids (allow-list validation). Mutating the result never affects
 * the registry.
 */
function getProfile(profileId) {
    if (!isKnownProfile(profileId)) {
        throw new Error(
            `Unknown analysis-lab profile: ${String(profileId)}. Known profiles: ${PROFILE_IDS.join(', ')}.`
        );
    }
    return deepCopy(BUILT_IN_PROFILES[profileId]);
}

function listProfiles() {
    return [...PROFILE_IDS];
}

/**
 * Snapshots the effective Lab execution settings: the optional-pass gates,
 * retrieval/rerank settings, environment-derived limits, model ids, and
 * generation parameters that can affect output. Only an explicit allow-list
 * of fields is captured; secrets are stripped. Follow-up verification is
 * always `off` for Lab runs (spec §5.1).
 *
 * @param {object} [runtimeMetadata] - `{ codeRevision, gates, retrieval,
 *   rerank, limits }`. Unrecognized keys are ignored.
 */
function snapshotExecutionSettings(runtimeMetadata = {}) {
    const source = runtimeMetadata && typeof runtimeMetadata === 'object' ? runtimeMetadata : {};
    const snapshot = {
        followUpVerification: 'off',
        gates: {
            claimJudge: source?.gates?.claimJudge ?? 'on',
            significance: source?.gates?.significance ?? 'on',
            verification: source?.gates?.verification ?? 'standard',
        },
        retrieval: {
            mode: source?.retrieval?.mode ?? 'standard',
            topK: source?.retrieval?.topK ?? null,
        },
        rerank: {
            mode: source?.rerank?.mode ?? 'standard',
            status: source?.rerank?.status ?? null,
        },
        limits: {
            synthesisInputChars: source?.limits?.synthesisInputChars ?? null,
            fullClaimLimit: source?.limits?.fullClaimLimit ?? null,
            nodeEnvCap: process.env.LAB_MAX_NODE_CALLS ?? null,
        },
        models: {
            synthesis: resolveRoleSnapshot('synthesis'),
            verify: resolveRoleSnapshot('verify'),
            rerank: resolveRoleSnapshot('rerank'),
        },
    };
    return Object.freeze(stripSecrets(deepCopy(snapshot)));
}

/**
 * Creates an immutable, serializable snapshot of a built-in profile plus the
 * effective execution settings. Accepts a profile id (allow-list validated)
 * or a profile object whose `id` names a known profile — arbitrary inline
 * profile definitions are rejected.
 *
 * @param {string|object} profileRef - Known profile id, or object with a
 *   known `id`.
 * @param {object} [runtimeMetadata] - `{ codeRevision, gates, retrieval,
 *   rerank, limits, featureFlags }`.
 * @returns {object} Frozen snapshot (deep-frozen one level + frozen nested
 *   copies; safe to serialize).
 */
function snapshotProfile(profileRef, runtimeMetadata = {}) {
    const profileId = typeof profileRef === 'string' ? profileRef : profileRef?.id;
    if (!isKnownProfile(profileId)) {
        throw new Error(
            `Unknown analysis-lab profile: ${String(profileId)}. Known profiles: ${PROFILE_IDS.join(', ')}.`
        );
    }
    if (profileRef && typeof profileRef === 'object' && !Array.isArray(profileRef)) {
        const extraKeys = Object.keys(profileRef).filter((key) => key !== 'id');
        if (extraKeys.length > 0) {
            throw new Error(
                `analysis-lab profiles are not user-editable: unexpected fields [${extraKeys.join(', ')}] on ${profileId}.`
            );
        }
    }
    const definition = BUILT_IN_PROFILES[profileId];
    const source = runtimeMetadata && typeof runtimeMetadata === 'object' ? runtimeMetadata : {};

    const snapshot = stripSecrets({
        id: definition.id,
        contextStrategy: definition.contextStrategy,
        nodeSummaries: definition.nodeSummaries,
        budgets: deepCopy(definition.budgets),
        featureFlags: deepCopy(source.featureFlags ?? definition.featureFlags),
        modelRoles: {
            synthesis: resolveRoleSnapshot('synthesis'),
            verify: resolveRoleSnapshot('verify'),
        },
        promptVersions: { ...LAB_PROMPT_VERSIONS },
        schemaVersions: {
            evidence: EVIDENCE_SCHEMA_VERSION,
            extraction: EXTRACTION_SCHEMA_VERSION,
            report: REPORT_SCHEMA_VERSION,
        },
        codeRevision: source.codeRevision || 'unknown',
        executionSnapshot: snapshotExecutionSettings(source),
    });

    return deepFreeze(snapshot);
}

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const key of Object.keys(value)) {
            deepFreeze(value[key]);
        }
        Object.freeze(value);
    }
    return value;
}

module.exports = {
    PROFILE_IDS,
    CONTEXT_STRATEGIES,
    LAB_PROMPT_VERSIONS,
    EVIDENCE_SCHEMA_VERSION,
    isKnownProfile,
    getProfile,
    listProfiles,
    snapshotProfile,
    snapshotExecutionSettings,
};
