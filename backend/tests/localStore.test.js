const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalStore } = require('../services/localStore');

function makeStore() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-store-'));
  const store = createLocalStore({ dataDir });
  return { store, dataDir };
}

describe('localStore.createAnalysisRun', () => {
  test('persists typed query fields', async () => {
    const { store, dataDir } = makeStore();

    const run = await store.createAnalysisRun({
      oib: '66124057408',
      queryType: 'oib',
      queryValue: '66124057408',
      status: 'running',
    });

    expect(run).toMatchObject({
      oib: '66124057408',
      query_type: 'oib',
      query_value: '66124057408',
      status: 'running',
      result_format: 'markdown',
    });
    expect(run.id).toBeDefined();
    expect(run.created_at).toBeDefined();

    const runsFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'runs.json'), 'utf8'));
    expect(runsFile).toHaveLength(1);
    expect(runsFile[0].query_type).toBe('oib');
  });

  test('creates empty events bucket for the run', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: 'ST-357/2013', queryType: 'case_number', queryValue: 'ST-357/2013' });

    const events = await store.getAnalysisEvents({ analysisId: run.id });
    expect(events).toEqual([]);
  });
});

describe('localStore.appendAnalysisEvent', () => {
  test('appends events in order and stamps fields', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });

    await store.appendAnalysisEvent({ analysisId: run.id, eventType: 'starting', message: 'start', metadata: { progress: 5 } });
    await store.appendAnalysisEvent({ analysisId: run.id, eventType: 'reasoning', message: 'thinking', metadata: { progress: 50 } });

    const events = await store.getAnalysisEvents({ analysisId: run.id });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ analysis_id: run.id, event_type: 'starting', message: 'start', metadata: { progress: 5 } });
    expect(events[1]).toMatchObject({ event_type: 'reasoning', message: 'thinking' });
    expect(events[0].id).toBeDefined();
    expect(events[0].created_at).toBeDefined();
  });

  test('throws for unknown run', async () => {
    const { store } = makeStore();
    await expect(
      store.appendAnalysisEvent({ analysisId: 'missing', eventType: 'starting', message: 'x' }),
    ).rejects.toThrow('Analysis run not found');
  });
});

describe('localStore.completeAnalysisRun', () => {
  test('persists markdown and structured result_json on completion', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });

    const resultJson = {
      comparativeAnalysis: 'Sažetak',
      report: { findings: [] },
      processedCases: [],
    };

    const completed = await store.completeAnalysisRun({ analysisId: run.id, resultText: 'Sažetak', resultJson });

    expect(completed).toMatchObject({
      id: run.id,
      status: 'done',
      result_text: 'Sažetak',
      result_format: 'markdown',
    });
    expect(completed.result_json).toEqual(resultJson);
    expect(completed.completed_at).toBeDefined();

    const reloaded = await store.getAnalysisRun({ id: run.id });
    expect(reloaded.status).toBe('done');
    expect(reloaded.result_json).toEqual(resultJson);
  });

  test('persists completion without result_json when not provided', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });

    const completed = await store.completeAnalysisRun({ analysisId: run.id, resultText: 'Sažetak' });

    expect(completed.status).toBe('done');
    expect(completed.result_json).toBeNull();
  });
});

describe('localStore.failAnalysisRun', () => {
  test('marks run as error with message', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });

    const failed = await store.failAnalysisRun({ analysisId: run.id, errorMessage: 'boom' });

    expect(failed).toMatchObject({ id: run.id, status: 'error', error: 'boom' });
    expect(failed.completed_at).toBeDefined();
  });

  test('persists partial result_json and result_text when provided', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });

    const partialResultJson = {
      discoverySummary: { reasoningClusterId: 'ST-2/2013', capturedDistinctCaseCount: 1 },
      report: null
    };
    const failed = await store.failAnalysisRun({
      analysisId: run.id,
      errorMessage: 'Analiza nije uspjela.',
      resultJson: partialResultJson,
      resultText: 'Djelomični nalaz',
    });

    expect(failed.status).toBe('error');
    expect(failed.error).toBe('Analiza nije uspjela.');
    expect(failed.result_json).toEqual(partialResultJson);
    expect(failed.result_text).toBe('Djelomični nalaz');

    const reloaded = await store.getAnalysisRun({ id: run.id });
    expect(reloaded.result_json.discoverySummary.capturedDistinctCaseCount).toBe(1);
    expect(reloaded.result_text).toBe('Djelomični nalaz');
  });
});

describe('localStore.listAnalysisRuns', () => {
  test('returns newest first with count and pagination', async () => {
    const { store } = makeStore();
    const r1 = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    const r2 = await store.createAnalysisRun({ oib: 'ST-357/2013', queryType: 'case_number', queryValue: 'ST-357/2013' });

    const page = await store.listAnalysisRuns({ limit: 10, offset: 0 });

    expect(page.count).toBe(2);
    expect(page.data.map((r) => r.id)).toEqual([r2.id, r1.id]);
  });

  test('honors limit and offset', async () => {
    const { store } = makeStore();
    await store.createAnalysisRun({ oib: 'a', queryType: 'text', queryValue: 'a' });
    await store.createAnalysisRun({ oib: 'b', queryType: 'text', queryValue: 'b' });
    await store.createAnalysisRun({ oib: 'c', queryType: 'text', queryValue: 'c' });

    const page = await store.listAnalysisRuns({ limit: 2, offset: 0 });
    expect(page.count).toBe(3);
    expect(page.data).toHaveLength(2);

    const page2 = await store.listAnalysisRuns({ limit: 2, offset: 2 });
    expect(page2.data).toHaveLength(1);
  });

  test('returns empty list for fresh store', async () => {
    const { store } = makeStore();
    const page = await store.listAnalysisRuns({ limit: 10, offset: 0 });
    expect(page).toEqual({ data: [], count: 0 });
  });
});

describe('localStore.getAnalysisRun / getAnalysisRunFull', () => {
  test('throws for unknown run', async () => {
    const { store } = makeStore();
    await expect(store.getAnalysisRun({ id: 'missing' })).rejects.toThrow('Analysis run not found');
  });

  test('returns run and events together', async () => {
    const { store } = makeStore();
    const run = await store.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    await store.appendAnalysisEvent({ analysisId: run.id, eventType: 'starting', message: 'start', metadata: {} });

    const full = await store.getAnalysisRunFull({ id: run.id });
    expect(full.run.id).toBe(run.id);
    expect(full.events).toHaveLength(1);
  });
});

describe('localStore persistence across instances', () => {
  test('data written by one instance is readable by another', async () => {
    const { dataDir } = makeStore();
    const storeA = createLocalStore({ dataDir });
    const run = await storeA.createAnalysisRun({ oib: '66124057408', queryType: 'oib', queryValue: '66124057408' });
    await storeA.appendAnalysisEvent({ analysisId: run.id, eventType: 'starting', message: 'start', metadata: {} });

    const storeB = createLocalStore({ dataDir });
    const full = await storeB.getAnalysisRunFull({ id: run.id });
    expect(full.run.id).toBe(run.id);
    expect(full.events).toHaveLength(1);
  });
});
