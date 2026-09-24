/**
 * @jest-environment jsdom
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LabExperimentDetailPage from '../LabExperimentDetailPage';
import LabComparePane from '../LabComparePane';
import LabFragmentsPane from '../LabFragmentsPane';
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

const minimalVariant = (profileId) => ({
  status: 'complete',
  profileSnapshot: { id: profileId },
  report: { narrative: `Tekst ${profileId}.`, findings: [], openQuestions: [], meta: {} },
  trace: { profileId, baseline: profileId === 'baseline-flat-v1' },
  usage: { calls: 1, totalTokens: 100, elapsedMs: 50 },
  deterministicScorecard: {
    version: 1,
    profileId,
    sourceSupport: { reportFindingsWithValidCitations: 0 },
    coverage: {},
    reconciliation: {},
    shape: { unresolvedNodes: profileId === 'baseline-flat-v1' ? 'n/a' : 0 },
    reliability: {},
    cost: {},
  },
});

const response = {
  experiment: {
    id: 'e1',
    status: 'complete',
    evidencePackageRef: 'kerum-lab',
    evidencePackageHash: 'abc123',
    inputSummary: { caseNumber: 'St-2/2013', documents: 3 },
    profiles: ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1'],
    variants: {
      'baseline-flat-v1': minimalVariant('baseline-flat-v1'),
      'context-tree-v1': minimalVariant('context-tree-v1'),
      'context-tree-summarized-v1': minimalVariant('context-tree-summarized-v1'),
    },
  },
  comparison: {
    inputHashMatches: true,
    flatToDag: { from: 'baseline-flat-v1', to: 'context-tree-v1', deltas: [] },
    dagToSummarized: { from: 'context-tree-v1', to: 'context-tree-summarized-v1', deltas: [] },
    summaryIncrementalCost: 'unknown',
  },
};

function renderDetail() {
  getLabExperiment.mockResolvedValue(response);
  return render(<LabExperimentDetailPage />);
}

describe('Analysis Lab responsive + accessibility pass (LU-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('report columns stack on narrow widths and sit side by side on desktop', () => {
    const { container } = render(
      <LabComparePane variants={response.experiment.variants} comparison={response.comparison} onOpenFragments={() => {}} />
    );
    const grid = container.querySelector('.grid');
    expect(grid.className).toMatch(/grid-cols-1/);
    expect(grid.className).toMatch(/lg:grid-cols-3/);
    // Stacked columns keep explicit profile headers (no bare anonymous panes).
    expect(screen.getByLabelText('Izvještaj profila Ravni kontekst')).toBeInTheDocument();
    expect(screen.getByLabelText('Izvještaj profila DAG · bez sažetaka')).toBeInTheDocument();
    expect(screen.getByLabelText('Izvještaj profila DAG · sa sažecima')).toBeInTheDocument();
  });

  test('tabs use tab semantics with aria-selected and keyboard focus', async () => {
    renderDetail();
    await screen.findByLabelText('Zajednički zamrznuti ulaz');

    const tablist = screen.getByRole('tablist', { name: 'Prikazi laboratorija' });
    expect(tablist).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    const compareTab = screen.getByRole('tab', { name: 'Usporedi izvještaje' });
    expect(compareTab).toHaveAttribute('aria-selected', 'true');

    // Tabs are native buttons: keyboard-operable by construction.
    const fragmentsTab = screen.getByRole('tab', { name: 'Fragmenti i dokazi' });
    expect(fragmentsTab.tagName).toBe('BUTTON');
    fragmentsTab.focus();
    expect(document.activeElement).toBe(fragmentsTab);
    fireEvent.click(fragmentsTab);
    expect(fragmentsTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeInTheDocument();
  });

  test('fragment nodes are keyboard-operable buttons with visible focus', async () => {
    renderDetail();
    await screen.findByLabelText('Zajednički zamrznuti ulaz');
    fireEvent.click(screen.getByRole('tab', { name: 'Fragmenti i dokazi' }));

    const nodeButtons = await screen.findAllByRole('button', { name: /DAG|Ravni/ });
    expect(nodeButtons.length).toBeGreaterThan(0);
    for (const button of screen.getAllByRole('button', { name: /kontekst|DAG|Ravni|čvor/i })) {
      expect(button.className).toMatch(/focus-visible/);
    }
  });

  test('no key distinction is colour-only: status, hash, and cells carry text', async () => {
    renderDetail();
    await screen.findByLabelText('Zajednički zamrznuti ulaz');

    // Status badge: icon + text + aria-label.
    const badge = screen.getByLabelText('Status eksperimenta: Dovršeno');
    expect(badge).toHaveTextContent('Dovršeno');

    // Hash state: symbol + words.
    expect(screen.getByLabelText('Hash ulaza odgovara')).toHaveTextContent('hash odgovara');

    // Scorecard N/P cells expose their meaning to assistive tech.
    const naCell = screen.getByLabelText(/Nerazriješene veze, Ravni kontekst: N\/P/);
    expect(naCell).toHaveAttribute('title', 'Nije primjenjivo na ravni profil');
  });

  test('scorecard table exposes column headers for each visible profile', async () => {
    renderDetail();
    await screen.findByRole('table');

    expect(screen.getByRole('columnheader', { name: /Ravni kontekst/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /bez sažetaka/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /sa sažecima/ })).toBeInTheDocument();
  });

  test('fragment inspector renders flat excerpts and context source coverage', () => {
    const variants = {
      'baseline-flat-v1': {
        status: 'complete',
        trace: {
          baseline: true,
          fragments: { flatClaims: { claims: [{ claimId: 'claim-1', text: 'Izvorna tvrdnja', evidence: [{ sourceId: 'doc-1', fileName: 'Rješenje.pdf', text: 'Provjerljivi odlomak', grounded: true }] }], omittedCount: 0 } },
        },
      },
      'context-tree-v1': {
        status: 'complete',
        trace: {
          strategy: 'case-context',
          selection: { selected: [{ nodeId: 'node-1', kind: 'claim-thread', status: 'partial', factIds: ['fact-1'] }], omitted: [] },
          fragments: { contextNodes: [{
            nodeId: 'node-1', kind: 'claim-thread', sourceDocumentIds: ['doc-1'], citationIds: ['St-2/2013'], factIds: ['fact-1'],
            coverage: { groundedClaims: 0, totalClaims: 1, gaps: ['ungrounded-fact'] },
            summary: [{ text: 'Sažetak za provjeru', sourceDocumentIds: ['doc-1'], factIds: ['fact-1'], citationIds: ['St-2/2013'] }],
            facts: [{ factId: 'fact-1', sourceId: 'doc-1', fileName: 'Rješenje.pdf', citationIds: ['St-2/2013'], excerpt: 'Izvadak iz čvora', grounded: false }],
          }] },
        },
      },
    };

    const { rerender } = render(<LabFragmentsPane variants={variants} activeProfile="baseline-flat-v1" />);
    expect(screen.getByText('Provjerljivi odlomak')).toBeInTheDocument();
    expect(screen.getByText('Uzemljenje: potvrđeno')).toBeInTheDocument();

    rerender(<LabFragmentsPane variants={variants} activeProfile="context-tree-v1" />);
    expect(screen.getByText('Izvadak iz čvora')).toBeInTheDocument();
    expect(screen.getByText('Sažetak za provjeru')).toBeInTheDocument();
    expect(screen.getByText('ungrounded-fact')).toBeInTheDocument();
    expect(screen.getAllByText('St-2/2013')).toHaveLength(3);
  });
});
