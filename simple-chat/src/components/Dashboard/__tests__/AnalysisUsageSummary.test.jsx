/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalysisUsageSummary from '../AnalysisUsageSummary';

describe('AnalysisUsageSummary', () => {
  test('renders nothing when usage is absent', () => {
    const { container } = render(<AnalysisUsageSummary usage={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders input/output/total token counts and call count', () => {
    render(
      <AnalysisUsageSummary
        usage={{ inputTokens: 128432, outputTokens: 18907, totalTokens: 147339, calls: 12 }}
        model="gemini-2.5-flash"
      />,
    );

    expect(screen.getByText('Potrošnja tokena')).toBeInTheDocument();
    expect(screen.getByText('Ulazni tokeni')).toBeInTheDocument();
    expect(screen.getByText('Izlazni tokeni')).toBeInTheDocument();
    expect(screen.getByText('Ukupno tokena')).toBeInTheDocument();
    expect(screen.getByText('128.432')).toBeInTheDocument();
    expect(screen.getByText('18.907')).toBeInTheDocument();
    expect(screen.getByText('147.339')).toBeInTheDocument();
    expect(screen.getByText(/12 poziva/)).toBeInTheDocument();
    expect(screen.getByText(/gemini-2\.5-flash/)).toBeInTheDocument();
  });

  test('shows a running indicator when isRunning is true', () => {
    render(
      <AnalysisUsageSummary
        usage={{ inputTokens: 10, outputTokens: 5, totalTokens: 15, calls: 1 }}
        isRunning
      />,
    );

    expect(screen.getByText('ažurira se')).toBeInTheDocument();
  });

  test('renders em-dash placeholders for missing token fields', () => {
    render(<AnalysisUsageSummary usage={{ calls: 0 }} />);

    expect(screen.getAllByText('—').length).toBe(3);
  });
});
