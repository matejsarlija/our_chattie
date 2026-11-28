'use strict';

const { TASK_ROUTES } = require('../../llm/taskRouter');
const { createProviderPoolRegistry } = require('../../llm/providerPool');

describe('Resilience: OpenRouter Provider Routing & Pool Limits', () => {
    test('ExtractTableChunk prefers Novita/DeepInfra/Z.AI with throughput sort and quantizations guard', () => {
        const cfg = TASK_ROUTES.ExtractTableChunk;
        expect(cfg.model).toBe('z-ai/glm-5.3-flash');
        expect(cfg.provider.order).toEqual(['Novita', 'DeepInfra', 'Z.AI']);
        expect(cfg.provider.sort).toBe('throughput');
        expect(cfg.provider.quantizations).toEqual(['bf16', 'fp16', 'fp8']);
    });

    test('ProviderPoolRegistry bounds openrouter:z-ai concurrency at 10 without dropping tasks', async () => {
        const pool = createProviderPoolRegistry();
        let active = 0;
        let peak = 0;
        const tasks = Array.from({ length: 15 }, (_, i) => pool.schedule('openrouter:z-ai', async () => {
            active += 1;
            peak = Math.max(peak, active);
            await new Promise((r) => setTimeout(r, 5));
            active -= 1;
            return i;
        }));
        const results = await Promise.all(tasks);
        expect(results).toHaveLength(15);
        expect(peak).toBeLessThanOrEqual(10);
    });
});
