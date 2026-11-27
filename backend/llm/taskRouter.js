'use strict';

const crypto = require('node:crypto');
const logger = require('../services/logger');
const { createOpenRouterClient } = require('./openrouterClient');
const { withGeminiRetry } = require('./retry');
const { trackUsageInvoke } = require('./usage');
const { getSharedProviderPoolRegistry, poolKeyForModel } = require('./providerPool');
const { isCreditExhaustedError, createCreditExhaustedError } = require('./creditLatch');

const Z_AI_PRIMARY_MODEL = 'z-ai/glm-5.3-flash';
const GEMMA_RASTER_MODEL = 'google/gemma-4-31b-it';
const GEMINI_FLASH_MODEL = 'google/gemini-2.5-flash';

const Z_AI_PROVIDER_PREF = Object.freeze({
    order: ['Novita', 'DeepInfra', 'Z.AI'],
    sort: 'throughput',
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: 'deny',
    quantizations: ['bf16', 'fp16', 'fp8'],
});

const GEMMA_PROVIDER_PREF = Object.freeze({
    order: ['DeepInfra', 'Parasail', 'Together'],
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: 'deny',
    quantizations: ['bf16', 'fp16', 'fp8'],
});

const GEMINI_PROVIDER_PREF = Object.freeze({
    order: ['Google AI Studio', 'Google Vertex'],
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: 'deny',
});

