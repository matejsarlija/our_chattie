// backend/services/analysisLabStore.js
//
// LA-2 — Analysis Lab experiment persistence, separate from analysis runs.
//
// The legacy `experiments.json` array remains readable. New/updated records
// are written separately so one large report/trace cannot force a stringify
// and rewrite of every historical experiment.

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
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(temporaryPath, filePath);
    } catch (error) {
        try {
            fs.rmSync(temporaryPath, { force: true });
        } catch (_) {
            // Preserve the write error; temporary-file cleanup is best effort.
        }
        throw error;
    }
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
    const experimentRecordsDir = path.join(dataDir, 'experiments');
    let legacyExperiments = null;

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
        if (!legacyExperiments) {
            const parsed = readJson(experimentsFile, []);
            legacyExperiments = Array.isArray(parsed) ? parsed : [];
        }
        const records = new Map(legacyExperiments.map((experiment) => [experiment.id, experiment]));
        if (fs.existsSync(experimentRecordsDir)) {
            for (const entry of fs.readdirSync(experimentRecordsDir, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
                const record = readJson(path.join(experimentRecordsDir, entry.name), null);
                if (record && typeof record.id === 'string') records.set(record.id, record);
            }
        }
        return [...records.values()];
    }

    function writeExperiment(experiment) {
        const idHash = crypto.createHash('sha256').update(String(experiment.id)).digest('hex');
        writeJson(path.join(experimentRecordsDir, `${idHash}.json`), experiment);
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

            const now = nowIso();
            // Persist a tie-breaker: hashed directory names do not retain
            // insertion order. Older records without one sort before new ones.
            const creationOrder = readExperiments().reduce(
                (latest, record) => Math.max(latest, record.creationOrder || 0),
                0
            ) + 1;
            const experiment = {
                id: createId(),
                createdAt: now,
                creationOrder,
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
            writeExperiment(experiment);
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
            const experiment = deepCopy(findExperiment(list, experimentId));
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
            writeExperiment(experiment);
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
            const experiment = deepCopy(findExperiment(list, experimentId));
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
            writeExperiment(experiment);
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
            const experiment = deepCopy(findExperiment(list, experimentId));
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
            writeExperiment(experiment);
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
            if (a.createdAt === b.createdAt) {
                return (b.creationOrder || 0) - (a.creationOrder || 0)
                    || insertionOrder.get(b.id) - insertionOrder.get(a.id);
            }
            return a.createdAt < b.createdAt ? 1 : -1;
        });
        const page = sorted.slice(offset, offset + limit);
        return { data: deepCopy(page), count: sorted.length };
    }

    function reset() {
        for (const target of [experimentsFile, experimentRecordsDir]) {
            try {
                fs.rmSync(target, { recursive: true, force: true });
            } catch (err) {
                // Best-effort reset.
            }
        }
        legacyExperiments = [];
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
