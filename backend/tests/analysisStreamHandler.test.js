const EventEmitter = require('events');
const { createAnalysisRunStreamHandler, parseAfterSeq } = require('../http/analysisStreamHandler');

function eventRow(seq, eventType, metadata = {}) {
  return {
    id: `event-${seq}`,
    analysis_id: 'run-1',
    seq,
    event_type: eventType,
    message: `event ${seq}`,
    metadata,
  };
}

describe('analysisRunStreamHandler', () => {
  test('uses numeric afterSeq or Last-Event-ID and rejects invalid cursors', () => {
    expect(parseAfterSeq('7', '3')).toBe(7);
    expect(parseAfterSeq(undefined, '3')).toBe(3);
    expect(parseAfterSeq('bad', undefined)).toBeNull();
  });

  test('replays only events with seq greater than the cursor and closes on terminal', async () => {
    const unsubscribe = jest.fn();
    const listener = jest.fn();
    const runBus = { subscribe: jest.fn((_id, callback) => { listener.mockImplementation(callback); return unsubscribe; }) };
    const req = new EventEmitter();
    req.params = { id: 'run-1' };
    req.query = { afterSeq: '1' };
    req.headers = {};
    req.get = () => undefined;
    const frames = [];
    const res = {
      writableEnded: false,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((frame) => frames.push(frame)),
      end: jest.fn(() => { res.writableEnded = true; }),
      status: jest.fn(() => ({ json: jest.fn() })),
    };
    const handler = createAnalysisRunStreamHandler({
      getAnalysisRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
      getAnalysisEventsAfterSeq: jest.fn().mockResolvedValue([
        eventRow(1, 'starting'),
        eventRow(2, 'downloading', { done: 1, total: 3 }),
        eventRow(3, 'run.terminal', { status: 'done' }),
      ]),
      runBus,
      heartbeatMs: 10_000,
    });

    await handler(req, res);

    expect(frames).toHaveLength(2);
    expect(frames[0]).toContain('id: 2\n');
    expect(frames[1]).toContain('id: 3\n');
    expect(frames[1]).toContain('event: run.terminal');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('buffers live events during replay and drops duplicate sequence numbers', async () => {
    let subscriber;
    const runBus = {
      subscribe: jest.fn((_id, callback) => {
        subscriber = callback;
        return jest.fn();
      }),
    };
    const req = new EventEmitter();
    req.params = { id: 'run-1' };
    req.query = {};
    req.headers = { 'last-event-id': '0' };
    req.get = () => undefined;
    const frames = [];
    const res = {
      writableEnded: false,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((frame) => frames.push(frame)),
      end: jest.fn(() => { res.writableEnded = true; }),
    };
    const live = { event: 'stage.progress', seq: 2, frame: 'id: 2\nevent: stage.progress\ndata: {}\n\n' };
    const handler = createAnalysisRunStreamHandler({
      getAnalysisRun: jest.fn().mockResolvedValue({ id: 'run-1', status: 'running' }),
      getAnalysisEventsAfterSeq: jest.fn(async () => {
        subscriber(live);
        return [eventRow(2, 'downloading', { done: 1, total: 2 })];
      }),
      runBus,
      heartbeatMs: 10_000,
    });

    await handler(req, res);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain('id: 2\n');
    req.emit('close');
  });

  test('emits terminal frame and closes immediately for interrupted run without run.terminal event', async () => {
    const unsubscribe = jest.fn();
    const runBus = { subscribe: jest.fn(() => unsubscribe) };
    const req = new EventEmitter();
    req.params = { id: 'run-int' };
    req.query = {};
    req.headers = {};
    req.get = () => undefined;
    const frames = [];
    const res = {
      writableEnded: false,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((frame) => frames.push(frame)),
      end: jest.fn(() => { res.writableEnded = true; }),
    };
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    try {
      const handler = createAnalysisRunStreamHandler({
        getAnalysisRun: jest.fn().mockResolvedValue({ id: 'run-int', status: 'interrupted' }),
        getAnalysisEventsAfterSeq: jest.fn().mockResolvedValue([
          eventRow(1, 'starting'),
          eventRow(2, 'downloading', { done: 1, total: 5 }),
        ]),
        runBus,
        heartbeatMs: 10_000,
      });

      await handler(req, res);

      expect(frames).toHaveLength(3);
      expect(frames[2]).toContain('id: 3\n');
      expect(frames[2]).toContain('event: run.terminal');
      expect(frames[2]).toContain('"status":"interrupted"');
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).not.toHaveBeenCalled();
    } finally {
      setIntervalSpy.mockRestore();
    }
  });

  test('closes cleanly when reconnecting with afterSeq past an already-terminal run', async () => {
    const unsubscribe = jest.fn();
    const runBus = { subscribe: jest.fn(() => unsubscribe) };
    const req = new EventEmitter();
    req.params = { id: 'run-done' };
    req.query = { afterSeq: '5' };
    req.headers = {};
    req.get = () => undefined;
    const frames = [];
    const res = {
      writableEnded: false,
      setHeader: jest.fn(),
      flushHeaders: jest.fn(),
      write: jest.fn((frame) => frames.push(frame)),
      end: jest.fn(() => { res.writableEnded = true; }),
    };

    const handler = createAnalysisRunStreamHandler({
      getAnalysisRun: jest.fn().mockResolvedValue({ id: 'run-done', status: 'done' }),
      getAnalysisEventsAfterSeq: jest.fn().mockResolvedValue([]),
      runBus,
      heartbeatMs: 10_000,
    });

    await handler(req, res);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain('id: 6\n');
    expect(frames[0]).toContain('event: run.terminal');
    expect(frames[0]).toContain('"status":"done"');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
