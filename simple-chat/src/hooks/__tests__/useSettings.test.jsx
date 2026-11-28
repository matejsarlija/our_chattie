/**
 * @jest-environment jsdom
 */

import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { useSettings } from '../useSettings';
import { getSettings, updateSettings } from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
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
    vi.clearAllMocks();
  });

  test('loads the persisted default scan depth on mount', async () => {
    getSettings.mockResolvedValue({ settings: { defaultScanDepth: 'full' } });
    const snapshots = [];

    render(<Harness onValue={(value) => snapshots.push(value)} />);

    await waitFor(() => {
      expect(getSettings).toHaveBeenCalledTimes(1);
      expect(snapshots[snapshots.length - 1].settings.defaultScanDepth).toBe('full');
    });
  });

  test('defaults scan depth when the backend has no preferences', async () => {
    getSettings.mockResolvedValue({});
    const snapshots = [];

    render(<Harness onValue={(value) => snapshots.push(value)} />);

    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].settings.defaultScanDepth).toBe('balanced');
    });
  });

  test('saves a preference and reflects the server response', async () => {
    getSettings.mockResolvedValue({ settings: { defaultScanDepth: 'balanced' } });
    updateSettings.mockResolvedValue({ settings: { defaultScanDepth: 'full' } });
    const snapshots = [];

    render(<Harness onValue={(value) => snapshots.push(value)} />);
    await waitFor(() => expect(snapshots[snapshots.length - 1].loading).toBe(false));

    let saved;
    await act(async () => {
      saved = await snapshots[snapshots.length - 1].saveSettings({ defaultScanDepth: 'full' });
    });

    expect(updateSettings).toHaveBeenCalledWith({ defaultScanDepth: 'full' });
    expect(saved).toEqual({ defaultScanDepth: 'full' });
    await waitFor(() => {
      expect(snapshots[snapshots.length - 1].settings.defaultScanDepth).toBe('full');
    });
  });
});
