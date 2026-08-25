/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useSettings } from '../useSettings';
import { getSettings, updateSettings } from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
}));

function Harness({ onValue }) {
  const value = useSettings();

  useEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}

describe('useSettings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('loads persisted settings on mount', async () => {
    getSettings.mockResolvedValue({ settings: { reasoningRerankMode: 'force' } });
    const snapshots = [];

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(snapshots[snapshots.length - 1].reasoningRerankMode).toBe('force');
    });
  });

  test('defaults reasoning switches when the backend returns no settings', async () => {
    getSettings.mockResolvedValue({});
    const snapshots = [];

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].reasoningRerankMode).toBe('auto');
      expect(snapshots[snapshots.length - 1].reasoningPlanner).toBe('on');
    });
  });

  test('saves a reasoning switch and reflects the server response', async () => {
    getSettings.mockResolvedValue({ settings: { reasoningPlanner: 'on' } });
    updateSettings.mockResolvedValue({ settings: { reasoningPlanner: 'off' } });
    const snapshots = [];

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].loading).toBe(false);
    });

    const latest = snapshots[snapshots.length - 1];

    let saved;
    await act(async () => {
      saved = await latest.saveReasoningSettings({ reasoningPlanner: 'off' });
    });

    expect(updateSettings).toHaveBeenCalledWith({ reasoningPlanner: 'off' });
    expect(saved).toEqual({ reasoningPlanner: 'off' });

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].reasoningPlanner).toBe('off');
    });
  });
});
