import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BenchPage from '../BenchPage';
import BenchRunDetailPage from '../BenchRunDetailPage';
import BenchGoldEditorPage from '../BenchGoldEditorPage';
import * as apiClient from '../../../lib/apiClient';

jest.mock('../../../lib/env', () => ({ env: { apiUrl: '/api' } }));

jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useNavigate: () => jest.fn(),
  useParams: () => ({ runId: '2026-11-28T09-00-00-000Z-a1b2c3d4' }),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

jest.mock('../../../lib/apiClient', () => ({
  resolveApiUrl: (u) => u,
  listBenchDocuments: jest.fn(),
  listBenchModels: jest.fn(),
  listBenchRuns: jest.fn(),
  listBenchCandidates: jest.fn(),
  seedBenchCandidates: jest.fn(),
  runCandidateMicroBench: jest.fn(),
  launchBenchRun: jest.fn(),
  cancelBenchJob: jest.fn(),
  runGbenchGate: jest.fn(),
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
  getBenchRunReport: jest.fn(),
  getBenchRunTraces: jest.fn(),
  getBenchReview: jest.fn(),
  submitBenchReview: jest.fn(),
  listBenchGoldSets: jest.fn(),
  getBenchGoldTemplate: jest.fn(),
  saveBenchGoldTemplate: jest.fn(),
  suggestBenchGold: jest.fn(),
  getBenchGoldPageUrl: jest.fn(() => '/api/bench/gold/page?page=1'),
  listAnalysisRuns: jest.fn(() => Promise.resolve({ runs: [] })),
}));

describe('Bench UI (/dashboard/bench)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });
});
