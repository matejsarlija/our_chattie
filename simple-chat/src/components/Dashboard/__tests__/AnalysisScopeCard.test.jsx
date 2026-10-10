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

    expect(screen.getByRole('heading', { name: 'Opseg analize' })).toBeInTheDocument();
    expect(screen.getByText('Djelomično')).toBeInTheDocument();
    // Every one of the contract's four conclusions is listed, so an unlisted
    // one is visible rather than silently absent.
    expect(screen.getByText('Tijek predmeta')).toBeInTheDocument();
    expect(screen.getByText('Dokumentirane tražbine')).toBeInTheDocument();
    expect(screen.getByText('Cjelovit ishod predmeta')).toBeInTheDocument();
    expect(screen.getByText(/2 od 4 zaključaka potkrijepljeno/)).toBeInTheDocument();
  });

  test('renders the blocker reason in Croatian under its blocked conclusion', () => {
    render(<AnalysisScopeCard scope={{
      analysisStatus: 'partial',
      supported: [],
      blocked: ['full_case_outcome'],
      blockingEvidence: [{ category: 'full_case_outcome', reason: 'partial-corpus' }],
      degraded: [{ condition: 'rerank-fallback', reason: 'lexical retrieval served the run' }],
      corpus: { analyzed: 57, total: 63 },
    }} />);

    // Category and reason are separate elements now, so they are asserted
    // separately rather than as one joined string.
    expect(screen.getByText('Cjelovit ishod predmeta')).toBeInTheDocument();
    expect(screen.getByText('nije obuhvaćen cijeli pronađeni korpus')).toBeInTheDocument();
    expect(screen.getByText(/lexical retrieval served the run/)).toBeInTheDocument();
  });

  test('surfaces the sampling ledger and its gaps', () => {
    render(<AnalysisScopeCard scope={{
      analysisStatus: 'partial',
      supported: ['docket_timeline'],
      blocked: [],
      corpus: {
        analyzed: 57, total: 63,
        coverageLedger: { selected: 40, available: 343, gaps: ['2019: 0/2 selected'] },
      },
    }} />);
    expect(screen.getByText(/40 \/ 343 unosa odabrano stratificirano/)).toBeInTheDocument();
    expect(screen.getByText(/praznine: 2019: 0\/2 selected/)).toBeInTheDocument();
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
      ],
      degraded: [],
      corpus: { analyzed: 2, total: 3 },
    }} />);

    expect(screen.getByText('Trenutačni procesni status')).toBeInTheDocument();
    expect(screen.getByText('najnoviji unos nije analiziran')).toBeInTheDocument();
  });

  // Regression: the old card painted `border-l-4 border-l-amber-500`
  // UNCONDITIONALLY, so a run with full coverage still got the amber
  // "this is degraded" edge on its left side.
  test('does not paint a degraded edge on a fully supported run', () => {
    const { container } = render(<AnalysisScopeCard scope={{
      analysisStatus: 'sufficient',
      supported: ['docket_timeline', 'documented_claims', 'current_procedural_status', 'full_case_outcome'],
      blocked: [],
      blockingEvidence: [],
      degraded: [],
      corpus: { analyzed: 10, total: 10 },
    }} />);

    expect(container.querySelector('.border-l-4')).toBeNull();
    expect(container.querySelector('.border-l-amber-500')).toBeNull();
    expect(screen.getByText('4 od 4 zaključaka potkrijepljeno')).toBeInTheDocument();
  });

  test('marks a blocked conclusion with a warning glyph, not an alarm fill', () => {
    const { container } = render(<AnalysisScopeCard scope={{
      analysisStatus: 'partial',
      supported: ['docket_timeline'],
      blocked: ['full_case_outcome'],
      blockingEvidence: [{ category: 'full_case_outcome', reason: 'partial-corpus' }],
      corpus: { analyzed: 1, total: 2 },
    }} />);
    expect(screen.getByText('Cjelovit ishod predmeta')).toBeInTheDocument();
    // no amber-filled row anywhere in the card
    expect(container.querySelector('.bg-amber-50')).toBeNull();
  });
});