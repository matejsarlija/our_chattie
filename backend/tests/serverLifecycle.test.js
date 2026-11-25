const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createRunAbortRegistry } = require('../http/runAbortRegistry');
const { recoverServerState, sweepOrphanedUploads, installShutdownHandlers } = require('../http/serverLifecycle');

const express = require('express');
const request = require('supertest');
const { createSqliteStore } = require('../services/sqliteStore');
const { createRunBus } = require('../http/runBus');
const { createCourtAnalysisRouter } = require('../routes/courtAnalysis');

jest.mock('../court-analysis/pipeline', () => ({ runCourtAnalysis: jest.fn() }));
const { runCourtAnalysis } = require('../court-analysis/pipeline');

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

  test('registers SIGINT handler and triggers graceful shutdown on SIGINT', async () => {
    const registry = createRunAbortRegistry();
    const controller = registry.register('run-sigint');
    const processRef = new EventEmitter();
    const server = { listening: true, close: jest.fn((cb) => cb()) };
    const queue = { onIdle: jest.fn().mockResolvedValue(undefined) };
    const analysisStore = { markRunsInterrupted: jest.fn(), close: jest.fn() };

    const lifecycle = installShutdownHandlers({ server, queue, runAbortRegistry: registry, analysisStore, processRef });
    processRef.emit('SIGINT');

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason?.code).toBe('ERR_SERVER_SHUTDOWN');
    expect(analysisStore.markRunsInterrupted).toHaveBeenCalledWith(['run-sigint']);
    expect(analysisStore.close).toHaveBeenCalledTimes(1);
    lifecycle.removeHandlers();
  });

  test('server shutdown leaves aborted active run as interrupted rather than canceled', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-race-'));
    const analysisStore = createSqliteStore({ dataDir });
    const runAbortRegistry = createRunAbortRegistry();
    const runBus = createRunBus({ analysisStore });
    const processRef = new EventEmitter();
    let queuedTaskPromise;
    const queue = {
      add: jest.fn((fn) => {
        queuedTaskPromise = fn();
        return queuedTaskPromise;
      }),
      onIdle: () => queuedTaskPromise,
    };
    const app = express();
    app.use(express.json());
    app.use('/api/court-analysis', createCourtAnalysisRouter({
      analysisStore,
      courtAnalysisQueue: queue,
      writeLimiter: (_req, _res, next) => next(),
      runAbortRegistry,
      runBus,
    }));

    let resolveStarted;
    const started = new Promise((resolve) => { resolveStarted = resolve; });
    runCourtAnalysis.mockImplementation((_term, opts) => new Promise((_resolve, reject) => {
      resolveStarted();
      opts.signal.addEventListener('abort', () => reject(opts.signal.reason), { once: true });
    }));

    const lifecycle = installShutdownHandlers({
      server: { listening: false, close: jest.fn((cb) => cb()) },
      queue,
      runAbortRegistry,
      analysisStore,
      runBus,
      processRef,
    });

    try {
      const response = await request(app)
        .post('/api/court-analysis')
        .send({ query: { type: 'case_number', value: 'St-2/2013' } });
      const runId = response.body.analysisId;
      await started;

      await lifecycle.shutdown('SIGINT');

      const verifyStore = createSqliteStore({ dataDir });
      try {
        const persisted = await verifyStore.getAnalysisRun({ id: runId });
        const events = await verifyStore.getAnalysisEvents({ analysisId: runId });
        expect(persisted.status).toBe('interrupted');
        expect(events.some((ev) => ev.event_type === 'run.terminal' && ev.metadata?.status === 'canceled')).toBe(false);
      } finally {
        verifyStore.close();
      }
    } finally {
      lifecycle.removeHandlers();
      analysisStore.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
