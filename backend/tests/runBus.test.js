const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStore } = require('../services/sqliteStore');
const { createRunBus, formatRunEvent, MAX_SSE_FRAME_BYTES } = require('../http/runBus');

describe('runBus', () => {
  let dataDir;
  let store;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-bus-'));
    store = createSqliteStore({ dataDir });
  });

  afterEach(() => {
    store?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('persists lane-scoped deltas under 2 KB and emits one terminal frame', async () => {
    const run = await store.createAnalysisRun({ status: 'queued' });
    const bus = createRunBus({ analysisStore: store });
    const messages = [];
    const unsubscribe = bus.subscribe(run.id, (message) => messages.push(message));

    const progress = await bus.publish({
      runId: run.id,
      eventType: 'downloading',
      message: 'Preuzimanje dokumenata.',
      metadata: { kind: 'stage-counter', done: 2, failed: 1, total: 4, unit: 'datoteka' },
    });
    expect(progress.seq).toBe(1);
    expect(messages[0].event).toBe('stage.progress');
    expect(Buffer.byteLength(messages[0].frame)).toBeLessThan(MAX_SSE_FRAME_BYTES);
    expect(messages[0].payload.lanes.download).toEqual({ done: 2, failed: 1, total: 4, unit: 'datoteka' });
    expect(bus.activeLaneRunCount()).toBe(1);

    const terminal = await bus.publishTerminal(run.id, 'canceled');
    const duplicateTerminal = await bus.publishTerminal(run.id, 'canceled');
    expect(duplicateTerminal.seq).toBe(terminal.seq);
    expect(messages[1].event).toBe('run.terminal');
    expect(bus.activeLaneRunCount()).toBe(0);
    expect((await store.getAnalysisEvents({ analysisId: run.id })).map((event) => event.event_type))
      .toEqual(['downloading', 'run.terminal']);
    expect(await bus.publish({ runId: run.id, eventType: 'late-progress' })).toBeNull();

    unsubscribe();
    expect(formatRunEvent(terminal).event).toBe('run.terminal');
  });
});
