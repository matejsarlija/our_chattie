const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createRunAbortRegistry } = require('../http/runAbortRegistry');
const { recoverServerState, sweepOrphanedUploads, installShutdownHandlers } = require('../http/serverLifecycle');

describe('server recovery lifecycle', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lifecycle-'));
  });

  afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  test('sweeps transient uploads without entering or changing the download cache', () => {
    const cacheDir = path.join(tempDir, '.dl-cache');
    fs.mkdirSync(path.join(cacheDir, 'blobs'), { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'blobs', 'keep.bin'), 'cached');
    fs.writeFileSync(path.join(tempDir, 'orphan.tmp'), 'temporary');
    fs.mkdirSync(path.join(tempDir, 'orphan-dir'));

    expect(sweepOrphanedUploads(tempDir)).toBe(2);
    expect(fs.readdirSync(tempDir)).toEqual(['.dl-cache']);
    expect(fs.readFileSync(path.join(cacheDir, 'blobs', 'keep.bin'), 'utf8')).toBe('cached');
  });

  test('marks stale runs interrupted before sweeping uploads', () => {
    const analysisStore = { markStaleRunsInterrupted: jest.fn(() => 3) };
    const result = recoverServerState({ analysisStore, uploadsDir: path.join(tempDir, 'uploads') });
    expect(result).toEqual({ interruptedRuns: 3, removedUploadEntries: 0 });
    expect(analysisStore.markStaleRunsInterrupted).toHaveBeenCalledTimes(1);
  });

  test('aborts registered runs and drains server and queue before closing SQLite', async () => {
    const registry = createRunAbortRegistry();
    const controller = registry.register('run-1');
    const processRef = new EventEmitter();
    let finishServerClose;
    const server = {
      listening: true,
      close: jest.fn((callback) => { finishServerClose = callback; }),
    };
    let finishQueue;
    const queue = { onIdle: jest.fn(() => new Promise((resolve) => { finishQueue = resolve; })) };
    const analysisStore = {
      markRunsInterrupted: jest.fn(),
      close: jest.fn(),
    };
    const lifecycle = installShutdownHandlers({ server, queue, runAbortRegistry: registry, analysisStore, processRef });

    const shutdown = lifecycle.shutdown('SIGTERM');
    expect(controller.signal.aborted).toBe(true);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(queue.onIdle).toHaveBeenCalledTimes(1);
    finishQueue();
    finishServerClose();
    await shutdown;

    expect(analysisStore.markRunsInterrupted).toHaveBeenCalledWith(['run-1']);
    expect(analysisStore.close).toHaveBeenCalledTimes(1);
    lifecycle.removeHandlers();
  });
});
