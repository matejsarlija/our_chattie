const {
  isTerminalStatus,
  buildCursor,
  didRunChange,
  getNewEvents,
  shouldStartStreamTimers,
} = require('../helpers/analysisStream');

describe('analysisStream helpers', () => {
  test('detects terminal statuses', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
  });

  test('builds event cursor from last event', () => {
    const cursor = buildCursor([
      { id: 'e1', created_at: '2025-01-01T00:00:00.000Z' },
      { id: 'e2', created_at: '2025-01-01T00:01:00.000Z' },
    ]);

    expect(cursor).toBe('2025-01-01T00:01:00.000Z:e2');
    expect(buildCursor([])).toBe(null);
  });

  test('detects relevant run field changes', () => {
    const base = {
      status: 'running',
      updated_at: '2025-01-01T00:00:00.000Z',
      completed_at: null,
      result_text: null,
      error: null,
      token_usage: null,
    };

    expect(didRunChange(base, { ...base })).toBe(false);
    expect(didRunChange(base, { ...base, status: 'done' })).toBe(true);
    expect(didRunChange(base, { ...base, result_text: 'result' })).toBe(true);
  });

  test('detects token_usage changes for live usage updates', () => {
    const base = {
      status: 'running',
      updated_at: '2025-01-01T00:00:00.000Z',
      completed_at: null,
      result_text: null,
      error: null,
      token_usage: null,
    };

    const next = {
      ...base,
      token_usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, calls: 1 },
    };

    expect(didRunChange(base, next)).toBe(true);
    expect(didRunChange(next, { ...next })).toBe(false);
  });

  test('returns only unseen events', () => {
    const previous = [{ id: 'e1' }, { id: 'e2' }];
    const next = [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }];

    expect(getNewEvents(previous, next)).toEqual([{ id: 'e3' }]);
  });

  test('starts stream timers only when connection is open and snapshot was sent', () => {
    expect(shouldStartStreamTimers({
      snapshotSent: true,
      closed: false,
      writableEnded: false,
    })).toBe(true);

    expect(shouldStartStreamTimers({
      snapshotSent: false,
      closed: false,
      writableEnded: false,
    })).toBe(false);

    expect(shouldStartStreamTimers({
      snapshotSent: true,
      closed: true,
      writableEnded: false,
    })).toBe(false);

    expect(shouldStartStreamTimers({
      snapshotSent: true,
      closed: false,
      writableEnded: true,
    })).toBe(false);
  });
});
