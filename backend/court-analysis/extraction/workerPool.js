'use strict';

const os = require('node:os');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const {
    inspectPdfBuffer,
    renderPdfPagesToJpegBuffers,
    isPdfJsMocked,
    isCanvasMocked,
} = require('./pdfText');

function resolvePoolSize(requestedSize) {
    const envSize = Number.parseInt(process.env.EXTRACTION_WORKER_POOL_SIZE, 10);
    const raw = Number.isFinite(requestedSize)
        ? requestedSize
        : (Number.isFinite(envSize) ? envSize : Math.min(4, Math.max(2, os.cpus().length || 2)));
    return Math.min(4, Math.max(2, Math.floor(raw)));
}

async function executeTaskLocally(type, payload) {
    if (type === 'inspectPdf') {
        return inspectPdfBuffer(payload.bytes);
    }
    if (type === 'renderPdfPages') {
        return renderPdfPagesToJpegBuffers(payload.bytes, payload.pageNumbers);
    }
    throw new Error(`Unknown extraction worker task: ${type}`);
}

if (!isMainThread) {
    parentPort.on('message', async ({ taskId, type, payload }) => {
        try {
            const result = await executeTaskLocally(type, payload);
            if (payload && typeof payload === 'object') {
                payload.bytes = null;
            }
            parentPort.postMessage({ taskId, ok: true, result });
        } catch (error) {
            if (payload && typeof payload === 'object') {
                payload.bytes = null;
            }
            parentPort.postMessage({
                taskId,
                ok: false,
                error: error?.message || String(error),
            });
        }
    });
} else {
    function createWorkerPool(options = {}) {
        const size = resolvePoolSize(options.size);
        const workers = [];
        const queue = [];
        let nextTaskId = 1;
        let destroyed = false;

        function ensureWorkerSlot() {
            if (workers.length >= size || destroyed) return null;
            const worker = new Worker(__filename);
            worker.unref();
            const slot = { worker, busy: false, currentTask: null };
            worker.on('message', (msg) => {
                const current = slot.currentTask;
                if (!current || current.taskId !== msg.taskId) return;
                slot.currentTask = null;
                slot.busy = false;
                slot.worker.unref();
                if (msg.ok) current.resolve(msg.result);
                else current.reject(new Error(msg.error || 'Extraction worker failed'));
                pump();
            });
            worker.on('error', (error) => {
                const current = slot.currentTask;
                slot.currentTask = null;
                slot.busy = false;
                const idx = workers.indexOf(slot);
                if (idx >= 0) workers.splice(idx, 1);
                if (current) current.reject(error);
                pump();
            });
            worker.on('exit', (code) => {
                const current = slot.currentTask;
                slot.currentTask = null;
                slot.busy = false;
                const idx = workers.indexOf(slot);
                if (idx >= 0) workers.splice(idx, 1);
                if (current) current.reject(new Error(`Extraction worker exited with code ${code}`));
                pump();
            });
            workers.push(slot);
            return slot;
        }

        function pump() {
            if (destroyed) return;
            while (queue.length > 0) {
                const nextItem = queue[0];
                if (nextItem.signal?.aborted) {
                    queue.shift();
                    nextItem.reject(nextItem.signal.reason || Object.assign(new Error('Worker task aborted.'), { name: 'AbortError' }));
                    continue;
                }
                let idleSlot = workers.find((slot) => !slot.busy);
                if (!idleSlot && workers.length < size) {
                    idleSlot = ensureWorkerSlot();
                }
                if (!idleSlot) break;

                queue.shift();
                const { taskId, type, payload, resolve, reject } = nextItem;
                idleSlot.busy = true;
                idleSlot.currentTask = { taskId, resolve, reject };
                idleSlot.worker.ref();
                idleSlot.worker.postMessage({ taskId, type, payload });
            }
        }

        async function run(type, payload, { signal } = {}) {
            if (destroyed) throw new Error('Worker pool has been destroyed.');
            if (signal?.aborted) {
                throw signal.reason || Object.assign(new Error('Worker task aborted.'), { name: 'AbortError' });
            }
            const shouldUseLocalMocks = (type === 'inspectPdf' && isPdfJsMocked())
                || (type === 'renderPdfPages' && (isPdfJsMocked() || isCanvasMocked()));
            if (shouldUseLocalMocks) {
                return executeTaskLocally(type, payload);
            }

            return new Promise((resolve, reject) => {
                const taskId = nextTaskId++;
                queue.push({ taskId, type, payload, resolve, reject, signal });
                pump();
            });
        }

        async function destroy() {
            destroyed = true;
            while (queue.length > 0) {
                const pending = queue.shift();
                pending.reject(new Error('Worker pool destroyed before task executed.'));
            }
            const currentSlots = workers.splice(0, workers.length);
            await Promise.all(currentSlots.map(async (slot) => {
                if (slot.currentTask) {
                    slot.currentTask.reject(new Error('Worker pool destroyed while task was running.'));
                    slot.currentTask = null;
                }
                try {
                    await slot.worker.terminate();
                } catch {
                    // Already exited.
                }
            }));
        }

        return {
            size,
            run,
            destroy,
            activeCount: () => workers.filter((slot) => slot.busy).length,
            workerCount: () => workers.length,
        };
    }

    let sharedPool = null;

    function getSharedWorkerPool(options = {}) {
        if (!sharedPool) {
            sharedPool = createWorkerPool(options);
        }
        return sharedPool;
    }

    async function destroySharedWorkerPool() {
        if (!sharedPool) return;
        const pool = sharedPool;
        sharedPool = null;
        await pool.destroy();
    }

    module.exports = {
        createWorkerPool,
        getSharedWorkerPool,
        destroySharedWorkerPool,
        resolvePoolSize,
        executeTaskLocally,
    };
}
