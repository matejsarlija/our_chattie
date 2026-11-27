'use strict';

const DEFAULT_POOL_LIMITS = Object.freeze({
    'openrouter:z-ai': 10,
    'openrouter:mistral-ocr': 3,
    'openrouter:gemma': 4,
    'openrouter:gemini': 4,
    'openrouter:default': 4,
});

function resolveEnvPoolLimit(poolKey, fallbackLimit) {
    const envNameMap = {
        'openrouter:z-ai': 'OPENROUTER_POOL_Z_AI',
        'openrouter:mistral-ocr': 'OPENROUTER_POOL_MISTRAL_OCR',
        'openrouter:gemma': 'OPENROUTER_POOL_GEMMA',
        'openrouter:gemini': 'OPENROUTER_POOL_GEMINI',
    };
    const envVar = envNameMap[poolKey];
    if (envVar && process.env[envVar]) {
        const parsed = Number.parseInt(process.env[envVar], 10);
        if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 32) {
            return parsed;
        }
    }
    return fallbackLimit;
}

function poolKeyForModel(modelId, plugins = null) {
    const hasMistralPlugin = Array.isArray(plugins) && plugins.some(
        (p) => p?.id === 'file-parser' && p?.pdf?.engine === 'mistral-ocr',
    );
    if (hasMistralPlugin) return 'openrouter:mistral-ocr';
    const normalized = String(modelId || '').toLowerCase();
    if (normalized.startsWith('z-ai/')) return 'openrouter:z-ai';
    if (normalized.startsWith('google/gemma')) return 'openrouter:gemma';
    if (normalized.startsWith('google/gemini')) return 'openrouter:gemini';
    return 'openrouter:default';
}

function createAbortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    const msg = typeof signal?.reason === 'string' && signal.reason ? signal.reason : 'Operation aborted.';
    return Object.assign(new Error(msg), { name: 'AbortError' });
}

function createProviderPoolRegistry({ limits = {} } = {}) {
    const lanes = new Map();

    function getLimit(poolKey) {
        const explicit = limits[poolKey];
        if (Number.isFinite(explicit) && explicit >= 1) return Math.floor(explicit);
        const fallback = DEFAULT_POOL_LIMITS[poolKey] || DEFAULT_POOL_LIMITS['openrouter:default'];
        return resolveEnvPoolLimit(poolKey, fallback);
    }

    function getLane(poolKey) {
        const key = poolKey || 'openrouter:default';
        if (!lanes.has(key)) {
            lanes.set(key, {
                limit: getLimit(key),
                active: 0,
                maxObservedActive: 0,
                completed: 0,
                failed: 0,
                aborted: 0,
                queue: [],
            });
        }
        return lanes.get(key);
    }

    function pump(lane) {
        while (lane.active < lane.limit && lane.queue.length > 0) {
            const item = lane.queue.shift();
            if (item.settled) continue;
            if (item.signal?.aborted) {
                item.cleanup();
                item.settled = true;
                lane.aborted += 1;
                item.reject(createAbortError(item.signal));
                continue;
            }
            item.cleanup();
            lane.active += 1;
            if (lane.active > lane.maxObservedActive) {
                lane.maxObservedActive = lane.active;
            }
            Promise.resolve()
                .then(() => item.fn())
                .then(
                    (value) => {
                        lane.completed += 1;
                        item.settled = true;
                        item.resolve(value);
                    },
                    (err) => {
                        lane.failed += 1;
                        item.settled = true;
                        item.reject(err);
                    },
                )
                .finally(() => {
                    lane.active -= 1;
                    pump(lane);
                });
        }
    }

    function schedule(poolKey, fn, { signal } = {}) {
        if (typeof fn !== 'function') {
            return Promise.reject(new TypeError('ProviderPoolRegistry.schedule requires a function.'));
        }
        if (signal?.aborted) {
            return Promise.reject(createAbortError(signal));
        }

        const lane = getLane(poolKey);
        return new Promise((resolve, reject) => {
            const entry = {
                fn,
                signal: signal || null,
                resolve,
                reject,
                settled: false,
                cleanup: () => {},
            };

            if (signal) {
                const onAbort = () => {
                    if (entry.settled) return;
                    entry.settled = true;
                    const idx = lane.queue.indexOf(entry);
                    if (idx !== -1) lane.queue.splice(idx, 1);
                    lane.aborted += 1;
                    reject(createAbortError(signal));
                };
                signal.addEventListener('abort', onAbort, { once: true });
                entry.cleanup = () => signal.removeEventListener('abort', onAbort);
            }

            lane.queue.push(entry);
            pump(lane);
        });
    }

    function stats() {
        const snapshot = {};
        for (const [key, lane] of lanes.entries()) {
            snapshot[key] = {
                limit: lane.limit,
                active: lane.active,
                queued: lane.queue.length,
                maxObservedActive: lane.maxObservedActive,
                completed: lane.completed,
                failed: lane.failed,
                aborted: lane.aborted,
            };
        }
        return snapshot;
    }

    return {
        schedule,
        poolKeyForModel,
        inFlight: (poolKey) => getLane(poolKey).active,
        queued: (poolKey) => getLane(poolKey).queue.length,
        getLimit,
        stats,
    };
}

let sharedRegistry = null;

function getSharedProviderPoolRegistry() {
    if (!sharedRegistry) {
        sharedRegistry = createProviderPoolRegistry();
    }
    return sharedRegistry;
}

module.exports = {
    DEFAULT_POOL_LIMITS,
    poolKeyForModel,
    createProviderPoolRegistry,
    getSharedProviderPoolRegistry,
};
