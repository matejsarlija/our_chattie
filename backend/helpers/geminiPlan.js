// Resolves which Gemini plan the user is on so the retry/error policy can
// distinguish a terminal free-tier daily cap from a transient paid-tier burst.
//
// Source of truth is the persisted user setting (`settings.json`), because the
// user declares the plan in the dashboard. `GEMINI_PLAN` acts only as a
// deployment-level default for fresh installs with no persisted value yet.
const fs = require('fs');
const path = require('path');

const DEFAULT_GEMINI_PLAN = 'free';
const GEMINI_PLANS = ['free', 'paid'];

function getSettingsFilePath() {
    const dataDir = process.env.ANALYSIS_DATA_DIR || path.join(__dirname, '..', 'data', 'analysis');
    return path.join(dataDir, 'settings.json');
}

function resolveGeminiPlan() {
    let persisted;
    try {
        persisted = JSON.parse(fs.readFileSync(getSettingsFilePath(), 'utf8')).geminiPlan;
    } catch (err) {
        persisted = null;
    }

    if (GEMINI_PLANS.includes(persisted)) return persisted;
    if (GEMINI_PLANS.includes(process.env.GEMINI_PLAN)) return process.env.GEMINI_PLAN;
    return DEFAULT_GEMINI_PLAN;
}

module.exports = {
    DEFAULT_GEMINI_PLAN,
    GEMINI_PLANS,
    resolveGeminiPlan,
};
