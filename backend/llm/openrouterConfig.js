'use strict';

const { createOpenRouterClient } = require('./openrouterClient');

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
function createOpenRouterRoleClient(role) {
    const config = resolveRoleConfig(role);
    return createOpenRouterClient({
        ...config,
        maxTokens: config.maxOutputTokens,
        responseFormat: role === 'ocr' || role === 'ocr-batch'
            ? undefined
            : { type: 'json_object' },
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
    outputCapWarning,
    createOpenRouterRoleClient,
};
