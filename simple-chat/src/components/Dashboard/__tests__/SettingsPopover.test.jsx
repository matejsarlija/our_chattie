/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPopover from '../SettingsPopover';
import { useSettings } from '../../../hooks/useSettings';

jest.mock('../../../hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

describe('SettingsPopover', () => {
  const saveSettings = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    saveSettings.mockResolvedValue({});
    useSettings.mockReturnValue({
      settings: { defaultScanDepth: 'balanced' },
      loading: false,
      saving: false,
      error: '',
      saveSettings,
    });
  });

  test('exposes only the lawyer-facing default scan-depth preference', async () => {
    render(<SettingsPopover />);

    const trigger = screen.getByRole('button', { name: 'Postavke' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Postavke' })).toBeInTheDocument();
    expect(screen.getByLabelText('Dubina pretrage')).toHaveValue('balanced');
    expect(screen.queryByText(/zaključivanja|rerank|model routing/i)).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  test('persists the selected default scan depth', async () => {
    render(<SettingsPopover />);
    fireEvent.click(screen.getByRole('button', { name: 'Postavke' }));

    fireEvent.change(await screen.findByLabelText('Dubina pretrage'), { target: { value: 'full' } });
    expect(saveSettings).toHaveBeenCalledWith({ defaultScanDepth: 'full' });
  });

  test('closes on Escape and restores focus to the gear trigger', async () => {
    render(<SettingsPopover />);

    const trigger = screen.getByRole('button', { name: 'Postavke' });
    fireEvent.click(trigger);
    const panel = await screen.findByRole('dialog');
    fireEvent.keyDown(panel, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
