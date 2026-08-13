const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const request = require('supertest');
const express = require('express');
const { createLocalStore } = require('../services/localStore');
const { parsePagination } = require('../helpers/pagination');
const { buildSseEvent } = require('../helpers/sse');
const { createAnalysisRunStreamHandler } = require('../helpers/analysisStreamHandler');
const { isTerminalStatus, buildCursor, didRunChange, getNewEvents, shouldStartStreamTimers } = require('../helpers/analysisStream');

function makeApp(store) {
  const app = express();
  app.use(express.json());

  app.get('/api/analysis/runs', async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const result = await store.listAnalysisRuns({ limit, offset });
      res.json({ runs: result.data, count: result.count, limit, offset });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load analysis runs.' });
    }
  });

  app.get('/api/analysis/runs/:id/full', async (req, res) => {
    try {
      const result = await store.getAnalysisRunFull({ id: req.params.id });
      res.json({ run: result.run, events: result.events, server_time: new Date().toISOString() });
    } catch (error) {
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  app.get('/api/analysis/runs/:id/events', async (req, res) => {
    try {
      const events = await store.getAnalysisEvents({ analysisId: req.params.id });
      res.json({ events });
    } catch (error) {
      res.status(404).json({ error: 'Analysis events not found.' });
    }
  });

  const streamHandler = createAnalysisRunStreamHandler({
    getAnalysisRunFull: store.getAnalysisRunFull,
    buildSseEvent,
    isTerminalStatus,
    buildCursor,
    didRunChange,
    getNewEvents,
    shouldStartStreamTimers,
    streamPollMs: 10,
    heartbeatMs: 1000,
  });
  app.get('/api/analysis/runs/:id/stream', streamHandler);

  return app;
}

describe('analysis runs API (local store)', () => {
  let dataDir;
  let store;
  let app;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-api-'));
    store = createLocalStore({ dataDir });
    app = makeApp(store);

    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    await store.appendAnalysisEvent({ analysisId: run.id, eventType: 'starting', message: 'start', metadata: { progress: 5 } });
    await store.completeAnalysisRun({ analysisId: run.id, resultText: 'Sažetak', resultJson: { comparativeAnalysis: 'Sažetak' } });
    store.__runId = run.id;
  });

  afterEach(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (err) {
      // ignore
    }
  });

  test('lists runs without authentication', async () => {
    const res = await request(app).get('/api/analysis/runs?limit=10&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.count).toBe(1);
    expect(res.body.runs[0]).toMatchObject({ oib: '66124057408', query_type: 'oib', status: 'done' });
  });

  test('returns 404 for unknown run full detail', async () => {
    const res = await request(app).get('/api/analysis/runs/unknown/full');
    expect(res.status).toBe(404);
  });

  test('returns run + events shape for existing run full detail', async () => {
    const res = await request(app).get(`/api/analysis/runs/${store.__runId}/full`);
    expect(res.status).toBe(200);
    expect(res.body.run.id).toBe(store.__runId);
    expect(res.body.run.status).toBe('done');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].event_type).toBe('starting');
    expect(res.body.server_time).toBeDefined();
  });

  test('returns events for a run', async () => {
    const res = await request(app).get(`/api/analysis/runs/${store.__runId}/events`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
  });

  test('stream emits terminal immediately for completed run', async () => {
    const res = await request(app)
      .get(`/api/analysis/runs/${store.__runId}/stream`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
      });

    expect(res.status).toBe(200);
    const body = res.body;
    expect(body).toContain('event: snapshot');
    expect(body).toContain('event: terminal');
  });

  test('full detail returns persisted partial result_json + error for a failed run', async () => {
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    const partialResultJson = {
      discoverySummary: { reasoningClusterId: 'ST-2/2013', capturedDistinctCaseCount: 1 },
      primaryCluster: { clusterId: 'ST-2/2013' },
      report: null
    };
    await store.appendAnalysisEvent({
      analysisId: run.id,
      eventType: 'error',
      message: 'Analiza nije uspjela tijekom faze analize.',
      metadata: { partialPayload: true, failedStage: 'reasoning' }
    });
    await store.failAnalysisRun({
      analysisId: run.id,
      errorMessage: 'Analiza nije uspjela tijekom faze analize.',
      resultJson: partialResultJson,
      resultText: null,
    });

    const res = await request(app).get(`/api/analysis/runs/${run.id}/full`);
    expect(res.status).toBe(200);
    expect(res.body.run.status).toBe('error');
    expect(res.body.run.error).toBe('Analiza nije uspjela tijekom faze analize.');
    expect(res.body.run.result_json.discoverySummary.capturedDistinctCaseCount).toBe(1);
    expect(res.body.run.result_json.report).toBeNull();
    expect(res.body.events[0]).toMatchObject({
      event_type: 'error',
      message: 'Analiza nije uspjela tijekom faze analize.',
      metadata: { partialPayload: true, failedStage: 'reasoning' }
    });
  });
});
