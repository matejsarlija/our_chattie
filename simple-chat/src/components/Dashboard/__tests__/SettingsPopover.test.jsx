import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPopover from '../SettingsPopover';

describe('SettingsPopover', () => {
  test('opens on click and displays Design System, Pravila privatnosti, and O nama links', async () => {
    render(<SettingsPopover />);

    const trigger = screen.getByRole('button', { name: 'Postavke' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Design System' })).toHaveAttribute('href', '/dashboard/design-system');
    expect(screen.getByRole('link', { name: 'Pravila privatnosti' })).toHaveAttribute('href', '/pravila-privatnosti');
    expect(screen.getByRole('link', { name: 'O nama' })).toHaveAttribute('href', '/o-nama');
    expect(screen.queryByLabelText('Dubina pretrage')).not.toBeInTheDocument();
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
