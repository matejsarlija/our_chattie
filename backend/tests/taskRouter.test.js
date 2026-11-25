'use strict';

const {
    createTaskRouter,
    Z_AI_PRIMARY_MODEL,
    GEMINI_FLASH_MODEL,
    GEMMA_RASTER_MODEL,
} = require('../llm/taskRouter');
const { createProviderPoolRegistry } = require('../llm/providerPool');
const { createCreditExhaustedLatch } = require('../llm/creditLatch');

describe('TaskRouter', () => {
    test('resolves configuration across all pipeline Task types with provider preferences', () => {
        const router = createTaskRouter();
        expect(router.resolveTaskConfig('ExtractDoc')).toMatchObject({
            model: Z_AI_PRIMARY_MODEL,
            poolKey: 'openrouter:z-ai',
            provider: expect.objectContaining({
                order: ['Z.AI', 'Novita', 'DeepInfra'],
                quantizations: ['bf16', 'fp16', 'fp8'],
                require_parameters: true,
                data_collection: 'deny',
            }),
        });
        expect(router.resolveTaskConfig('TranscribePage').model).toBe(GEMMA_RASTER_MODEL);
        expect(router.resolveTaskConfig('VerifyExtraction').model).toBe(GEMMA_RASTER_MODEL);
        expect(router.resolveTaskConfig('ClassifyRelevance').model).toBe(GEMMA_RASTER_MODEL);
        expect(router.resolveTaskConfig('EvaluateAnswer').model).toBe(GEMMA_RASTER_MODEL);
        expect(router.resolveTaskConfig('SynthesizeCase').model).toBe(GEMINI_FLASH_MODEL);
        expect(router.resolveTaskConfig('VerifyReport').model).toBe(GEMINI_FLASH_MODEL);
    });

    test('rotates failing provider into provider.ignore before retrying', async () => {
        const calls = [];
        const router = createTaskRouter({
            poolRegistry: createProviderPoolRegistry(),
            clientFactory: ({ model, provider }) => {
                calls.push({ model, provider });
                return {
                    invoke: async () => {
                        if (calls.length === 1) {
                            const err = new Error('OpenRouter request failed (503): overloaded');
                            err.status = 503;
                            err.actualProvider = 'Z.AI';
                            throw err;
                        }
                        return {
                            content: '{"ok":true}',
                            usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
                            response_metadata: { model, provider: 'Novita', finish_reason: 'stop' },
                        };
                    },
                };
            },
        });

        const res = await router.invokeTask('ExtractDoc', 'test doc', {
            retryOptions: { maxRetries: 1, onRetry: () => {} },
            allowModelFallback: false,
        });
        expect(res.content).toBe('{"ok":true}');
        expect(calls).toHaveLength(2);
        expect(calls[0].provider.order).toEqual(['Z.AI', 'Novita', 'DeepInfra']);
        expect(calls[1].provider.ignore).toEqual(['Z.AI']);
        expect(calls[1].provider.order).toEqual(['Novita', 'DeepInfra']);
    });

    test('trips z-ai circuit breaker after 5 consecutive failures and routes ExtractDoc to gemini-2.5-flash', async () => {
        const seenModels = [];
        const router = createTaskRouter({
            zAiCircuitThreshold: 5,
            clientFactory: ({ model }) => {
                seenModels.push(model);
                return {
                    invoke: async () => {
                        if (model === Z_AI_PRIMARY_MODEL) {
                            const err = new Error('Hard 400 schema failure');
                            err.status = 400;
                            throw err;
                        }
                        return {
                            content: '{"fallback":true}',
                            usage_metadata: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
                            response_metadata: { model, provider: 'Google AI Studio', finish_reason: 'stop' },
                        };
                    },
                };
            },
        });

        for (let i = 0; i < 5; i += 1) {
            const res = await router.invokeTask('ExtractDoc', `doc-${i}`);
            expect(res.content).toBe('{"fallback":true}');
        }

        expect(router.isZAiCircuitOpen()).toBe(true);
        const beforeCount = seenModels.filter((m) => m === Z_AI_PRIMARY_MODEL).length;

        const circuitRouted = await router.invokeTask('ExtractDoc', 'doc-after');
        expect(circuitRouted.content).toBe('{"fallback":true}');
        expect(seenModels.filter((m) => m === Z_AI_PRIMARY_MODEL).length).toBe(beforeCount);
    });

    test('trips HTTP 402 CreditExhaustedLatch with zero retries and zero model fallback', async () => {
        const latch = createCreditExhaustedLatch();
        let invocations = 0;
        const router = createTaskRouter({
            creditLatch: latch,
            clientFactory: () => ({
                invoke: async () => {
                    invocations += 1;
                    const err = new Error('Insufficient credits');
                    err.status = 402;
                    throw err;
                },
            }),
        });

        await expect(router.invokeTask('ExtractDoc', 'doc-1')).rejects.toThrow(/Insufficient credits/i);
        expect(invocations).toBe(1);
        expect(latch.isTripped()).toBe(true);

        await expect(router.invokeTask('SynthesizeCase', 'doc-2')).rejects.toThrow(/credits exhausted/i);
        expect(invocations).toBe(1);
    });
});
