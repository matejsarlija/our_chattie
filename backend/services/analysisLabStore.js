// backend/services/analysisLabStore.js
//
// LA-2 — Analysis Lab experiment persistence, separate from analysis runs.
//
// Experiments live in their own `experiments.json` namespace under
// ANALYSIS_DATA_DIR and never touch `runs.json`: Lab comparisons must neither
// mutate a source analysis run nor be shaped like one. Records are immutable
// once written — completing a variant can only fill a previously absent slot,
// never overwrite a recorded variant/report.
//
// Same queued-write pattern as `services/localStore.js` so concurrent
// completions serialize instead of losing writes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    PROFILE_IDS,
    isKnownProfile,
} = require('../court-analysis/reasoning/analysisLab/profiles');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'analysis');

const EXPERIMENT_STATUSES = ['running', 'complete', 'partial', 'error'];
// Matches credential-bearing keys (apiKey, GOOGLE_API_KEY, secrets,
// passwords, standalone token/auth segments) without eating usage
// telemetry: `inputTokens`/`outputTokens`/`totalTokens` must survive so the
// §6 cost dimension (calls/tokens per variant) stays persisted.
const SECRET_KEY_PATTERN = /api[_-]?key|secret|credential|password|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|(^|[_-])tokens?([_-]|$)|(^|[_-])auth([_-]|$)/i;

function getDataDir(override) {
    return override || process.env.ANALYSIS_DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        if (err.code === 'ENOENT') return fallback;
        throw err;
    }
}

function writeJson(filePath, value) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createId() {
    return crypto.randomUUID();
}

