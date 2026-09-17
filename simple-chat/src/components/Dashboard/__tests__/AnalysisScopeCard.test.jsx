import { render, screen } from '@testing-library/react';
import AnalysisScopeCard from '../AnalysisScopeCard';

describe('AnalysisScopeCard', () => {
  test('renders the persisted conclusion contract and its limits', () => {
    render(<AnalysisScopeCard scope={{
      analysisStatus: 'partial',
      supported: ['docket_timeline', 'documented_claims'],
      blocked: ['full_case_outcome'],
      blockingEvidence: [{ category: 'full_case_outcome', reason: 'partial-corpus' }],
      degraded: [{ condition: 'rerank-fallback', reason: 'lexical retrieval served the run' }],
      corpus: {
        analyzed: 57, total: 63, capturedEntries: 40, totalResults: 381, selectedCase: 'ST-2/2013', dateRange: { oldestEntryDate: '2025-07-17', newestEntryDate: '2026-06-23' },
        coverageLedger: { selected: 40, available: 343, gaps: ['2019: 0/2 selected'] }
      },
    }} />);

    expect(screen.getByRole('heading', { name: 'Što dokazi u ovoj analizi mogu potvrditi' })).toBeInTheDocument();
    expect(screen.getByText('Djelomična analiza')).toBeInTheDocument();
    expect(screen.getByText('57 / 63')).toBeInTheDocument();
    expect(screen.getByText('2025-07-17 — 2026-06-23')).toBeInTheDocument();
    expect(screen.getByText(/Cjelovit ishod predmeta: Nije obuhvaćen cijeli pronađeni korpus/)).toBeInTheDocument();
    expect(screen.getByText(/lexical retrieval served the run/)).toBeInTheDocument();
    expect(screen.getByText(/40 \/ 343 unosa odabrano stratificirano/)).toBeInTheDocument();
    expect(screen.getByText(/Praznine uzorka: 2019: 0\/2 selected/)).toBeInTheDocument();
  });

  test('does not render for reports created before the scope contract', () => {
    const { container } = render(<AnalysisScopeCard scope={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('renders the current-status chronology blockers in Croatian', () => {
    render(<AnalysisScopeCard scope={{
      analysisStatus: 'partial',
      supported: ['docket_timeline', 'documented_claims'],
      blocked: ['current_procedural_status'],
      blockingEvidence: [
        { category: 'current_procedural_status', reason: 'latest-entry-not-analyzed' },
        { category: 'current_procedural_status', reason: 'newer-evidence-unavailable' },
      ],
      degraded: [],
      corpus: { analyzed: 2, total: 3 },
    }} />);

    expect(screen.getByText(/Trenutačni procesni status: Najnoviji unos nije analiziran/)).toBeInTheDocument();
    expect(screen.getByText(/Trenutačni procesni status: Noviji dokazi nisu dostupni/)).toBeInTheDocument();
  });
});
