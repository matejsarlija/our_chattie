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
    const grid = container.querySelector('[aria-labelledby="lab-variant-reports-title"] .grid');
    expect(grid.className).toMatch(/grid-cols-1/);
    expect(grid.className).toMatch(/lg:grid-cols-3/);
    expect(screen.getByText(/Pomaknite tablicu vodoravno/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Mjere usporedbe svih varijanti/ })).toHaveAttribute('tabindex', '0');
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
    const fragmentsTab = screen.getByRole('tab', { name: 'Izvori i tematske grupe' });
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
    fireEvent.click(screen.getByRole('tab', { name: 'Izvori i tematske grupe' }));

    const nodeButtons = await screen.findAllByRole('button', { name: /DAG|Ravni kontekst/ });
    expect(nodeButtons.length).toBeGreaterThan(0);
    for (const button of screen.getAllByRole('button', { name: /DAG|Ravni kontekst|Povezana grupa|Činjenica ostavljena/ })) {
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
    const naCell = screen.getByLabelText(/Činjenice ostavljene odvojeno, Ravni kontekst: Nije primjenjivo/);
    expect(naCell).toHaveAttribute('title', 'Ova varijanta ne grupira činjenice po temama');
  });

  test('scorecard table exposes column headers for each visible profile', async () => {
    renderDetail();
    await screen.findByRole('table');

    expect(screen.getByRole('columnheader', { name: /Ravni kontekst/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Profil DAG · bez sažetaka' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Profil DAG · sa sažecima' })).toBeInTheDocument();
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
            coverage: { groundedClaims: 0, totalClaims: 1, gaps: ['ungrounded:fact-1'] },
            summary: [{ text: 'Sažetak za provjeru', sourceDocumentIds: ['doc-1'], factIds: ['fact-1'], citationIds: ['St-2/2013'] }],
            facts: [{ factId: 'fact-1', sourceId: 'doc-1', fileName: 'Rješenje.pdf', citationIds: ['St-2/2013'], excerpt: 'Izvadak iz čvora', grounded: false }],
          }] },
        },
      },
    };

    const { rerender } = render(<LabFragmentsPane variants={variants} activeProfile="baseline-flat-v1" />);
    expect(screen.getByText('Provjerljivi odlomak')).toBeInTheDocument();
    expect(screen.getByText('Izvadak pronađen u izvornom tekstu.')).toBeInTheDocument();

    rerender(<LabFragmentsPane variants={variants} activeProfile="context-tree-v1" />);
    expect(screen.getAllByText('Izvadak iz čvora')).toHaveLength(2);
    expect(screen.getByText('Sažetak za provjeru')).toBeInTheDocument();
    expect(screen.getByText('Citati koji se podudaraju s tekstom izvora: 0 / 1')).toBeInTheDocument();
    expect(screen.getByText('Za 1 činjenicu nije bilo moguće pronaći pouzdano podudaranje citata s tekstom izvora.')).toBeInTheDocument();
    expect(screen.getAllByText('Izvadak nije potvrđen u izvornom tekstu.')).toHaveLength(1);
    expect(screen.queryByText('ungrounded:fact-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Prikaži stavke za provjeru (1 od 1)'));
    expect(screen.getAllByText('Rješenje.pdf').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Izvadak iz čvora')).toHaveLength(2);
    fireEvent.click(screen.getByText('Tehnički podaci i identifikatori'));
    expect(screen.getByText('St-2/2013')).toBeInTheDocument();
  });

  test('a rejected summary is distinguished from verified source excerpts', () => {
    const variants = {
      'context-tree-summarized-v1': {
        status: 'complete',
        trace: {
          strategy: 'case-context',
          summaries: {
            enabled: true,
            outcomes: [{ nodeId: 'node-verified', status: 'partial', reason: 'invalid-summary' }],
          },
          selection: { selected: [{ nodeId: 'node-verified', kind: 'claim-thread', factIds: ['fact-verified'] }], omitted: [] },
          fragments: {
            contextNodes: [{
              nodeId: 'node-verified',
              kind: 'claim-thread',
              factIds: ['fact-verified'],
              coverage: { groundedClaims: 1, totalClaims: 1, gaps: [] },
              facts: [{ factId: 'fact-verified', fileName: 'Rješenje.pdf', excerpt: 'Provjerljiv izvorni odlomak.', grounded: true }],
            }],
          },
        },
      },
    };

    render(<LabFragmentsPane variants={variants} activeProfile="context-tree-summarized-v1" />);

    expect(screen.getByText('Citati koji se podudaraju s tekstom izvora: 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('Automatski sažetak nije prihvaćen.')).toBeInTheDocument();
    expect(screen.getByText('Odgovor nije imao prihvatljiv format ili poveznice na prepoznate izvore.')).toBeInTheDocument();
    expect(screen.getByText(/odbijanje sažetka ne znači da ti odlomci nisu potvrđeni/)).toBeInTheDocument();
  });

  test('group labels use the full fact total rather than the trace ID cap', () => {
    const factIds = Array.from({ length: 50 }, (_, index) => `fact-${index}`);
    const variants = {
      'context-tree-v1': {
        status: 'complete',
        trace: {
          strategy: 'case-context',
          selection: { selected: [{ nodeId: 'node-capped', kind: 'claim-thread', factIds }], omitted: [] },
          fragments: {
            contextNodes: [{
              nodeId: 'node-capped',
              title: 'Tražbina — redni broj 200',
              kind: 'claim-thread',
              factIds,
              coverage: { groundedClaims: 214, totalClaims: 223, gaps: [] },
              facts: [{ factId: 'fact-0', fileName: 'Podnesak.pdf', excerpt: 'Citirani odlomak.', grounded: true }],
            }],
          },
        },
      },
    };

    render(<LabFragmentsPane variants={variants} activeProfile="context-tree-v1" />);
    expect(screen.getByRole('button', { name: /223 činjenica.*Tražbina — redni broj 200/ })).toBeInTheDocument();
    expect(screen.getAllByText('Povezana grupa tražbina · 223 činjenica')).toHaveLength(2);
    expect(screen.getByText('Izvorni odlomci (1 od 223)')).toBeInTheDocument();
  });
  test('doubtful fragments prominently link to their source document', () => {
    const variants = {
      'baseline-flat-v1': {
        status: 'complete',
        trace: {
          baseline: true,
          fragments: {
            flatClaims: {
              claims: [{
                claimId: 'claim-doubt',
                text: 'Iznos nije siguran.',
                evidence: [{
                  sourceId: 'analysis-1',
                  fileName: 'Rjesenje.pdf',
                  text: 'Navodi se iznos od 25 EUR.',
                  grounded: false,
                }],
              }],
            },
          },
        },
      },
    };

    render(
      <LabFragmentsPane
        variants={variants}
        activeProfile="baseline-flat-v1"
        sourceDocuments={[{
          analysisId: 'analysis-1',
          fileName: 'Rjesenje.pdf',
          url: 'https://court.example.test/rjesenje.pdf',
        }]}
      />
    );

    expect(screen.getByRole('heading', { name: /izvori za provjeru/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /otvori izvorni dokument.*rjesenje.pdf/i }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ href: 'https://court.example.test/rjesenje.pdf' }),
      ]));
  });

  test('a missing topic link does not mislabel a grounded source as needing verification', () => {
    const variants = {
      'context-tree-v1': {
        status: 'complete',
        trace: {
          strategy: 'case-context',
          selection: { selected: [{ nodeId: 'unresolved-1', kind: 'unresolved', factIds: ['fact-1'] }], omitted: [] },
          fragments: { contextNodes: [{
            nodeId: 'unresolved-1',
            kind: 'unresolved',
            factIds: ['fact-1'],
            coverage: { groundedClaims: 1, totalClaims: 1, gaps: ['no stable identifier'] },
            facts: [{ factId: 'fact-1', sourceId: 'doc-1', fileName: 'Rješenje.pdf', excerpt: 'Provjerljiv tekst.', grounded: true }],
          }] },
        },
      },
    };

    render(<LabFragmentsPane variants={variants} activeProfile="context-tree-v1" />);
    expect(screen.queryByTestId('lab-source-review')).not.toBeInTheDocument();
    expect(screen.getByText('Provjerljiv tekst.')).toBeInTheDocument();
    expect(screen.getAllByText(/ostavljena odvojeno/).length).toBeGreaterThan(0);
  });
});
