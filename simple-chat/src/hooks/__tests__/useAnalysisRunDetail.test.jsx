/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useAnalysisRunDetail } from '../useAnalysisRunDetail';
import { apiFetch } from '../../lib/apiClient';
import { useAnalysisRunStream } from '../useAnalysisRunStream';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
}));

vi.mock('../useAnalysisRunStream', () => ({
  useAnalysisRunStream: vi.fn(),
}));

function Harness({
  runId,
  pollMs = 5000,
  streamEnabled = false,
  onValue,
}) {
  const value = useAnalysisRunDetail({
    runId,
    pollMs,
    enabled: true,
    streamEnabled,
  });

  useEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('useAnalysisRunDetail polling', () => {
  let consoleErrorSpy;
  let randomSpy;
  let visibilitySpy;

  beforeEach(() => {
    vi.clearAllMocks();
    useAnalysisRunStream.mockImplementation(() => ({ connected: false, lastEventAt: null }));
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = String(args[0] || '');
      if (message.includes('not wrapped in act')) {
        return;
      }
      // eslint-disable-next-line no-console
      console.warn(...args);
    });
  });

  afterEach(() => {
    visibilitySpy.mockRestore();
    randomSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  test('polls while run is running', async () => {
    apiFetch
      .mockResolvedValueOnce({ run: { id: 'r1', status: 'running' }, events: [] })
      .mockResolvedValueOnce({
        run: { id: 'r1', status: 'running' },
        events: [{ id: 'e1', event_type: 'starting', created_at: '2025-01-01', message: 'Start' }],
      });

    render(<Harness runId="r1" pollMs={25} onValue={() => {}} />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
    }, { timeout: 3000 });
    expect(apiFetch).toHaveBeenNthCalledWith(1, '/api/analysis/runs/r1/full');
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/analysis/runs/r1/full');
  });

  test('does not poll when run is already terminal', async () => {
    apiFetch.mockResolvedValueOnce({ run: { id: 'r2', status: 'done' }, events: [] });

    render(<Harness runId="r2" pollMs={20} onValue={() => {}} />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      await sleep(1200);
    });

    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  test('backs off after rate limit responses', async () => {
    const callTimes = [];
    apiFetch.mockImplementation(() => {
      callTimes.push(performance.now());
      const callNo = callTimes.length;
      if (callNo === 1) {
        return Promise.resolve({ run: { id: 'r3', status: 'running' }, events: [] });
      }
      if (callNo === 2) {
        return Promise.reject(Object.assign(new Error('Too many requests'), { status: 429, retryAfter: '0.05' }));
      }
      return Promise.resolve({ run: { id: 'r3', status: 'running' }, events: [] });
    });

    render(<Harness runId="r3" pollMs={20} onValue={() => {}} />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(3);
    }, { timeout: 4500 });

    const firstGap = callTimes[1] - callTimes[0];
    const secondGap = callTimes[2] - callTimes[1];

    expect(firstGap).toBeGreaterThanOrEqual(900);
    expect(secondGap).toBeGreaterThanOrEqual(900);
  });

  test('clears stale stream error after successful fallback refresh', async () => {
    let latestValue = null;

    apiFetch
      .mockResolvedValueOnce({ run: { id: 'r4', status: 'running' }, events: [] })
      .mockResolvedValueOnce({ run: { id: 'r4', status: 'running' }, events: [] });

    render(
      <Harness
        runId="r4"
        pollMs={100000}
        streamEnabled
        onValue={(value) => {
          latestValue = value;
        }}
      />,
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const latestCall = useAnalysisRunStream.mock.calls.at(-1)?.[0];
      expect(latestCall?.enabled).toBe(true);
    });

    act(() => {
      const latestCall = useAnalysisRunStream.mock.calls.at(-1)?.[0];
      latestCall?.onError?.('Stream connection failed.');
    });

    await waitFor(() => {
      expect(latestValue?.error).toBe('Stream connection failed.');
    });

    await act(async () => {
      await latestValue.refresh();
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(latestValue?.error).toBe('');
    });
  });

  test('refetches full report when run.terminal SSE event arrives', async () => {
    let latestValue = null;

    apiFetch
      .mockResolvedValueOnce({ run: { id: 'r5', status: 'running' }, events: [] })
      .mockResolvedValueOnce({
        run: {
          id: 'r5',
          status: 'done',
          result_text: 'Dovršeni izvještaj',
          result_json: { comparativeAnalysis: 'Dovršeni izvještaj', report: { findings: [{ id: 'f1' }] } },
        },
        events: [{ id: 'e-term', seq: 2, event_type: 'run.terminal', metadata: { status: 'done' } }],
      });

    render(
      <Harness
        runId="r5"
        pollMs={100000}
        streamEnabled
        onValue={(value) => {
          latestValue = value;
        }}
      />,
    );

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      const latestCall = useAnalysisRunStream.mock.calls.at(-1)?.[0];
      expect(latestCall?.enabled).toBe(true);
    });

    act(() => {
      const latestCall = useAnalysisRunStream.mock.calls.at(-1)?.[0];
      latestCall?.onTerminal?.({ runId: 'r5', seq: 2, status: 'done', run: { id: 'r5', status: 'done' } });
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(latestValue?.run?.status).toBe('done');
      expect(latestValue?.run?.result_json?.report?.findings).toEqual([{ id: 'f1' }]);
    });
    expect(apiFetch).toHaveBeenNthCalledWith(2, '/api/analysis/runs/r5/full');
  });
});
