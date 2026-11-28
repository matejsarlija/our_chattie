import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BenchPage from '../BenchPage';
import BenchRunDetailPage from '../BenchRunDetailPage';
import BenchGoldEditorPage from '../BenchGoldEditorPage';
import * as apiClient from '../../../lib/apiClient';

vi.mock('../../../lib/env', () => ({ env: { apiUrl: '/api' } }));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  NavLink: ({ to, children, className, end, ...rest }) => (
    <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useParams: () => ({ runId: '2026-11-28T09-00-00-000Z-a1b2c3d4' }),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

vi.mock('../../../lib/apiClient', () => ({
  resolveApiUrl: (u) => u,
  listBenchDocuments: vi.fn(),
  listBenchModels: vi.fn(),
  listBenchRuns: vi.fn(),
  listBenchCandidates: vi.fn(),
  seedBenchCandidates: vi.fn(),
  runCandidateMicroBench: vi.fn(),
  launchBenchRun: vi.fn(),
  cancelBenchJob: vi.fn(),
  getBenchJob: vi.fn(),
  runGbenchGate: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getBenchRunReport: vi.fn(),
  getBenchRunTraces: vi.fn(),
  getBenchReview: vi.fn(),
  submitBenchReview: vi.fn(),
  listBenchGoldSets: vi.fn(),
  getBenchGoldTemplate: vi.fn(),
  saveBenchGoldTemplate: vi.fn(),
  suggestBenchGold: vi.fn(),
  getBenchGoldPageUrl: vi.fn(() => '/api/bench/gold/page?page=1'),
  listAnalysisRuns: vi.fn(() => Promise.resolve({ runs: [] })),
}));

describe('Bench UI (/dashboard/bench)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.listBenchDocuments.mockResolvedValue({
      documents: [{ docId: '1:Podnesak.pdf', fileName: 'Podnesak.pdf', pages: 2 }],
      smokeDocIds: ['1:Podnesak.pdf'],
    });
    apiClient.listBenchModels.mockResolvedValue({
      models: [{ modelId: 'z-ai/glm-5.3-flash' }],
      smokeBudgetUsd: 0.002,
    });
    apiClient.listBenchRuns.mockResolvedValue({
      runs: [{ runId: '2026-11-28T09-00-00-000Z-a1b2c3d4', scope: 'smoke', dryRun: true, actualCost: 0 }],
      activeJobId: null,
    });
    apiClient.listBenchCandidates.mockResolvedValue({
      candidates: [{ id: 'c1', docName: 'Završni račun.pdf:table-21/32/35', triggerReasons: ['total-parts-mismatch'], status: 'pending' }],
    });
    apiClient.getSettings.mockResolvedValue({
      settings: { defaultScanDepth: 'balanced', activeTaskRoutingOverrides: {} },
    });
  });

  test('renders BenchPage with header link, candidates, runs, and dry-run launch', async () => {
    apiClient.launchBenchRun.mockResolvedValue({ jobId: 'job-123' });

    render(<BenchPage />);

    expect(await screen.findByText('Kandidati iz produkcije (bench_candidates)')).toBeInTheDocument();
    expect(await screen.findByText('Završni račun.pdf:table-21/32/35')).toBeInTheDocument();
    expect(await screen.findByText('2026-11-28T09-00-00-000Z-a1b2c3d4')).toBeInTheDocument();

    const benchLinks = screen.getAllByRole('link', { name: 'Bench' });
    expect(benchLinks[0]).toHaveAttribute('href', '/dashboard/bench');

    fireEvent.click(screen.getByRole('button', { name: 'Pokreni Dry-run' }));
    await waitFor(() => {
      expect(apiClient.launchBenchRun).toHaveBeenCalledWith(expect.objectContaining({
        docIds: ['1:Podnesak.pdf'],
        dryRun: true,
      }));
    });
  });

  test('renders BenchRunDetailPage with Stage T provenance and JSON blinded review', async () => {
    apiClient.getBenchRunReport.mockResolvedValue({
      runId: '2026-11-28T09-00-00-000Z-a1b2c3d4',
      scope: 'smoke',
      docs: [{ docId: '1:Podnesak.pdf' }],
      totalPages: 2,
      actualCost: 0.0012,
      rows: [{ docId: '1:Podnesak.pdf', model: 'z-ai/glm-5.3-flash', transcriptSourceArm: 'or-mistral-ocr', status: 'OK', cost: 0.0012 }],
    });
    apiClient.getBenchRunTraces.mockResolvedValue({ traces: [] });
    apiClient.getBenchReview.mockResolvedValue({
      runId: '2026-11-28T09-00-00-000Z-a1b2c3d4',
      items: [{ docId: '1:Podnesak.pdf', title: 'Podnesak.pdf', candidates: [{ label: 'A', text: 'Izlaz A' }] }],
    });

    render(<BenchRunDetailPage />);

    expect(await screen.findByText('or-mistral-ocr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Učitaj uzorak za recenziju' }));
    expect(await screen.findByText('Kandidat A')).toBeInTheDocument();
  });

  test('renders BenchGoldEditorPage with page preview and completeness gate', async () => {
    apiClient.listBenchGoldSets.mockResolvedValue({
      sets: [{ setId: '2026-11-20T14-13-11-497Z-0c71f691', documents: [{ file: 'abc.json', docId: '1:Podnesak.pdf', pages: 2 }] }],
    });
    apiClient.getBenchGoldTemplate.mockResolvedValue({
      template: { document: { docId: '1:Podnesak.pdf', pages: 2 }, facts: { amounts: [] }, reviewedCategories: [] },
      summary: { facts: 0 },
    });

    render(<BenchGoldEditorPage />);

    expect(await screen.findByText('Stranica 1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spremi Gold' })).toBeInTheDocument();

    // Zoom toggle + keyboard navigation
    fireEvent.click(screen.getByRole('button', { name: 'Zoom 100%' }));
    expect(screen.getByRole('button', { name: 'Zoom 150%' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByText('Stranica 2 / 2')).toBeInTheDocument();

    // Invalid JSON validation on save
    fireEvent.change(screen.getByLabelText('Gold facts JSON'), { target: { value: '{bad json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Spremi Gold' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Neispravan JSON/);
  });

  test('renders dynamic model pricing, gbench badge, and structured routing overrides validation', async () => {
    apiClient.listBenchModels.mockResolvedValue({
      models: [
        {
          modelId: 'z-ai/glm-5.3-flash',
          inputUsdPerM: 0.1,
          outputUsdPerM: 0.3,
          gbenchGate: { passed: true },
        },
        {
          modelId: 'google/gemini-2.5-flash',
          inputUsdPerM: 0.15,
          outputUsdPerM: 0.6,
        },
      ],
    });

    render(<BenchPage />);

    expect(await screen.findByText('gbench: PROLAZ')).toBeInTheDocument();
    expect(screen.getByText(/\$0\.10 ulaz \/ \$0\.30 izlaz/)).toBeInTheDocument();

    // Structured stage override select updates JSON and saves
    fireEvent.change(screen.getByLabelText('Ekstrakcija (Stage A)'), { target: { value: 'google/gemini-2.5-flash' } });
    expect(screen.getByLabelText('activeTaskRoutingOverrides JSON').value).toContain('google/gemini-2.5-flash');

    // Invalid JSON in disclosure shows role="alert"
    fireEvent.change(screen.getByLabelText('activeTaskRoutingOverrides JSON'), { target: { value: '{invalid' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/Neispravan JSON/);
  });

  test('renders scorecard matrix, expandable llm_traces, and tie option in blinded review', async () => {
    apiClient.getBenchRunReport.mockResolvedValue({
      runId: '2026-11-28T09-00-00-000Z-a1b2c3d4',
      scope: 'pilot',
      docs: [{ docId: '1:Podnesak.pdf' }],
      totalPages: 2,
      actualCost: 0.015,
      scorecards: [
        {
          model: 'z-ai/glm-5.3-flash',
          costUsd: 0.015,
          overallRecall: 0.92,
          overallPrecision: 0.88,
          buckets: {
            oib: { recall: 1, precision: 1 },
            eur: { recall: 0.9, precision: 0.85 },
          },
        },
      ],
      rows: [{ docId: '1:Podnesak.pdf', model: 'z-ai/glm-5.3-flash', transcriptSourceArm: 'or-mistral-ocr', status: 'OK', cost: 0.015 }],
    });
    apiClient.getBenchRunTraces.mockResolvedValue({
      traces: [
        {
          id: 'tr-1',
          task_type: 'extraction',
          actual_model: 'z-ai/glm-5.3-flash',
          provider: 'openrouter',
          latency_ms: 420,
          cost_usd: 0.0012,
          finish_reason: 'stop',
          cached_tokens: 128,
          reasoning_tokens: 64,
          validation_errors_json: ['missing_oib'],
          raw_response: '{"oib":"123"}',
        },
      ],
    });
    apiClient.getBenchReview.mockResolvedValue({
      runId: '2026-11-28T09-00-00-000Z-a1b2c3d4',
      items: [
        {
          docId: '1:Podnesak.pdf',
          title: 'Podnesak.pdf',
          selectionReasons: ['diff-amount'],
          candidates: [
            { label: 'A', text: 'Izlaz A' },
            { label: 'B', text: 'Izlaz B\ndruga linija' },
          ],
        },
      ],
    });

    render(<BenchRunDetailPage />);

    expect(await screen.findByTestId('bench-scorecard-matrix')).toBeInTheDocument();
    expect(screen.getByText('92% / 88%')).toBeInTheDocument();
    expect(screen.getByText('100% / 100%')).toBeInTheDocument();

    // Expand trace in modal
    fireEvent.click(screen.getByRole('button', { name: 'llm_traces (1)' }));
    fireEvent.click(await screen.findByText(/extraction · z-ai\/glm-5\.3-flash/));
    expect(await screen.findByTestId('bench-trace-detail')).toBeInTheDocument();
    expect(screen.getByText('{"oib":"123"}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zatvori dijalog' }));

    // Blinded review tie option
    fireEvent.click(screen.getByRole('button', { name: 'Učitaj uzorak za recenziju' }));
    expect(await screen.findByLabelText('Jednako / Neodlučno')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Jednako / Neodlučno'));
    expect(screen.getByRole('button', { name: 'Pošalji JSON recenziju' })).not.toBeDisabled();
  });
});
