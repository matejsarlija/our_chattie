'use strict';

const {
    createProviderPoolRegistry,
    poolKeyForModel,
} = require('../llm/providerPool');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ProviderPoolRegistry', () => {
    test('maps models and mistral-ocr plugins to the expected pool keys', () => {
        expect(poolKeyForModel('z-ai/glm-5.3-flash')).toBe('openrouter:z-ai');
        expect(poolKeyForModel('google/gemma-4-31b-it')).toBe('openrouter:gemma');
        expect(poolKeyForModel('google/gemini-2.5-flash')).toBe('openrouter:gemini');
        expect(poolKeyForModel('google/gemini-2.5-flash', [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]))
            .toBe('openrouter:mistral-ocr');
        expect(poolKeyForModel('other/model')).toBe('openrouter:default');
    });

    test('bounds concurrent in-flight calls per pool and releases slots after errors', async () => {
        const registry = createProviderPoolRegistry({
            limits: { 'openrouter:z-ai': 2 },
        });
        let current = 0;
        let maxObserved = 0;

        const jobs = Array.from({ length: 6 }, (_, i) =>
            registry.schedule('openrouter:z-ai', async () => {
                current += 1;
                if (current > maxObserved) maxObserved = current;
                await sleep(15);
                current -= 1;
                if (i === 2) throw new Error('transient');
                return i;
            }).catch((err) => err.message),
        );

        const results = await Promise.all(jobs);
        expect(maxObserved).toBeLessThanOrEqual(2);
        expect(results).toEqual([0, 1, 'transient', 3, 4, 5]);
        expect(registry.inFlight('openrouter:z-ai')).toBe(0);
        expect(registry.stats()['openrouter:z-ai']).toMatchObject({
            limit: 2,
            completed: 5,
            failed: 1,
        });
    });

    test('cancels pre-aborted and queued work cleanly via AbortSignal without leaking slots', async () => {
        const registry = createProviderPoolRegistry({
            limits: { 'openrouter:gemma': 1 },
        });

        const preAborted = new AbortController();
        preAborted.abort(new Error('already canceled'));
        await expect(registry.schedule('openrouter:gemma', async () => 'never', { signal: preAborted.signal }))
            .rejects.toThrow('already canceled');

        let releaseBlocker;
        const blocker = registry.schedule('openrouter:gemma', () => new Promise((resolve) => {
            releaseBlocker = resolve;
        }));

        const queuedController = new AbortController();
        const queuedFn = jest.fn(async () => 'should-not-run');
        const queuedPromise = registry.schedule('openrouter:gemma', queuedFn, { signal: queuedController.signal });
        queuedController.abort(new Error('queue canceled'));

        await expect(queuedPromise).rejects.toThrow('queue canceled');
        expect(queuedFn).not.toHaveBeenCalled();

        releaseBlocker('done');
        await expect(blocker).resolves.toBe('done');
        expect(registry.inFlight('openrouter:gemma')).toBe(0);
        expect(registry.queued('openrouter:gemma')).toBe(0);
    });
});
