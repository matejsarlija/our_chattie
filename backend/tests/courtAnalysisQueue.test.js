const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { createSqliteStore } = require('../services/sqliteStore');
const { createRunAbortRegistry } = require('../http/runAbortRegistry');
const { createRunBus } = require('../http/runBus');
const { createCourtAnalysisRouter } = require('../routes/courtAnalysis');
const { createAnalysisRunsRouter } = require('../routes/analysisRuns');

jest.mock('../court-analysis/pipeline', () => ({ runCourtAnalysis: jest.fn() }));
const { runCourtAnalysis } = require('../court-analysis/pipeline');

const pass = (req, res, next) => next();

describe('queued court analysis API', () => {
  let dataDir;
  let analysisStore;
  let runAbortRegistry;
  let runBus;
  let queue;
  let queuedTask;
  let app;

  beforeEach(() => {
    runCourtAnalysis.mockReset();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'court-analysis-queue-'));
    analysisStore = createSqliteStore({ dataDir });
    runAbortRegistry = createRunAbortRegistry();
    runBus = createRunBus({ analysisStore });
    queue = { add: jest.fn((task) => { queuedTask = task; return Promise.resolve(); }) };
    app = express();
    app.use(express.json());
    app.use('/api/court-analysis', createCourtAnalysisRouter({
      analysisStore, courtAnalysisQueue: queue, writeLimiter: pass, runAbortRegistry, runBus,
    }));
    app.use('/api/analysis', createAnalysisRunsRouter({
      analysisStore, readLimiter: pass, writeLimiter: pass, runAbortRegistry, runBus,
    }));
  });

  afterEach(() => {
    analysisStore?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('returns 202 with a queued run before worker execution', async () => {
    const response = await request(app).post('/api/court-analysis').send({ query: { type: 'case_number', value: 'St-2/2013' } });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ analysisId: expect.any(String), status: 'queued' });
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queuedTask).toEqual(expect.any(Function));
    expect((await analysisStore.getAnalysisRun({ id: response.body.analysisId })).status).toBe('queued');
    expect(runAbortRegistry.get(response.body.analysisId)?.signal.aborted).toBe(false);
  });

  test('runs the queued worker and publishes a terminal event on completion', async () => {
    runCourtAnalysis.mockResolvedValue({ processedCases: [], comparativeAnalysis: 'Analiza završena.' });

    const response = await request(app).post('/api/court-analysis').send({ query: { type: 'case_number', value: 'St-2/2013' } });
    await queuedTask();

    expect(runCourtAnalysis).toHaveBeenCalledWith(
      'St-2/2013',
      expect.objectContaining({ scanDepth: 'balanced', signal: expect.any(AbortSignal) }),
      expect.any(Function),
    );
    expect((await analysisStore.getAnalysisRun({ id: response.body.analysisId })).status).toBe('done');
    expect((await analysisStore.getAnalysisEvents({ analysisId: response.body.analysisId })).at(-1).event_type).toBe('run.terminal');
    expect(runAbortRegistry.get(response.body.analysisId)).toBeNull();
  });


  test('cancels through the abort registry and preserves committed OCR/checkpoint rows', async () => {
    const run = await analysisStore.createAnalysisRun({ status: 'queued' });
    const controller = runAbortRegistry.register(run.id);
    analysisStore.db.prepare(`INSERT INTO ocr_transcripts
      (content_hash, engine, task_type, prompt_version, model_id, page_count, text, created_at)
      VALUES ('hash', 'ocr-engine', 'TranscribePage', 1, 'model', 1, 'cached text', '2026-01-01T00:00:00.000Z')`).run();
    analysisStore.db.prepare(`INSERT INTO segment_checkpoints
      (checkpoint_key, content_hash, segment_id, model_id, prompt_hash, schema_version, parsed_json, created_at)
      VALUES ('checkpoint', 'hash', 'segment-1', 'model', 'prompt', 1, '{}', '2026-01-01T00:00:00.000Z')`).run();

    const response = await request(app).post(`/api/analysis/runs/${run.id}/cancel`).send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ analysisId: run.id, status: 'canceled' });
    expect(controller.signal.aborted).toBe(true);
    expect((await analysisStore.getAnalysisRun({ id: run.id })).status).toBe('canceled');
    expect(analysisStore.db.prepare('SELECT COUNT(*) AS count FROM ocr_transcripts').get().count).toBe(1);
    expect(analysisStore.db.prepare('SELECT COUNT(*) AS count FROM segment_checkpoints').get().count).toBe(1);
    expect((await analysisStore.getAnalysisEvents({ analysisId: run.id })).at(-1).event_type).toBe('run.terminal');
  });
});
