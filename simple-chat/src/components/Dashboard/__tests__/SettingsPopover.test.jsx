/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPopover from '../SettingsPopover';

jest.mock('../ReasoningExperimentsPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="reasoning-experiments-panel" />,
}));

describe('SettingsPopover', () => {
  test('opens settings in a compact anchored panel', async () => {
    render(<SettingsPopover />);

    const trigger = screen.getByRole('button', { name: 'Postavke' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Postavke' })).toBeInTheDocument();
    expect(screen.getByText('Eksperimenti zaključivanja')).toBeInTheDocument();
    expect(screen.getByTestId('reasoning-experiments-panel')).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
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
