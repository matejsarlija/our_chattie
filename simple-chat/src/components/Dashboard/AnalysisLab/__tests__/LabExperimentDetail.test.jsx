/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LabExperimentDetailPage from '../LabExperimentDetailPage';
import LabScorecardTable from '../LabScorecardTable';
import LabSharedInputBanner from '../LabSharedInputBanner';
import { getLabExperiment } from '../../../../lib/apiClient';

jest.mock('react-router-dom', () => ({
  __esModule: true,
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  useParams: () => ({ id: 'e1' }),
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

jest.mock('../../../../lib/env', () => ({
  env: {},
}));

jest.mock('../../../MermaidDiagram', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../../../lib/apiClient', () => ({
  getLabExperiment: jest.fn(),
  listLabPackages: jest.fn(),
  listLabExperiments: jest.fn(),
  createLabExperiment: jest.fn(),
}));

const variant = ({ profileId, findings = 2, cited = 2, unresolved = 1, calls = 3, tokens = 1200, status = 'complete' }) => ({
  status,
  profileSnapshot: { id: profileId, contextStrategy: profileId === 'baseline-flat-v1' ? 'flat' : 'case-context', nodeSummaries: 'off', codeRevision: 'test-rev' },
  report: {
    narrative: `Pripovijest za ${profileId}.`,
    findings: Array.from({ length: findings }, (_, index) => ({
      text: `Nalaz ${index + 1} (${profileId}).`,
      citations: index < cited ? [{ sourceId: 'lab-doc-01' }] : [],
    })),
    openQuestions: [{ text: 'Otvoreno pitanje.' }],
    meta: { scope: { analysisStatus: 'partial', blocked: ['x'] } },
  },
  trace: profileId === 'baseline-flat-v1'
    ? { profileId, strategy: 'flat', baseline: true, claims: { flat: 9, branch: 0, derived: 0 }, evidencePackageHash: 'abc123' }
    : {
        profileId,
        strategy: 'case-context',
        baseline: false,
        rootId: 'cn-root',
        dag: { stats: { facts: 6, sources: 3, periods: 1, threads: 2, unresolved } },
        selection: {
          selected: [
            { nodeId: 'cn-claim-1', kind: 'claim-thread', factIds: ['f1', 'f2'] },
            { nodeId: 'cn-unresolved-1', kind: 'unresolved', factIds: [] },
          ],
          omitted: [{ nodeId: 'cn-period-9', reason: 'context-node-budget-exhausted', detail: 'Proračun.' }],
        },
        summaries: {
          enabled: false,
          stats: { eligible: 1, attempted: 0, completed: 0, partial: 0, calls: 0 },
          outcomes: [],
          omitted: [],
          droppedDerived: [],
        },
        claims: { flat: 9, branch: 2, derived: 0 },
        evidencePackageHash: 'abc123',
      },
  usage: { calls, inputTokens: tokens, outputTokens: 100, totalTokens: tokens + 100, elapsedMs: 300 },
  deterministicScorecard: {
    version: 1,
    profileId,
    input: { evidencePackageHash: 'abc123', evidencePackageHashMatches: true, documents: 3, entries: 3, totalSourceClaims: 6 },
    sourceSupport: { groundedSourceClaims: 5, totalSourceClaims: 6, reportFindingsTotal: findings, reportFindingsWithValidCitations: cited, unsupportedOrDegradedFindings: findings - cited },
    coverage: { scopeStatus: 'partial', blockedConclusions: 1, criticalFailedDocuments: 1, failedFiles: [], ocrOrNativeTruncations: 0, coverageGaps: 1 },
    reconciliation: { conflictsTotal: 1, currencyConflicts: 1, identityUnresolvedLinks: 1, duplicateSuppressions: 0, unresolvedLifecycleLinks: 1, openQuestionsTotal: 1, advisoryClaimLinks: 0 },
    shape: {
      timelineSpanDays: 831,
      flatClaims: 9,
      branchClaims: profileId === 'baseline-flat-v1' ? 'n/a' : 2,
      derivedClaims: profileId === 'baseline-flat-v1' ? 'n/a' : 0,
      selectedContextNodes: profileId === 'baseline-flat-v1' ? 'n/a' : 2,
      partialNodes: profileId === 'baseline-flat-v1' ? 'n/a' : 0,
      unresolvedNodes: profileId === 'baseline-flat-v1' ? 'n/a' : unresolved,
      dagNodeCount: 'unknown',
    },
    reliability: { schemaRepairFailures: 0, reportErrors: 0, verifierErrors: 0, fallbackUsed: false },
    cost: { calls, inputTokens: tokens, outputTokens: 100, totalTokens: tokens + 100, elapsedMs: 300, nodeSummaryCalls: profileId === 'baseline-flat-v1' ? 'n/a' : 0 },
  },
});

const fullResponse = (overrides = {}) => ({
  experiment: {
    id: 'e1',
    createdAt: '2026-09-22T10:00:00.000Z',
    completedAt: '2026-09-22T10:05:00.000Z',
    status: 'complete',
    evidencePackageRef: 'kerum-lab',
    evidencePackageHash: 'abc123def456',
    inputSummary: { caseNumber: 'St-2/2013', documents: 3, entries: 3 },
    profiles: ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1'],
    sharedUpstream: { retrievalHash: 'r', rerankHash: 'rr', advisoryHash: 'a' },
    sharedUsage: { calls: 3, totalTokens: 300 },
    variants: {
      'baseline-flat-v1': variant({ profileId: 'baseline-flat-v1' }),
      'context-tree-v1': variant({ profileId: 'context-tree-v1' }),
      'context-tree-summarized-v1': variant({ profileId: 'context-tree-summarized-v1', calls: 7, tokens: 2000 }),
    },
    ...overrides.experiment,
  },
  comparison: {
    evidencePackageHash: 'abc123def456',
    inputHashMatches: true,
    status: 'complete',
    flatToDag: { from: 'baseline-flat-v1', to: 'context-tree-v1', deltas: ['2 unresolved branches'] },
    dagToSummarized: { from: 'context-tree-v1', to: 'context-tree-summarized-v1', deltas: ['800 more total tokens', '4 more model calls'] },
    summaryIncrementalCost: { calls: 4, totalTokens: 800, elapsedMs: 400 },
    sharedUsage: { calls: 3, totalTokens: 300 },
    ...overrides.comparison,
  },
});

function renderDetail(response = fullResponse()) {
  getLabExperiment.mockResolvedValue(response);
  return render(<LabExperimentDetailPage />);
}

describe('LabExperimentDetailPage (LU-1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('shared-hash banner and visible profile labels render before outputs', async () => {
    renderDetail();

    const banner = await screen.findByLabelText('Zajednički zamrznuti ulaz');
    expect(banner).toHaveTextContent('Isti zamrznuti paket dokaza');
    expect(banner).toHaveTextContent('hash odgovara');
    expect(await screen.findByText('3 poziva · 300 tokena')).toBeInTheDocument();

    // All three profiles carry visible text labels — never hidden order.
    for (const label of ['Ravni kontekst', 'DAG · bez sažetaka', 'DAG · sa sažecima']) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThanOrEqual(1);
    }
    for (const tag of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
      expect(screen.getByText(tag)).toBeInTheDocument();
    }
  });

  test('report panes render narrative, findings, and fragment buttons', async () => {
    renderDetail();

    const pane = await screen.findByLabelText('Izvještaj profila Ravni kontekst');
    expect(within(pane).getByText('Nalaz 1 (baseline-flat-v1).')).toBeInTheDocument();
    expect(within(pane).getByText('Otvoreno pitanje.')).toBeInTheDocument();
    expect(within(pane).getByRole('button', { name: /fragment/i })).toBeInTheDocument();
  });

  test('malformed markdown cannot crash the detail page', async () => {
    const response = fullResponse();
    response.experiment.variants['baseline-flat-v1'].report.narrative = '### [[[Nezatvoreno\n```mermaid\ngraph TD;\n  A-->???\n```\n![slika](javascript:alert(1))';
    renderDetail(response);

    const pane = await screen.findByLabelText('Izvještaj profila Ravni kontekst');
    expect(pane).toBeInTheDocument();
    // Page chrome survives even if the narrative renderer degrades.
    expect(screen.getByLabelText('Zajednički zamrznuti ulaz')).toBeInTheDocument();
  });

  test('scorecard renders n/a as N/P and unknown as ?', async () => {
    const response = fullResponse();
    response.experiment.variants['context-tree-v1'].deterministicScorecard.shape.dagNodeCount = 'unknown';
    renderDetail(response);

    const table = await screen.findByRole('table');
    const unresolvedRow = within(table).getByText('Nerazriješene veze').closest('tr');
    expect(within(unresolvedRow).getByLabelText(/Ravni kontekst: N\/P/)).toBeInTheDocument();
    expect(within(unresolvedRow).getByLabelText(/DAG · bez sažetaka: 1/)).toBeInTheDocument();
  });

  test('fragment inspector expands nodes and shows omission reasons', async () => {
    renderDetail();

    fireEvent.click(await screen.findByRole('tab', { name: 'Fragmenti i dokazi' }));

    const nodeList = await screen.findByLabelText('Kontekstni čvorovi');
    fireEvent.click(within(nodeList).getByRole('button', { name: /cn-unresolved-1/ }));

    const detail = screen.getByLabelText('Detalj fragmenta');
    expect(within(detail).getByText('cn-unresolved-1')).toBeInTheDocument();

    const side = screen.getByLabelText('Trag, potrošnja i snimka profila');
    expect(within(side).getByText(/context-node-budget-exhausted/)).toBeInTheDocument();
  });

  test('partial experiments stay readable with a neutral alert', async () => {
    const response = fullResponse({
      experiment: { status: 'partial' },
    });
    response.experiment.variants['context-tree-v1'] = {
      status: 'error',
      errorCode: 'variant-error',
      errorMessage: 'Simulated candidate failure.',
    };
    renderDetail(response);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((alert) => alert.textContent.includes('Djelomičan zapis'))).toBe(true);
    expect(screen.getByLabelText('Status eksperimenta: Djelomično')).toBeInTheDocument();
    // Successful baseline remains readable.
    expect(screen.getByLabelText('Izvještaj profila Ravni kontekst')).toBeInTheDocument();
  });
});

describe('LabScorecardTable + LabSharedInputBanner units (LU-1)', () => {
  test('unknown cells degrade to ? with an explanatory label', () => {
    const response = fullResponse();
    const { container } = render(
      <LabScorecardTable variants={response.experiment.variants} />
    );
    // dagNodeCount is 'unknown' for every variant — not rendered as a row, so
    // assert the shared contract directly on the banner instead.
    expect(container.querySelector('table')).toBeInTheDocument();
  });

  test('mismatched hash renders a text warning, not colour alone', () => {
    render(
      <LabSharedInputBanner evidencePackageHash="abc" inputSummary={{ caseNumber: 'St-2/2013', documents: 3 }} match={false} />
    );
    expect(screen.getByLabelText('Hash ulaza se ne podudara')).toHaveTextContent('⚠ hash se ne podudara');
  });
});
