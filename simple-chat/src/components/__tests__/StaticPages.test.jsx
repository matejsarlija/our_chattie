/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import PrivacyPolicy from '../PrivacyPolicy';
import AboutUs from '../AboutUs';

jest.mock('../Dashboard/DashboardShell', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="dashboard-shell">{children}</div>,
}));

describe('Static pages (analysis-only chrome)', () => {
  test('PrivacyPolicy renders dashboard shell and no chat-era copy', () => {
    render(<PrivacyPolicy />);

    expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Pravila privatnosti' })).toBeInTheDocument();
    expect(screen.queryByText(/Povratak na chat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/razgovora s pravnim asistentom/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pretplatiti/)).not.toBeInTheDocument();
  });

  test('AboutUs renders dashboard shell and no subscription/chat-era copy', () => {
    render(<AboutUs />);

    expect(screen.getByTestId('dashboard-shell')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'O nama' })).toBeInTheDocument();
    expect(screen.queryByText(/Povratak na chat/)).not.toBeInTheDocument();
    expect(screen.queryByText(/pretplatiti/)).not.toBeInTheDocument();
    expect(screen.queryByText(/chat prozoru/)).not.toBeInTheDocument();
  });
});
