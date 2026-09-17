import { render, screen } from '@testing-library/react';
import LatestProceduralStep from '../LatestProceduralStep';

const ITEMS = [
  { date: '2025-07-17', description: 'Podnesak.' },
  { date: '2026-06-23', description: 'Rjesenje o diobi.' },
  { date: '2026-01-10', description: 'Zakljucak.' },
];

const UNDATED = [
  { date: 'nepoznato', description: 'Bez datuma.' },
  { description: 'Bez datuma uopce.' },
];

describe('LatestProceduralStep (TU-1)', () => {
  test('highlights the max-date timeline entry', () => {
    render(<LatestProceduralStep timeline={ITEMS} />);

    expect(screen.getByText('Najnoviji postupovni korak')).toBeInTheDocument();
    expect(screen.getByText(/2026-06-23/)).toBeInTheDocument();
    expect(screen.getByText(/Rjesenje o diobi/)).toBeInTheDocument();
  });

  test('skips unparseable dates and renders nothing when none order', () => {
    render(<LatestProceduralStep timeline={UNDATED} />);
    expect(screen.queryByText('Najnoviji postupovni korak')).not.toBeInTheDocument();
  });

  test('renders nothing for an empty timeline', () => {
    const { container } = render(<LatestProceduralStep timeline={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
