import { fireEvent, render, screen } from '@testing-library/react';
import CaseTimeline from '../CaseTimeline';

const TIMELINE = [
  {
    date: '2018-11-02',
    description: 'Stečajni postupak KERUM d.o.o. otvoren.',
    citations: [{ source: 'doc-1', fileName: 'Rješenje_o_otvaranju.pdf', page: 1 }],
  },
  {
    date: '2025-12-17',
    description: 'TS Split donio rješenje o završnoj diobi.',
    citations: [{ source: 'doc-2', fileName: 'Rjesenje_o_diobi.pdf' }],
  },
  {
    date: '2026-01-27',
    description: 'Završno ročište zakazano.',
    citations: [],
  },
];

describe('CaseTimeline', () => {
  test('renders every recorded event, not just the latest', () => {
    render(<CaseTimeline timeline={TIMELINE} />);
    expect(screen.getByText('Kronologija predmeta')).toBeInTheDocument();
    expect(screen.getByText('3 događaja')).toBeInTheDocument();
    expect(screen.getByText('Stečajni postupak KERUM d.o.o. otvoren.')).toBeInTheDocument();
    expect(screen.getByText('TS Split donio rješenje o završnoj diobi.')).toBeInTheDocument();
    expect(screen.getByText('Završno ročište zakazano.')).toBeInTheDocument();
  });

  test('paginates long chronologies while keeping every event reachable', () => {
    const timeline = Array.from({ length: 25 }, (_, index) => ({
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      description: `Događaj ${index + 1}.`,
      citations: [],
    }));
    render(<CaseTimeline timeline={timeline} />);

    expect(screen.getByText('Događaj 1.')).toBeInTheDocument();
    expect(screen.queryByText('Događaj 11.')).not.toBeInTheDocument();
    expect(screen.getByText('Prikaz 1–10 od 25 događaja')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sljedeća' }));
    expect(screen.queryByText('Događaj 1.')).not.toBeInTheDocument();
    expect(screen.getByText('Događaj 11.')).toBeInTheDocument();
    expect(screen.getByText('Prikaz 11–20 od 25 događaja')).toBeInTheDocument();
  });

  test('renders in chronological order as delivered by the pipeline', () => {
    const { container } = render(<CaseTimeline timeline={TIMELINE} />);
    const text = container.textContent;
    expect(text.indexOf('otvoren')).toBeLessThan(text.indexOf('diobi'));
    expect(text.indexOf('diobi')).toBeLessThan(text.indexOf('Završno ročište'));
  });

  // The component must NOT re-sort. buildTimeline already applied the
  // deterministic order, and a second sort with a different comparator is how
  // the pipeline's chronology guarantee would quietly break.
  test('does not reorder the events it is given', () => {
    const reversed = [TIMELINE[2], TIMELINE[1], TIMELINE[0]];
    const { container } = render(<CaseTimeline timeline={reversed} />);
    const text = container.textContent;
    expect(text.indexOf('Završno ročište')).toBeLessThan(text.indexOf('otvoren'));
  });

  test('shows each event citation through the shared citation list', () => {
    render(<CaseTimeline timeline={TIMELINE} />);
    expect(screen.getByText('doc-1 | Rješenje_o_otvaranju.pdf | str. 1')).toBeInTheDocument();
    expect(screen.getByText('doc-2 | Rjesenje_o_diobi.pdf')).toBeInTheDocument();
    // one citation surface, not a second hand-rolled renderer
    expect(screen.getAllByTestId('citation-list')).toHaveLength(2);
  });

  // An undated event is still recorded evidence. Dropping it would hide it.
  test('keeps undated events and labels them, rather than hiding or inventing a date', () => {
    const { container } = render(
      <CaseTimeline
        timeline={[
          { date: '2026-01-27', description: 'Zakazano.', citations: [] },
          { description: 'Objava bez datuma.', citations: [] },
        ]}
      />
    );
    expect(screen.getByText('Objava bez datuma.')).toBeInTheDocument();
    expect(screen.getByText('Bez datuma')).toBeInTheDocument();
    expect(screen.getByText('1 od 2 događaja s datumom')).toBeInTheDocument();
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  test('renders nothing when there is no chronology', () => {
    const { container } = render(<CaseTimeline timeline={[]} />);
    expect(container).toBeEmptyDOMElement();
    const { container: nullish } = render(<CaseTimeline timeline={null} />);
    expect(nullish).toBeEmptyDOMElement();
  });

  test('malformed entries render a dash rather than crashing', () => {
    const { container } = render(
      <CaseTimeline timeline={[null, {}, { date: 'not-a-date', description: '' }]} />
    );
    expect(screen.getByTestId('case-timeline')).toBeInTheDocument();
    expect(container.textContent).toContain('Bez datuma');
  });
});