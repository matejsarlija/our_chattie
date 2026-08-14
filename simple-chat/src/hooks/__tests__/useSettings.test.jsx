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
    getSettings.mockResolvedValue({ settings: { geminiPlan: 'paid' } });
    const snapshots = [];

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(snapshots[snapshots.length - 1].geminiPlan).toBe('paid');
    });
  });

  test('defaults to the free plan when the backend returns no settings', async () => {
    getSettings.mockResolvedValue({});
    const snapshots = [];

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].geminiPlan).toBe('free');
    });
  });

  test('saves the plan and reflects the server response', async () => {
    getSettings.mockResolvedValue({ settings: { geminiPlan: 'free' } });
    updateSettings.mockResolvedValue({ settings: { geminiPlan: 'paid' } });
    const snapshots = [];

    render(<Harness onValue={(v) => snapshots.push(v)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].loading).toBe(false);
    });

    const latest = snapshots[snapshots.length - 1];

    let saved;
    await act(async () => {
      saved = await latest.saveGeminiPlan('paid');
    });

    expect(updateSettings).toHaveBeenCalledWith({ geminiPlan: 'paid' });
    expect(saved).toEqual({ geminiPlan: 'paid' });

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].geminiPlan).toBe('paid');
    });
  });
});