const TASK_ROUTES = Object.freeze({
    TranscribePage: Object.freeze({
        model: GEMMA_RASTER_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0.1,
        maxTokens: 16384,
        provider: GEMMA_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    ExtractDoc: Object.freeze({
        model: Z_AI_PRIMARY_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 16384,
        responseFormat: { type: 'json_object' },
        reasoning: { max_tokens: 1536, exclude: true },
        provider: Z_AI_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    ExtractTableChunk: Object.freeze({
        model: Z_AI_PRIMARY_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 16384,
        responseFormat: { type: 'json_object' },
        reasoning: { max_tokens: 1536, exclude: true },
        provider: Z_AI_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    ExtractProseChunk: Object.freeze({
        model: Z_AI_PRIMARY_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 8192,
        responseFormat: { type: 'json_object' },
        reasoning: { max_tokens: 1536, exclude: true },
        provider: Z_AI_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    ExtractAdminNotice: Object.freeze({
        model: Z_AI_PRIMARY_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 2048,
        responseFormat: { type: 'json_object' },
        provider: Z_AI_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    VerifyExtraction: Object.freeze({
        model: GEMMA_RASTER_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 2048,
        responseFormat: { type: 'json_object' },
        provider: GEMMA_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    VerifyFindings: Object.freeze({
        model: GEMINI_FLASH_MODEL,
        fallbackModel: null,
        temperature: 0.1,
        maxTokens: 8192,
        responseFormat: { type: 'json_object' },
        provider: GEMINI_PROVIDER_PREF,
    }),
    SynthesizeCase: Object.freeze({
        model: GEMINI_FLASH_MODEL,
        fallbackModel: null,
        temperature: 0.2,
        maxTokens: 24576,
        responseFormat: { type: 'json_object' },
        provider: GEMINI_PROVIDER_PREF,
    }),
    VerifyReport: Object.freeze({
        model: GEMINI_FLASH_MODEL,
        fallbackModel: null,
        temperature: 0.1,
        maxTokens: 8192,
        responseFormat: { type: 'json_object' },
        provider: GEMINI_PROVIDER_PREF,
    }),
    ClassifyRelevance: Object.freeze({
        model: GEMMA_RASTER_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 1024,
        responseFormat: { type: 'json_object' },
        provider: GEMMA_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    EvaluateAnswer: Object.freeze({
        model: GEMMA_RASTER_MODEL,
        fallbackModel: GEMINI_FLASH_MODEL,
        temperature: 0,
        maxTokens: 4096,
        responseFormat: { type: 'json_object' },
        provider: GEMMA_PROVIDER_PREF,
        fallbackProvider: GEMINI_PROVIDER_PREF,
    }),
    FieldRepair: Object.freeze({
        model: GEMINI_FLASH_MODEL,
        fallbackModel: null,
        temperature: 0,
        maxTokens: 4096,
        responseFormat: { type: 'json_object' },
        provider: GEMINI_PROVIDER_PREF,
    }),
    FullRepair: Object.freeze({
        model: GEMINI_FLASH_MODEL,
        fallbackModel: null,
        temperature: 0,
        maxTokens: 8192,
        responseFormat: { type: 'json_object' },
        provider: GEMINI_PROVIDER_PREF,
    }),
});

function buildProviderPreferenceWithIgnore(baseProvider, ignoredProviders = []) {
    if (!baseProvider && ignoredProviders.length === 0) return undefined;
    const base = baseProvider ? { ...baseProvider } : {};
    const ignored = [...new Set([...(base.ignore || []), ...ignoredProviders].filter(Boolean))];
    if (Array.isArray(base.order)) {
        const remaining = base.order.filter((slug) => !ignored.includes(slug));
        if (remaining.length > 0) base.order = remaining;
    }
    if (ignored.length > 0) base.ignore = ignored;
    return base;
}

function hashPromptText(input) {
    const raw = typeof input === 'string'
        ? input
        : JSON.stringify(input || '');
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

function serializePromptForTrace(input) {
    if (typeof input === 'string') return input;
    try {
        return JSON.stringify(input);
    } catch {
        return String(input);
    }
}

function createTaskRouter({
    poolRegistry = getSharedProviderPoolRegistry(),
    creditLatch = null,
    sqliteStore = null,
    runId = null,
    zAiCircuitThreshold = 5,
    clientFactory = createOpenRouterClient,
} = {}) {
    let consecutiveZAiFailures = 0;

    function isZAiCircuitOpen() {
        return consecutiveZAiFailures >= zAiCircuitThreshold;
    }

    function resolveTaskConfig(taskType, overrides = {}) {
        const route = TASK_ROUTES[taskType];
        if (!route) {
            throw new Error(`Unknown LLM taskType: ${taskType}`);
        }
        let model = overrides.model || route.model;
        let provider = overrides.provider || route.provider;
        if (model === Z_AI_PRIMARY_MODEL && isZAiCircuitOpen() && route.fallbackModel) {
            model = route.fallbackModel;
            provider = route.fallbackProvider || GEMINI_PROVIDER_PREF;
        }
        const plugins = overrides.plugins !== undefined ? overrides.plugins : route.plugins;
        const poolKey = overrides.poolKey || poolKeyForModel(model, plugins);
        return {
            taskType,
            model,
            fallbackModel: overrides.fallbackModel !== undefined ? overrides.fallbackModel : route.fallbackModel,
            fallbackProvider: route.fallbackProvider || GEMINI_PROVIDER_PREF,
            temperature: overrides.temperature ?? route.temperature,
            maxTokens: overrides.maxTokens ?? route.maxTokens,
            responseFormat: overrides.responseFormat !== undefined ? overrides.responseFormat : route.responseFormat,
            reasoning: overrides.reasoning !== undefined ? overrides.reasoning : route.reasoning,
            provider,
            plugins,
            poolKey,
            stream: overrides.stream,
            idleTimeoutMs: overrides.idleTimeoutMs,
            totalTimeoutMs: overrides.totalTimeoutMs,
        };
    }

    function recordModelSuccess(modelId) {
        if (modelId === Z_AI_PRIMARY_MODEL) {
            consecutiveZAiFailures = 0;
        }
    }

    function recordModelFailure(modelId) {
        if (modelId === Z_AI_PRIMARY_MODEL) {
            consecutiveZAiFailures += 1;
            if (consecutiveZAiFailures === zAiCircuitThreshold) {
                logger.agent.warn(
                    `[TaskRouter] Tripped ${Z_AI_PRIMARY_MODEL} circuit breaker after ${consecutiveZAiFailures} consecutive failures; routing ExtractDoc to ${GEMINI_FLASH_MODEL}.`,
                );
            }
        }
    }

    async function invokeSingleModel({
        config,
        model,
        provider,
        input,
        ignoredProviders,
        docHash,
        segmentId,
        promptHash,
        tracker,
        onUsage,
        signal,
        retryOptions,
    }) {
        const currentPoolKey = poolKeyForModel(model, config.plugins);
        const invokeOnce = async () => {
            if (creditLatch?.isTripped?.()) {
                throw createCreditExhaustedError();
            }
            const activeProvider = buildProviderPreferenceWithIgnore(provider, [...ignoredProviders]);
            const client = clientFactory({
                model,
                temperature: config.temperature,
                maxTokens: config.maxTokens,
                responseFormat: config.responseFormat,
                reasoning: config.reasoning,
                provider: activeProvider,
                plugins: config.plugins,
                stream: config.stream,
                idleTimeoutMs: config.idleTimeoutMs,
                totalTimeoutMs: config.totalTimeoutMs,
                traceStore: sqliteStore,
                runId,
                taskType: config.taskType,
                docHash,
                segmentId,
                promptHash: promptHash || hashPromptText(input),
                userPrompt: serializePromptForTrace(input),
            });

            try {
                const response = await trackUsageInvoke(client, input, {
                    signal,
                    tracker,
                    onUsage,
                });
                recordModelSuccess(model);
                return response;
            } catch (err) {
                if (isCreditExhaustedError(err)) {
                    creditLatch?.guard?.(err);
                    throw err;
                }
                const failedProvider = err?.actualProvider || err?.response_metadata?.provider || err?.response?.data?.provider;
                if (failedProvider) {
                    ignoredProviders.add(String(failedProvider));
                }
                throw err;
            }
        };

        return poolRegistry.schedule(
            currentPoolKey,
            () => withGeminiRetry(invokeOnce, { ...(retryOptions || {}), signal }),
            { signal },
        );
    }

    async function invokeTask(taskType, input, options = {}) {
        creditLatch?.assertNotTripped?.();
        const config = resolveTaskConfig(taskType, options);
        const ignoredProviders = new Set(options.ignoreProviders || []);
        const {
            docHash = null,
            segmentId = null,
            promptHash = null,
            tracker = null,
            onUsage = null,
            signal = null,
            retryOptions = null,
            allowModelFallback = true,
        } = options;

        try {
            return await invokeSingleModel({
                config,
                model: config.model,
                provider: config.provider,
                input,
                ignoredProviders,
                docHash,
                segmentId,
                promptHash,
                tracker,
                onUsage,
                signal,
                retryOptions,
            });
        } catch (err) {
            if (signal?.aborted || isCreditExhaustedError(err)) {
                throw err;
            }
            recordModelFailure(config.model);

            if (allowModelFallback && config.fallbackModel && config.fallbackModel !== config.model) {
                logger.agent.warn(
                    `[TaskRouter] ${taskType} primary ${config.model} failed (${err.message}); falling back to ${config.fallbackModel}.`,
                );
                return invokeSingleModel({
                    config,
                    model: config.fallbackModel,
                    provider: config.fallbackProvider,
                    input,
                    ignoredProviders,
                    docHash,
                    segmentId,
                    promptHash,
                    tracker,
                    onUsage,
                    signal,
                    retryOptions,
                });
            }
            throw err;
        }
    }

    return {
        resolveTaskConfig,
        invokeTask,
        isZAiCircuitOpen,
        getConsecutiveZAiFailures: () => consecutiveZAiFailures,
        resetCircuitBreaker: () => {
            consecutiveZAiFailures = 0;
        },
        getPoolStats: () => poolRegistry.stats(),
    };
}

module.exports = {
    Z_AI_PRIMARY_MODEL,
    GEMMA_RASTER_MODEL,
    GEMINI_FLASH_MODEL,
    Z_AI_PROVIDER_PREF,
    GEMMA_PROVIDER_PREF,
    GEMINI_PROVIDER_PREF,
    TASK_ROUTES,
    buildProviderPreferenceWithIgnore,
    createTaskRouter,
};
