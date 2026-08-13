/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useAnalysisRuns } from '../useAnalysisRuns';
import { apiFetch } from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({
  apiFetch: jest.fn(),
}));

function Harness({ enabled = true, onValue }) {
  const value = useAnalysisRuns({ enabled, limit: 2 });

  useEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}

describe('useAnalysisRuns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads first page and supports explicit page loading', async () => {
    const snapshots = [];

    apiFetch
      .mockResolvedValueOnce({ runs: [{ id: 'r1', oib: '123', status: 'done', created_at: '2025-01-01' }], count: 5, offset: 0 })
      .mockResolvedValueOnce({ runs: [{ id: 'r3', oib: '999', status: 'running', created_at: '2025-01-02' }], count: 5, offset: 2 })
      .mockResolvedValueOnce({ runs: [{ id: 'r1', oib: '123', status: 'done', created_at: '2025-01-01' }], count: 5, offset: 0 });

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/analysis/runs?limit=2&offset=0');
    });

    const latest = snapshots[snapshots.length - 1];

    await act(async () => {
      await latest.loadRuns(2);
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/analysis/runs?limit=2&offset=2');
    });

    const afterNext = snapshots[snapshots.length - 1];

    await act(async () => {
      await afterNext.loadRuns(0);
    });

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/analysis/runs?limit=2&offset=0');
    });
  });
});
