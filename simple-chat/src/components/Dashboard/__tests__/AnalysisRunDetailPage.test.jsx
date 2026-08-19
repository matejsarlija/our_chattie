/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import AnalysisRunDetailPage from '../AnalysisRunDetailPage';
import { useAnalysisRunDetail } from '../../../hooks/useAnalysisRunDetail';
import { useAnalysisEvents } from '../../../hooks/useAnalysisEvents';

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

  test('renders OIB label for explicit oib query runs', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        query_type: 'oib',
        query_value: '12345678901',
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

    expect(screen.getByText('OIB: 12345678901')).toBeInTheDocument();
  });

  test('renders neutral Upit label for unknown query types', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        query_type: 'unknown',
        query_value: 'nepoznato',
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

    expect(screen.getByText('Upit: nepoznato')).toBeInTheDocument();
    expect(screen.queryByText('OIB: nepoznato')).not.toBeInTheDocument();
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
    expect(screen.getByText('2026-01-10')).toBeInTheDocument();
    expect(screen.getByText('Konflikti')).toBeInTheDocument();
    expect(screen.getByText('Nesklad u navodu o datumu dospijeca.')).toBeInTheDocument();
  });

  test('renders open questions section when report includes open_questions', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Legacy rezultat',
        result_json: {
          processedCases: [],
          report: {
            open_questions: [
              { question: 'Nedostaje datum dospijeća glavnog potraživanja.' },
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

    expect(screen.getByText('Otvorena pitanja')).toBeInTheDocument();
    expect(screen.getByText('Nedostaje datum dospijeća glavnog potraživanja.')).toBeInTheDocument();
  });

  test('shows robust empty and malformed item fallback states inside annex sections', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Legacy rezultat',
        result_json: {
          processedCases: [],
          report: {
            findings: [{ irrelevant: true }],
            timeline: [{ wrong: 'shape' }],
            conflicts: [{}],
            open_questions: [{}],
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

    expect(screen.getByText('Prilozi analize')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(4);
  });

  test('renders narrative fallback when report is missing', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: '## Legacy nalaz\n\n- ključna točka',
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

    expect(screen.getByText(/Legacy nalaz/)).toBeInTheDocument();
    expect(screen.getByTestId('react-markdown')).toHaveTextContent('ključna točka');
    expect(screen.queryByText('Prilozi analize')).not.toBeInTheDocument();
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

  test('renders annex sections for backend-native report shapes (string open questions, finding/reason conflicts)', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Narativ',
        result_json: {
          processedCases: [],
          report: {
            schemaVersion: '1.0.0',
            narrative: 'Narativ',
            findings: [{ id: 'f1', text: 'Utvrdena aktivna parnica.', confidence: 'high', citations: [] }],
            openQuestions: ['Nedostaje datum dospijeća glavnog potraživanja.'],
            nextSteps: ['Podnijeti tužbu.'],
            conflicts: [{ finding: 'Nesklad datuma.', reason: 'Dva različita datuma u dokumentima.' }],
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

    expect(screen.getByText('Utvrdena aktivna parnica.')).toBeInTheDocument();
    expect(screen.getByText('Nedostaje datum dospijeća glavnog potraživanja.')).toBeInTheDocument();
    expect(screen.getByText('Dva različita datuma u dokumentima.')).toBeInTheDocument();
  });

  test('renders a transparent error banner with the persisted friendly message for failed runs', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'error',
        oib: '12345678901',
        error: 'Analiza nije uspjela tijekom faze analize i sintetiziranja izvješća. Dnevni limit AI analize je iscrpljen.',
        result_text: '',
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

    expect(
      screen.getByText(/Analiza nije uspjela tijekom faze analize i sintetiziranja izvješća\./)
    ).toBeInTheDocument();
  });

  test('does not duplicate the banner when the hook-level error is also present', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'error',
        oib: '12345678901',
        error: 'Analiza nije uspjela tijekom faze analize i sintetiziranja izvješća.',
        result_text: '',
        result_json: { processedCases: [] },
      },
      events: [],
      loading: false,
      eventsLoading: false,
      error: 'Mrežna greška pri učitavanju detalja analize.',
      isRunning: false,
      connectionMode: 'idle',
      lastUpdatedAt: '2026-02-27T12:00:00.000Z',
      refresh: jest.fn(),
    });

    render(<AnalysisRunDetailPage />);

    expect(screen.queryByText(/Analiza nije uspjela/)).not.toBeInTheDocument();
    expect(screen.getByText(/Mrežna greška pri učitavanju/)).toBeInTheDocument();
  });

  test('renders partial discovery results alongside the error when an errored run carries result_json', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'error',
        oib: '12345678901',
        error: 'Analiza nije uspjela tijekom faze analize i sintetiziranja izvješća. Djelomični rezultati su sačuvani i prikazani su niže na ovoj stranici.',
        result_text: '',
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
          discoverySummary: {
            reasoningClusterId: 'St-357/2013',
            capturedDistinctCaseCount: 1,
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

    expect(screen.getByText(/Djelomični rezultati su sačuvani/)).toBeInTheDocument();
    expect(screen.getByText('Objava 14/2026 - Stecaj duznika')).toBeInTheDocument();
    expect(screen.getByText('St-357/2013')).toBeInTheDocument();
  });

  test('shows an error-aware result empty state when an errored run has no partial result_text', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'error',
        oib: '12345678901',
        error: 'Analiza nije uspjela tijekom faze preuzimanja dokumenata.',
        result_text: '',
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

    expect(
      screen.getByText(/Rezultat analize nije dostupan jer obrada nije uspješno dovršena\./)
    ).toBeInTheDocument();
  });

  test('renders secondary clusters from result_json with identity badges', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: {
          processedCases: [],
          secondaryClusters: [
            {
              clusterId: 'Povrv-297/2020',
              caseNumber: 'Povrv-297/2020',
              entryCount: 4,
              documentCount: 3,
              participantNames: ['KERUM d.o.o.'],
              identityConsistency: 'consistent',
              acquisitionProvenance: [{ mode: 'search-window' }],
            },
            {
              clusterId: 'P-170/2023',
              caseNumber: 'P-170/2023',
              entryCount: 2,
              documentCount: 0,
              participantNames: ['Nepoznato'],
              identityConsistency: 'unresolved',
              acquisitionProvenance: [{ mode: 'search-window' }],
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

    expect(screen.getByText('Ostali pronađeni predmeti')).toBeInTheDocument();
    expect(screen.getByText('Povrv-297/2020')).toBeInTheDocument();
    expect(screen.getByText('P-170/2023')).toBeInTheDocument();
    expect(screen.getByText('Identičan subjekt')).toBeInTheDocument();
    expect(screen.getByText('Nepotvrđena identifikacija')).toBeInTheDocument();
    expect(screen.getByText('2 predmeta')).toBeInTheDocument();
  });

  test('falls back to discoverySummary.clusters when secondaryClusters is absent', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: {
          processedCases: [],
          discoverySummary: {
            clusters: [
              { clusterId: 'ST-100/2023', selectedForReasoning: true, entryCount: 5, documentCount: 5 },
              { clusterId: 'ST-200/2021', selectedForReasoning: false, entryCount: 3, documentCount: 1 },
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

    expect(screen.getByText('Ostali pronađeni predmeti')).toBeInTheDocument();
    expect(screen.getByText('ST-200/2021')).toBeInTheDocument();
    expect(screen.queryByText('ST-100/2023')).not.toBeInTheDocument();
  });

  test('hides the secondary-clusters section entirely for a single-cluster run', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: {
          processedCases: [],
          secondaryClusters: [],
          discoverySummary: {
            capturedDistinctCaseCount: 1,
            reasoningClusterId: 'ST-2/2013',
            recommendedPrimaryClusterId: 'ST-2/2013',
            secondaryClusterIds: [],
            clusters: [
              { clusterId: 'ST-2/2013', selectedForReasoning: true, entryCount: 50, documentCount: 50 },
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

    expect(screen.queryByText('Ostali pronađeni predmeti')).not.toBeInTheDocument();
    expect(screen.queryByText('2 predmeta')).not.toBeInTheDocument();
  });

  test('renders the analysis coverage banner with failed document counts', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: {
          processedCases: [
            {
              caseResult: { caseNumber: 'ST-700/2024' },
              groupMetadata: { selectedForReasoning: true },
              analysis: {
                coverage: {
                  analyzed: 2,
                  failed: 1,
                  total: 3,
                  coverageRatio: 0.67,
                  complete: false,
                  failedFiles: [
                    { fileName: 'doc3.pdf', reason: 'Gemini request timed out after 30000ms' },
                  ],
                },
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

    expect(screen.getByText('Pokrivenost analize dokumenata')).toBeInTheDocument();
    expect(screen.getByText(/Analizirano je 2 od 3 dokumenata/)).toBeInTheDocument();
    expect(screen.getByText('1 neanalizirano')).toBeInTheDocument();
    expect(screen.getByText(/doc3\.pdf/)).toBeInTheDocument();
  });

  test('renders the token usage summary from run.token_usage', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
        result_text: 'Rezultat',
        result_json: { processedCases: [] },
        token_usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140, calls: 3 },
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

    expect(screen.getByText('Potrošnja tokena')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('140')).toBeInTheDocument();
    expect(screen.getByText(/3 poziva/)).toBeInTheDocument();
  });

  test('hides the token usage summary when no usage is present', () => {
    useAnalysisRunDetail.mockReturnValue({
      run: {
        id: 'run-1',
        status: 'done',
        oib: '12345678901',
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

    expect(screen.queryByText('Potrošnja tokena')).not.toBeInTheDocument();
  });
});
