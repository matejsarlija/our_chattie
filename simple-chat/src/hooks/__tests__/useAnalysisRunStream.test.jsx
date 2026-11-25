/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { useAnalysisRunStream } from '../useAnalysisRunStream';

jest.mock('../../lib/apiClient', () => ({
  resolveApiUrl: (path) => path,
}));

function makeSseStream(chunks) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    getReader: () => ({
      read: jest.fn(async () => {
        if (index >= chunks.length) {
          return { done: true, value: undefined };
        }
        const value = encoder.encode(chunks[index]);
        index += 1;
        return { done: false, value };
      }),
      releaseLock: jest.fn(),
    }),
  };
}

function StreamHarness({ runId, enabled = true, afterSeq = 0, onEventCreated, onTerminal, onError }) {
  useAnalysisRunStream({
    runId,
    enabled,
    afterSeq,
    onEventCreated,
    onTerminal,
    onError,
  });
  return null;
}

describe('useAnalysisRunStream', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('tracks highest received seq and passes ?afterSeq= on reconnect, resetting per runId', async () => {
    const firstStream = makeSseStream([
      'id: 4\nevent: stage.progress\ndata: {"runId":"r1","seq":4,"event":{"id":"ev-4","seq":4,"event_type":"downloading"}}\n\n',
    ]);
    const secondStream = makeSseStream([
      'id: 5\nevent: run.terminal\ndata: {"runId":"r1","seq":5,"status":"done","run":{"id":"r1","status":"done"}}\n\n',
    ]);
    const thirdStream = makeSseStream([
      'id: 1\nevent: run.terminal\ndata: {"runId":"r2","seq":1,"status":"done","run":{"id":"r2","status":"done"}}\n\n',
    ]);

    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, body: firstStream })
      .mockResolvedValueOnce({ ok: true, status: 200, body: secondStream })
      .mockResolvedValueOnce({ ok: true, status: 200, body: thirdStream });

    const onEventCreated = jest.fn();
    const onTerminal = jest.fn();
    const onError = jest.fn();

    const { rerender } = render(
      <StreamHarness
        runId="r1"
        enabled
        onEventCreated={onEventCreated}
        onTerminal={onTerminal}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(onEventCreated).toHaveBeenCalledWith({
        event: { id: 'ev-4', seq: 4, event_type: 'downloading' },
      });
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      '/api/analysis/runs/r1/stream',
      expect.objectContaining({ method: 'GET' }),
    );

    // Disable then re-enable for same runId -> should reconnect with ?afterSeq=4
    rerender(
      <StreamHarness
        runId="r1"
        enabled={false}
        onEventCreated={onEventCreated}
        onTerminal={onTerminal}
        onError={onError}
      />,
    );
    rerender(
      <StreamHarness
        runId="r1"
        enabled
        onEventCreated={onEventCreated}
        onTerminal={onTerminal}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/analysis/runs/r1/stream?afterSeq=4',
      expect.objectContaining({ method: 'GET' }),
    );

    // Switch to a different runId -> seq resets cleanly
    rerender(
      <StreamHarness
        runId="r2"
        enabled
        onEventCreated={onEventCreated}
        onTerminal={onTerminal}
        onError={onError}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      '/api/analysis/runs/r2/stream',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
