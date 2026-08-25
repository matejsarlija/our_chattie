/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import SettingsModal from '../SettingsModal';

jest.mock('../ReasoningExperimentsPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="reasoning-experiments-panel" />,
}));

describe('SettingsModal', () => {
  test('renders nothing when closed', () => {
    render(<SettingsModal isOpen={false} onClose={jest.fn()} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('renders the reasoning experiments when open', () => {
    render(<SettingsModal isOpen onClose={jest.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Postavke' })).toBeInTheDocument();
    expect(screen.getByText('Eksperimenti zaključivanja')).toBeInTheDocument();
    expect(screen.getByTestId('reasoning-experiments-panel')).toBeInTheDocument();
  });

  test('closes when the close button is clicked', () => {
    const onClose = jest.fn();
    render(<SettingsModal isOpen onClose={onClose} />);

    screen.getByRole('button', { name: 'Zatvori' }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
