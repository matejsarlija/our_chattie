/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useAnalysisRunDetail } from '../useAnalysisRunDetail';
import { apiFetch } from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({
  apiFetch: jest.fn(),
}));

function Harness({ runId, token, onValue }) {
  const value = useAnalysisRunDetail({ runId, token, pollMs: 5000, enabled: true });

  useEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}

describe('useAnalysisRunDetail polling', () => {
  let setIntervalSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    setIntervalSpy = jest.spyOn(global, 'setInterval');
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args) => {
      const message = String(args[0] || '');
      if (message.includes('not wrapped in act')) {
        return;
      }
      // Preserve unexpected errors in test output.
      // eslint-disable-next-line no-console
      console.warn(...args);
    });
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  test('polls while run is running', async () => {
    const snapshots = [];

    apiFetch
      .mockResolvedValueOnce({ run: { id: 'r1', status: 'running' } })
      .mockResolvedValueOnce({ events: [] })
      .mockResolvedValueOnce({ run: { id: 'r1', status: 'running' } })
      .mockResolvedValueOnce({ events: [{ id: 'e1', event_type: 'starting', created_at: '2025-01-01', message: 'Start' }] });

    render(<Harness runId="r1" token="tkn" onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/analysis/runs/r1', { token: 'tkn' });
      expect(apiFetch).toHaveBeenCalledWith('/api/analysis/runs/r1/events', { token: 'tkn' });
    });

    await waitFor(() => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });

    const last = snapshots[snapshots.length - 1];
    expect(last.isRunning).toBe(true);
  });

  test('does not poll when run is already terminal', async () => {
    apiFetch
      .mockResolvedValueOnce({ run: { id: 'r2', status: 'done' } })
      .mockResolvedValueOnce({ events: [] });

    render(<Harness runId="r2" token="tkn" onValue={() => {}} />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledTimes(2);
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
