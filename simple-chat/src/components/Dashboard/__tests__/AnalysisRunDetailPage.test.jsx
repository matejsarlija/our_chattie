/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalysisRunDetailPage from '../AnalysisRunDetailPage';
import { useAuth } from '../../../contexts/AuthContext';
import { useAnalysisRunDetail } from '../../../hooks/useAnalysisRunDetail';
import { useAnalysisEvents } from '../../../hooks/useAnalysisEvents';

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../hooks/useAnalysisRunDetail', () => ({
  useAnalysisRunDetail: jest.fn(),
}));

jest.mock('../../../hooks/useAnalysisEvents', () => ({
  useAnalysisEvents: jest.fn(),
}));

jest.mock('../../../lib/env', () => ({
  env: {
    analysisDetailSseEnabled: false,
  },
}));

jest.mock('../DashboardShell', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="dashboard-shell">{children}</div>,
}));

jest.mock('../../MermaidDiagram', () => ({
  __esModule: true,
  default: () => <div data-testid="mermaid-diagram" />,
}));

jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  useParams: () => ({ id: 'run-1' }),
}));

describe('AnalysisRunDetailPage metadata modules', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    useAuth.mockReturnValue({
      user: { id: 'u1' },
      accessToken: 'token-1',
      loading: false,
      openAuthModal: jest.fn(),
    });

    useAnalysisEvents.mockReturnValue({
      timeline: [],
      stages: [],
      isErrored: false,
    });

    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: {
          processedCases: [
            {
              caseResult: {
                title: 'Objava 14/2026 - Stecaj duznika',
                caseNumber: 'St-357/2013',
                detailLink: 'https://e-oglasna.pravosudje.hr/objave/128734',
              },
            },
          ],
        },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });
  });

  test('renders per-entry metadata cards with naziv objave and broj predmeta', () => {
    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('Naziv objave')).toBeInTheDocument();
    expect(screen.getByText('Objava 14/2026 - Stecaj duznika')).toBeInTheDocument();
    expect(screen.getByText('Broj predmeta')).toBeInTheDocument();
    expect(screen.getByText('St-357/2013')).toBeInTheDocument();
  });

  test('derives ID objave from detailLink when entryDisplayId is missing', () => {
    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('ID objave')).toBeInTheDocument();
    expect(screen.getByText('128734')).toBeInTheDocument();
  });

  test('prefers backend entryDisplayId over derived value when available', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: {
          processedCases: [
            {
              caseResult: {
                title: 'Objava 15/2026 - Dodatna dokumentacija',
                caseNumber: 'St-357/2013',
                detailLink: 'https://e-oglasna.pravosudje.hr/objave/999999',
                entryDisplayId: 'EXTERNAL-ID-42',
              },
            },
          ],
        },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('EXTERNAL-ID-42')).toBeInTheDocument();
  });

  test('renders Predmet label for case-number query runs', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        query_type: 'case_number',
        query_value: 'St-357/2013',
        result_text: 'Rezultat',
        result_json: { processedCases: [] },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('Predmet: St-357/2013')).toBeInTheDocument();
  });

  test('renders Tekst label for text query runs', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        query_type: 'text',
        query_value: 'adriatic osiguranje',
        result_text: 'Rezultat',
        result_json: { processedCases: [] },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('Tekst: adriatic osiguranje')).toBeInTheDocument();
  });

  test('renders structured annex sections when report exists', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Legacy rezultat',
        result_json: {
          processedCases: [],
          report: {
            findings: [
              { claim: 'Utvrden je kontinuitet postupanja.', confidence: 'high' },
            ],
            timeline: [
              { date: '2026-01-10', event: 'Otvoren postupak.' },
            ],
            conflicts: [
              { description: 'Nesklad u navodu o datumu dospijeca.' },
            ],
          },
        },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('Nalazi')).toBeInTheDocument();
    expect(screen.getByText('Utvrden je kontinuitet postupanja.')).toBeInTheDocument();
    expect(screen.getByText('Vremenska crta')).toBeInTheDocument();
    expect(screen.getByText('Otvoren postupak.')).toBeInTheDocument();
    expect(screen.getByText('Konflikti')).toBeInTheDocument();
    expect(screen.getByText('Nesklad u navodu o datumu dospijeca.')).toBeInTheDocument();
  });

  test('hides structured annex sections when report is missing', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Samo legacy markdown',
        result_json: {
          processedCases: [],
        },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.queryByText('Nalazi')).not.toBeInTheDocument();
    expect(screen.queryByText('Vremenska crta')).not.toBeInTheDocument();
    expect(screen.queryByText('Konflikti')).not.toBeInTheDocument();
  });

  test('renders citation rows for findings and timeline with copy-friendly source text and links', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Legacy rezultat',
        result_json: {
          processedCases: [],
          report: {
            findings: [
              {
                claim: 'Utvrden je kontinuitet postupanja.',
                citations: [
                  {
                    source: 'Stecajni spis',
                    fileName: 'Rjesenje.pdf',
                    page: '3',
                    url: 'https://example.com/rjesenje.pdf',
                  },
                ],
              },
            ],
            timeline: [
              {
                event: 'Otvoren postupak.',
                citations: [
                  {
                    source: 'Objava',
                    location: 'odlomak 2',
                  },
                ],
              },
            ],
          },
        },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.getAllByText('Citati').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Stecajni spis | Rjesenje.pdf | str. 3')).toBeInTheDocument();
    expect(screen.getByText('Objava | odlomak 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Otvori izvor' })).toHaveAttribute('href', 'https://example.com/rjesenje.pdf');
  });

  test('handles invalid citation arrays safely', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Legacy rezultat',
        result_json: {
          processedCases: [],
          report: {
            findings: [
              {
                claim: 'Nalaz bez valjanih citata.',
                citations: [null, {}, { source: '' }],
              },
            ],
          },
        },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: '',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.getByText('Nalaz bez valjanih citata.')).toBeInTheDocument();
    expect(screen.queryByText('Citati')).not.toBeInTheDocument();
  });
});
