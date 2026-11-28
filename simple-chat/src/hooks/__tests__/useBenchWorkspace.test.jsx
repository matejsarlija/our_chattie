/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useBenchWorkspace } from '../useBenchWorkspace';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  resolveApiUrl: (u) => u,
  listBenchDocuments: vi.fn(),
  listBenchModels: vi.fn(),
  listBenchRuns: vi.fn(),
  listBenchCandidates: vi.fn(),
  seedBenchCandidates: vi.fn(),
  runCandidateMicroBench: vi.fn(),
  launchBenchRun: vi.fn(),
  cancelBenchJob: vi.fn(),
  getBenchJob: vi.fn(),
  runGbenchGate: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

function Harness({ onValue }) {
  const value = useBenchWorkspace();
  useEffect(() => {
    onValue(value);
  }, [value, onValue]);
  return null;
}

describe('useBenchWorkspace SSE onerror polling fallback', () => {
  const originalEventSource = global.EventSource;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    apiClient.listBenchDocuments.mockResolvedValue({ documents: [], smokeDocIds: [] });
    apiClient.listBenchModels.mockResolvedValue({ models: [] });
    apiClient.listBenchRuns.mockResolvedValue({ runs: [], activeJobId: 'job-err-1' });
    apiClient.listBenchCandidates.mockResolvedValue({ candidates: [] });
    apiClient.getSettings.mockResolvedValue({ settings: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.EventSource = originalEventSource;
  });

  test('falls back to polling getBenchJob when EventSource fires onerror', async () => {
    let createdEs = null;
    global.EventSource = vi.fn().mockImplementation(() => {
      createdEs = {
        addEventListener: vi.fn(),
        close: vi.fn(),
        onerror: null,
      };
      return createdEs;
    });

    apiClient.getBenchJob
      .mockResolvedValueOnce({
        id: 'job-err-1',
        state: 'running',
        progress: { done: 1, total: 2, costSoFarUsd: 0.004 },
      })
      .mockResolvedValueOnce({
        id: 'job-err-1',
        state: 'done',
        progress: { done: 2, total: 2, costSoFarUsd: 0.008 },
      });

    let latest = null;
    render(<Harness onValue={(v) => { latest = v; }} />);

    await waitFor(() => {
      expect(createdEs).not.toBeNull();
    });
    expect(latest.jobStatus).toBe('running');

    await act(async () => {
      createdEs.onerror(new Event('error'));
    });

    await waitFor(() => {
      expect(apiClient.getBenchJob).toHaveBeenCalledWith('job-err-1');
    });
    expect(latest.jobProgress).toEqual({ done: 1, total: 2, costSoFarUsd: 0.004 });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    await waitFor(() => {
      expect(latest.jobStatus).toBe('done');
    });
    expect(latest.activeJobId).toBeNull();
  });
});
