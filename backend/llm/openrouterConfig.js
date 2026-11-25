'use strict';

const { createOpenRouterClient } = require('./openrouterClient');
const { Z_AI_PROVIDER_PREF, GEMMA_PROVIDER_PREF, GEMINI_PROVIDER_PREF } = require('./taskRouter');

const OPENROUTER_ROLE_CONFIG = Object.freeze({
    analysis: Object.freeze({ model: 'z-ai/glm-5.3-flash', temperature: 0.2, maxOutputTokens: 16384 }),
    ocr: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0.1, maxOutputTokens: 4096 }),
    'ocr-batch': Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0.1, maxOutputTokens: 16384 }),
    synthesis: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0.2, maxOutputTokens: 24576 }),
    verify: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0.1, maxOutputTokens: 8192 }),
    rerank: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0, maxOutputTokens: 1024 }),
    repair: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0, maxOutputTokens: 4096 }),
    significance: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0, maxOutputTokens: 1024 }),
    claimJudge: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0, maxOutputTokens: 1024 }),
    planner: Object.freeze({ model: 'google/gemini-2.5-flash', temperature: 0.1, maxOutputTokens: 512 }),
});

function buildRoleProviderPreference(modelId) {
    const id = String(modelId || '').toLowerCase();
    if (id.startsWith('z-ai/')) return Z_AI_PROVIDER_PREF;
    if (id.startsWith('google/gemma')) return GEMMA_PROVIDER_PREF;
    if (id.startsWith('google/gemini')) return GEMINI_PROVIDER_PREF;
    return undefined;
}

function assertOpenRouterConfig() {
    if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY is not set. Copy backend/.env.example to backend/.env and add an OpenRouter API key.');
    }
    return { apiKey: process.env.OPENROUTER_API_KEY };
}

function resolveRoleConfig(role) {
    const config = OPENROUTER_ROLE_CONFIG[role] || {};
    const model = process.env.OPENROUTER_MODEL || config.model;
    return model === config.model ? config : { ...config, model };
}

function createOpenRouterRoleClient(role, options = {}) {
    const config = resolveRoleConfig(role);
    return createOpenRouterClient({
        ...config,
        maxTokens: options.maxTokens ?? config.maxOutputTokens,
        provider: options.provider || buildRoleProviderPreference(config.model),
        responseFormat: role === 'ocr' || role === 'ocr-batch'
            ? undefined
            : { type: 'json_object' },
        ...options,
    });
}

function outputCapWarning(role) {
    const cap = resolveRoleConfig(role).maxOutputTokens;
    return `[OpenRouter] A '${role}' completion could not be parsed as JSON — possible output truncation (role cap: maxTokens=${cap ?? 'provider default'}).`;
}

module.exports = {
    OPENROUTER_ROLE_CONFIG,
    assertOpenRouterConfig,
    resolveRoleConfig,
    buildRoleProviderPreference,
    outputCapWarning,
    createOpenRouterRoleClient,
};
