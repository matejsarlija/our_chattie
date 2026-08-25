// backend/helpers/reasoningSettings.js
//
// Resolves the reasoning-experiment switches (rerank / planner / follow-up
// re-verification) so they can be driven from the dashboard instead of shell
// env vars. Persisted user setting wins, deployment-level env var is the
// fallback for fresh installs and CLI.
//
// These are per-RUN knobs read at call time — a dashboard change applies to
// the next analysis without a backend restart.
const fs = require('fs');
const path = require('path');

const REASONING_RERANK_MODES = ['auto', 'force', 'off'];
const ON_OFF = ['on', 'off'];

const DEFAULT_REASONING_SETTINGS = Object.freeze({
    rerankMode: 'auto',
    planner: 'on',
    followUp: 'on',
});

function getSettingsFilePath() {
    const dataDir = process.env.ANALYSIS_DATA_DIR || path.join(__dirname, '..', 'data', 'analysis');
    return path.join(dataDir, 'settings.json');
}

function readPersisted(key) {
    try {
        return JSON.parse(fs.readFileSync(getSettingsFilePath(), 'utf8'))[key];
    } catch (err) {
        return null;
    }
}

function pick(validValues, persisted, envValue, fallbackKey) {
    if (validValues.includes(persisted)) return persisted;
    if (validValues.includes(envValue)) return envValue;
    return DEFAULT_REASONING_SETTINGS[fallbackKey];
}

// Rerank shares its env spelling with the CLI switch (auto|force|off).
function resolveReasoningRerankMode() {
    const raw = String(process.env.REASONING_RERANK || '').trim().toLowerCase();
    return pick(
        REASONING_RERANK_MODES,
        readPersisted('reasoningRerankMode'),
        REASONING_RERANK_MODES.includes(raw) ? raw : null,
        'rerankMode'
    );
}

// Planner/follow-up env vars historically spell the OFF state only
// (REASONING_PLANNER=off); absence means "on". "force" always runs — a
// deterministic test/CLI escape hatch. Persisted values stay on/off (matches
// the dashboard + localStore contract); "force" is env-only.
function resolveOnOff(persistedKey, envKey, fallbackKey) {
    const persisted = readPersisted(persistedKey);
    if (ON_OFF.includes(persisted)) return persisted;
    const envRaw = String(process.env[envKey] || '').trim().toLowerCase();
    if (envRaw === 'off') return 'off';
    if (envRaw === 'force') return 'force';
    if (envRaw === 'on') return 'on';
    return DEFAULT_REASONING_SETTINGS[fallbackKey];
}

function resolveReasoningPlanner() {
    return resolveOnOff('reasoningPlanner', 'REASONING_PLANNER', 'planner');
}

function resolveReasoningFollowUp() {
    return resolveOnOff('reasoningFollowUp', 'REASONING_FOLLOWUP', 'followUp');
}

module.exports = {
    DEFAULT_REASONING_SETTINGS,
    REASONING_RERANK_MODES,
    REASONING_ON_OFF: ON_OFF,
    resolveReasoningRerankMode,
    resolveReasoningPlanner,
    resolveReasoningFollowUp,
};