function deepCopy(value) {
    if (value === null || value === undefined) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

/**
 * Strips secret-bearing keys so experiment records can never persist
 * credentials, even if a caller passes a payload that contains them.
 * Raw PDFs / full prompts are the caller's responsibility to withhold
 * (guarded at the orchestrator/API boundary); this is a second net, not a
 * content policy.
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

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function conflict(message) {
    const err = new Error(message);
    err.statusCode = 409;
    return err;
}

function createAnalysisLabStore(options = {}) {
    const dataDir = getDataDir(options.dataDir);
    const experimentsFile = path.join(dataDir, 'experiments.json');

    let writeQueue = Promise.resolve();

    function enqueue(task) {
        const next = writeQueue.then(task, task);
        writeQueue = next.catch(() => {});
        return next;
    }

    function nowIso() {
        return new Date().toISOString();
    }

    function readExperiments() {
        const parsed = readJson(experimentsFile, []);
        return Array.isArray(parsed) ? parsed : [];
    }

    function writeExperiments(list) {
        writeJson(experimentsFile, list);
    }

    function findExperiment(list, id) {
        const experiment = list.find((item) => item?.id === id);
        if (!experiment) {
            throw new Error('Analysis Lab experiment not found.');
        }
        return experiment;
    }

    function validateProfiles(profiles) {
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
        const extra = profiles.filter((id) => !PROFILE_IDS.includes(id));
        if (extra.length > 0) {
            throw badRequest(`Experiment profiles must be exactly the three built-in profiles; unexpected: ${extra.join(', ')}.`);
        }
        if (new Set(profiles).size !== profiles.length) {
            throw badRequest('Experiment profiles must not contain duplicates.');
        }
    }

    /**
     * Opens a new immutable comparison record in `running` state.
     */
    async function createExperiment({
        evidencePackageRef,
        evidencePackageHash,
        inputSummary = null,
        profiles = [...PROFILE_IDS],
        executionSnapshot = null,
        sharedUpstream = null,
        sharedUsage = null,
    } = {}) {
        return enqueue(() => {
            if (!evidencePackageRef || typeof evidencePackageRef !== 'string') {
                throw badRequest('evidencePackageRef is required (saved-run or fixture id).');
            }
            if (!evidencePackageHash || typeof evidencePackageHash !== 'string') {
                throw badRequest('evidencePackageHash is required (canonical SHA-256 of the frozen package).');
            }
            validateProfiles(profiles);

            const list = readExperiments();
            const now = nowIso();
            const experiment = {
                id: createId(),
                createdAt: now,
                updatedAt: now,
                completedAt: null,
                evidencePackageRef,
                evidencePackageHash,
                inputSummary: stripSecrets(deepCopy(inputSummary)),
                profiles: [...profiles],
                executionSnapshot: stripSecrets(deepCopy(executionSnapshot)),
                sharedUpstream: stripSecrets(deepCopy(sharedUpstream)),
                sharedUsage: stripSecrets(deepCopy(sharedUsage)),
                variants: {},
                status: 'running',
            };
            list.push(experiment);
            writeExperiments(list);
            return deepCopy(experiment);
        });
    }

    /**
     * Records a successful variant. Only fills a previously absent slot —
     * re-completing a recorded variant is rejected so stored reports stay
     * immutable. Only allowed while the experiment is `running`.
     */
    async function completeExperimentVariant({
        experimentId,
        profileId,
        profileSnapshot = null,
        report = null,
        trace = null,
        usage = null,
        deterministicScorecard = null,
    } = {}) {
        return enqueue(() => {
            if (!isKnownProfile(profileId)) {
                throw badRequest(`Unknown analysis-lab profile: ${String(profileId)}.`);
            }
            const list = readExperiments();
            const experiment = findExperiment(list, experimentId);
            if (experiment.status !== 'running') {
                throw conflict(`Experiment ${experiment.id} is already ${experiment.status}; recorded variants are immutable.`);
            }
            if (!experiment.profiles.includes(profileId)) {
                throw badRequest(`Profile ${profileId} is not part of experiment ${experiment.id}.`);
            }
            if (experiment.variants[profileId]) {
                throw conflict(`Variant ${profileId} is already recorded for experiment ${experiment.id}; refusing to overwrite.`);
            }
            experiment.variants[profileId] = {
                profileSnapshot: stripSecrets(deepCopy(profileSnapshot)),
                report: stripSecrets(deepCopy(report)),
                trace: stripSecrets(deepCopy(trace)),
                usage: stripSecrets(deepCopy(usage)),
                deterministicScorecard: stripSecrets(deepCopy(deterministicScorecard)),
                status: 'complete',
                completedAt: nowIso(),
            };
            experiment.updatedAt = nowIso();
            writeExperiments(list);
            return deepCopy(experiment);
        });
    }

    /**
     * Records a failed variant without touching the successful ones, so a
     * candidate failure stays inspectable while the baseline remains
     * readable. Only the error code/message travel — never stack traces or
     * provider payloads.
     */
    async function failExperimentVariant({
        experimentId,
        profileId,
        errorCode = 'variant-error',
        errorMessage = 'Variant failed.',
        usage = null,
    } = {}) {
        return enqueue(() => {
            if (!isKnownProfile(profileId)) {
                throw badRequest(`Unknown analysis-lab profile: ${String(profileId)}.`);
            }
            const list = readExperiments();
            const experiment = findExperiment(list, experimentId);
            if (experiment.status !== 'running') {
                throw conflict(`Experiment ${experiment.id} is already ${experiment.status}; recorded variants are immutable.`);
            }
            if (!experiment.profiles.includes(profileId)) {
                throw badRequest(`Profile ${profileId} is not part of experiment ${experiment.id}.`);
            }
            if (experiment.variants[profileId]) {
                throw conflict(`Variant ${profileId} is already recorded for experiment ${experiment.id}; refusing to overwrite.`);
            }
            experiment.variants[profileId] = {
                profileSnapshot: null,
                report: null,
                trace: null,
                usage: stripSecrets(deepCopy(usage)),
                deterministicScorecard: null,
                status: 'error',
                errorCode: String(errorCode || 'variant-error'),
                errorMessage: String(errorMessage || 'Variant failed.'),
                completedAt: nowIso(),
            };
            experiment.updatedAt = nowIso();
            writeExperiments(list);
            return deepCopy(experiment);
        });
    }

    /**
     * Finalizes an experiment. All variants successful → `complete`; at
     * least one successful variant → `partial`; none → `error`.
     */
    async function completeExperiment({ experimentId } = {}) {
        return enqueue(() => {
            const list = readExperiments();
            const experiment = findExperiment(list, experimentId);
            if (experiment.status !== 'running') {
                throw conflict(`Experiment ${experiment.id} is already ${experiment.status}.`);
            }
            const recorded = experiment.profiles.map((id) => experiment.variants[id]);
            const succeeded = recorded.filter((variant) => variant?.status === 'complete');
            if (succeeded.length === experiment.profiles.length) {
                experiment.status = 'complete';
            } else if (succeeded.length > 0) {
                experiment.status = 'partial';
            } else {
                experiment.status = 'error';
            }
            const now = nowIso();
            experiment.completedAt = now;
            experiment.updatedAt = now;
            writeExperiments(list);
            return deepCopy(experiment);
        });
    }

    async function getExperiment({ id }) {
        const list = readExperiments();
        return deepCopy(findExperiment(list, id));
    }

    async function listExperiments({ limit = 50, offset = 0 } = {}) {
        const list = readExperiments();
        const insertionOrder = new Map(list.map((experiment, index) => [experiment.id, index]));
        const sorted = [...list].sort((a, b) => {
            if (a.createdAt === b.createdAt) return insertionOrder.get(b.id) - insertionOrder.get(a.id);
            return a.createdAt < b.createdAt ? 1 : -1;
        });
        const page = sorted.slice(offset, offset + limit);
        return { data: deepCopy(page), count: sorted.length };
    }

    function reset() {
        try {
            fs.rmSync(experimentsFile, { force: true });
        } catch (err) {
            // Best-effort reset.
        }
        return experimentsFile;
    }

    return {
        dataDir,
        experimentsFile,
        createExperiment,
        completeExperimentVariant,
        failExperimentVariant,
        completeExperiment,
        getExperiment,
        listExperiments,
        reset,
    };
}

module.exports = {
    createAnalysisLabStore,
    EXPERIMENT_STATUSES,
};
