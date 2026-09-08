const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { createLocalStore } = require('../services/localStore');
const { createAnalysisReportRetryHandler } = require('../helpers/analysisReportRetry');

function makeApp(store, regenerate) {
  const app = express();
  app.use(express.json());
  app.post('/api/analysis/runs/:id/report', createAnalysisReportRetryHandler({ store, regenerate }));
  return app;
}

const evidencePackage = { clusterId: 'ST-2/2013', claims: [] };

async function seedReportlessRun(store) {
  const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
  await store.completeAnalysisRun({
    analysisId: run.id,
    resultText: 'fallback',
    resultJson: { comparativeAnalysis: 'fallback', report: null, reportError: 'boom', clusterEvidencePackage: evidencePackage },
  });
  return run;
}

describe('POST /api/analysis/runs/:id/report', () => {
  let dataDir;
  let store;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-retry-'));
    store = createLocalStore({ dataDir });
  });

  afterEach(() => {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (err) {
      // ignore
    }
  });

  test('regenerates the report and merges it into the stored run', async () => {
    const run = await seedReportlessRun(store);
    const report = { findings: [{ claim: 'x' }], timeline: [], conflicts: [] };
    const regenerate = jest.fn().mockResolvedValue(report);
    const app = makeApp(store, regenerate);

    const res = await request(app).post(`/api/analysis/runs/${run.id}/report`);

    expect(res.status).toBe(200);
    expect(regenerate).toHaveBeenCalledWith(evidencePackage, expect.objectContaining({ runId: run.id }));
    expect(res.body.run.result_json.report).toEqual(report);
    expect(res.body.run.result_json.reportError).toBeNull();
    expect(res.body.run.status).toBe('done');

    const events = await store.getAnalysisEvents({ analysisId: run.id });
    expect(events.some((e) => e.event_type === 'report-retry')).toBe(true);
  });

  test('returns 409 while the run is still in flight', async () => {
    const running = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408', status: 'running' });
    const regenerate = jest.fn();
    const app = makeApp(store, regenerate);

    const res = await request(app).post(`/api/analysis/runs/${running.id}/report`);

    expect(res.status).toBe(409);
    expect(regenerate).not.toHaveBeenCalled();
  });

  test('returns 404 for unknown run', async () => {
    const app = makeApp(store, jest.fn());
    const res = await request(app).post('/api/analysis/runs/missing/report');
    expect(res.status).toBe(404);
  });

  test('returns 409 when a report already exists', async () => {
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    await store.completeAnalysisRun({
      analysisId: run.id,
      resultText: 'full',
      resultJson: { comparativeAnalysis: 'full', report: { findings: [] }, clusterEvidencePackage: evidencePackage },
    });
    const regenerate = jest.fn();
    const app = makeApp(store, regenerate);

    const res = await request(app).post(`/api/analysis/runs/${run.id}/report`);

    expect(res.status).toBe(409);
    expect(regenerate).not.toHaveBeenCalled();
  });

  test('returns 409 when no evidence package is stored', async () => {
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    await store.completeAnalysisRun({
      analysisId: run.id,
      resultText: 'fallback',
      resultJson: { comparativeAnalysis: 'fallback', report: null },
    });
    const regenerate = jest.fn();
    const app = makeApp(store, regenerate);

    const res = await request(app).post(`/api/analysis/runs/${run.id}/report`);

    expect(res.status).toBe(409);
    expect(regenerate).not.toHaveBeenCalled();
  });

  test('persists the new reportError and returns 500 when regeneration fails', async () => {
    const run = await seedReportlessRun(store);
    const regenerate = jest.fn().mockRejectedValue(new Error('Gemini request timed out after 120000ms'));
    const app = makeApp(store, regenerate);

    const res = await request(app).post(`/api/analysis/runs/${run.id}/report`);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/nije uspjela/i);
    const reloaded = await store.getAnalysisRun({ id: run.id });
    expect(reloaded.status).toBe('done');
    expect(reloaded.result_json.report).toBeNull();
    expect(String(reloaded.result_json.reportError)).toMatch(/timed out|čekanja/i);
  });
});
