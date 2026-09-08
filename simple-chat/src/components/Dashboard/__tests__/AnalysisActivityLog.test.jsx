/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AnalysisActivityLog from '../AnalysisActivityLog';

const fileEvent = (index, overrides = {}) => ({
  id: `f${index}`,
  kind: 'file',
  fileName: `Podnesak-${index}.pdf`,
  status: 'ok',
  done: index,
  failed: 0,
  total: 20,
  currentFile: null,
  error: null,
  durationMs: 4200,
  retried: false,
  message: `Analiziran dokument ${index}/20: Podnesak-${index}.pdf`,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('AnalysisActivityLog', () => {
  test('renders nothing when there is no activity', () => {
    const { container } = render(<AnalysisActivityLog activity={[]} isRunning />);
    expect(container.querySelector('[data-testid="analysis-activity-log"]')).toBeNull();
  });

  test('renders file lines with status icon, duration and a counts chip', () => {
    render(
      <AnalysisActivityLog
        activity={[
          fileEvent(1),
          fileEvent(2, { status: 'failed', failed: 1, durationMs: 30000, error: 'Gemini request timed out after 30000ms' }),
        ]}
        isRunning={false}
      />,
    );

    expect(screen.getByTestId('analysis-activity-log')).toBeInTheDocument();
    expect(screen.getByText('2/20')).toBeInTheDocument();
    expect(screen.getByText(/Podnesak-1\.pdf/)).toBeInTheDocument();
    // Fallback: without a classified reason, the raw technical message shows.
    expect(screen.getByText(/Gemini request timed out/)).toBeInTheDocument();
    const failedLine = screen.getByText(/Podnesak-2\.pdf/).closest('div');
    expect(failedLine.textContent).toContain('✗');
  });

  test('prefers the backend-classified reason over the raw error on failed lines', () => {
    render(
      <AnalysisActivityLog
        activity={[
          fileEvent(3, {
            status: 'failed',
            failed: 1,
            durationMs: 30000,
            error: 'Gemini request timed out after 30000ms',
            reason: 'Dnevni limit AI analize je iscrpljen. Pokušajte ponovno sutra.',
          }),
        ]}
        isRunning={false}
      />,
    );

    expect(screen.getByText(/Dnevni limit AI analize je iscrpljen/)).toBeInTheDocument();
    expect(screen.queryByText(/Gemini request timed out/)).not.toBeInTheDocument();
  });

  test('renders heartbeat lines with live counts', () => {
    render(
      <AnalysisActivityLog
        activity={[{
          id: 'h1',
          kind: 'heartbeat',
          fileName: null,
          status: null,
          done: 34,
          failed: 2,
          total: 123,
          currentFile: 'Žalba.pdf',
          error: null,
          durationMs: null,
          retried: false,
          message: '',
          createdAt: new Date().toISOString(),
        }]}
        isRunning
      />,
    );

    expect(screen.getByText(/još aktivan — 34\/123/)).toBeInTheDocument();
    expect(screen.getByText(/trenutno: Žalba\.pdf/)).toBeInTheDocument();
  });

  test('collapses long logs behind an expand toggle', () => {
    const activity = Array.from({ length: 20 }, (_, i) => fileEvent(i + 1));
    render(<AnalysisActivityLog activity={activity} isRunning={false} />);

    const log = screen.getByTestId('analysis-activity-log');
    const visibleBefore = log.querySelectorAll('.space-y-1 > div').length;
    expect(visibleBefore).toBe(8);

    fireEvent.click(screen.getByRole('button', { name: /Prikaži cijeli zapis \(20\)/ }));
    expect(log.querySelectorAll('.space-y-1 > div').length).toBe(20);
    fireEvent.click(screen.getByRole('button', { name: /Prikaži zadnje retke/ }));
    expect(log.querySelectorAll('.space-y-1 > div').length).toBe(8);
  });

  test('shows a liveness badge while running with recent activity', () => {
    render(<AnalysisActivityLog activity={[fileEvent(1)]} isRunning />);

    expect(screen.getByText(/Aktivno · prije \d+ s/)).toBeInTheDocument();
  });

  test('renders the counting header with failures and a determinate bar', () => {
    render(
      <AnalysisActivityLog
        activity={[fileEvent(1)]}
        isRunning
        headerCounter={{ done: 7, failed: 1, total: 23, unit: 'datoteke', stage: 'downloading' }}
        counterKnown
      />,
    );

    expect(screen.getByText(/Obrađeno 7 od 23 datoteke, 1 neuspjelo/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: /Napredak obrade/ });
    expect(bar).toHaveAttribute('aria-valuenow', '7');
    expect(bar).toHaveAttribute('aria-valuemax', '23');
  });

  test('omits the failure clause when nothing failed', () => {
    render(
      <AnalysisActivityLog
        activity={[fileEvent(1)]}
        isRunning
        headerCounter={{ done: 2, failed: 0, total: 4, unit: 'predmeta', stage: 'downloading' }}
        counterKnown
      />,
    );

    expect(screen.getByText(/Obrađeno 2 od 4 predmeta/)).toBeInTheDocument();
    expect(screen.queryByText(/neuspjelo/)).not.toBeInTheDocument();
  });

  test('renders the indeterminate header while the total is unknown', () => {
    render(
      <AnalysisActivityLog
        activity={[fileEvent(1)]}
        isRunning
        headerCounter={{ done: 2, failed: 0, total: null, unit: 'datoteke', stage: 'extracting' }}
        counterKnown={false}
      />,
    );

    expect(screen.getByText(/Prikupljam popis/)).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: /Napredak obrade/ });
    expect(bar).not.toHaveAttribute('aria-valuenow');
  });

  test('renders no header line for legacy runs without counters', () => {
    render(
      <AnalysisActivityLog activity={[fileEvent(1)]} isRunning headerCounter={null} counterKnown={false} />,
    );

    expect(screen.queryByRole('progressbar', { name: /Napredak obrade/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Obrađeno/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Prikupljam popis/)).not.toBeInTheDocument();
  });
});
