import { render, screen, fireEvent } from '@testing-library/react';
import AnalysisRiskList from '../AnalysisRiskList';

const conflict = (overrides = {}) => ({
  finding: 'Različiti iznosi za istu namjenu.',
  kind: 'arithmetic',
  source: 'reconciliation',
  ...overrides,
});

const question = (overrides = {}) => ({
  text: 'Moguće povezane tvrdnje.',
  kind: 'lifecycle',
  source: 'reconciliation',
  ...overrides,
});

describe('AnalysisRiskList', () => {
  test('merges conflicts and questions in report order with kind tags', () => {
    render(<AnalysisRiskList conflicts={[conflict()]} openQuestions={[question()]} />);

    expect(screen.getByText('Konflikti i pitanja')).toBeInTheDocument();
    expect(screen.getByText('Različiti iznosi za istu namjenu.')).toBeInTheDocument();
    expect(screen.getByText('Moguće povezane tvrdnje.')).toBeInTheDocument();
    expect(screen.getByText('Aritmetika')).toBeInTheDocument();
    expect(screen.getByText('Životni ciklus tražbine')).toBeInTheDocument();
  });

  test('ignores retired ranking annotations and keeps every item visible in report order', () => {
    const { container } = render(<AnalysisRiskList
      conflicts={[
        conflict({ finding: 'Prvi sukob.', heuristicRank: { rank: 2, significance: 'low' } }),
        conflict({ finding: 'Drugi sukob.', heuristicRank: { rank: 1, significance: 'high' } }),
      ]}
      openQuestions={[question({ text: 'Treće pitanje.', claimJudge: { verdict: 'same' } })]}
    />);

    const items = [...container.querySelectorAll('ol > li')].map((item) => item.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toContain('Prvi sukob.');
    expect(items[1]).toContain('Drugi sukob.');
    expect(items[2]).toContain('Treće pitanje.');
    expect(screen.queryByText(/AI procjena|značaj|ista tražbina/)).not.toBeInTheDocument();
    expect(screen.getByText('Stavke su prikazane redoslijedom izvještaja.')).toBeInTheDocument();
  });

  test('renders large risk lists incrementally', () => {
    const conflicts = Array.from({ length: 24 }, (_, index) => conflict({ finding: `Sukob ${index + 1}.` }));
    render(<AnalysisRiskList conflicts={conflicts} openQuestions={[]} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Prikaži još 10 stavki' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Prikaži još 4 stavke' })).toBeInTheDocument();
  });

  test('malformed items fall back to dashes, empty lists hide without a report', () => {
    render(<AnalysisRiskList conflicts={[{}]} openQuestions={[{}]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);

    const { container } = render(<AnalysisRiskList conflicts={[]} openQuestions={[]} />);
    expect(container).toBeEmptyDOMElement();

    render(<AnalysisRiskList conflicts={[]} openQuestions={[]} hasStructuredReport />);
    expect(screen.getByText('Nema utvrđenih konflikata ni otvorenih pitanja.')).toBeInTheDocument();
  });

  test('shows conflict type, recorded origin, and linked source documents', () => {
    render(<AnalysisRiskList
      conflicts={[{
        finding: 'Podaci o istoj imovini odstupaju.',
        kind: 'property',
        source: 'reconciliation',
        sources: ['analysis-1'],
      }]}
      openQuestions={[{ text: 'Pitanje bez podrijetla u zapisu.' }]}
      sourceDocuments={[{
        id: 'analysis-1',
        fileName: 'Rješenje.pdf',
        url: 'https://court.example.test/Rjesenje.pdf',
      }]}
    />);

    expect(screen.getByText('Imovina')).toBeInTheDocument();
    expect(screen.getByText('Determinističko usklađivanje')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Rješenje.pdf' })).toHaveAttribute(
      'href',
      'https://court.example.test/Rjesenje.pdf',
    );
    expect(screen.getByText('Izvor nije zabilježen')).toBeInTheDocument();
  });

  test('renders both sides of a currency conflict verbatim', () => {
    render(<AnalysisRiskList
      conflicts={[{
        kind: 'arithmetic',
        finding: 'Valutni konflikt: 9.084.692,55 HRK prema 1.205.850,44 EUR.',
        amounts: [{ value: 9084692.55, currency: 'HRK' }, { value: 1205850.44, currency: 'EUR' }],
      }]}
      openQuestions={[]}
    />);
    const chips = [...document.querySelectorAll('span.rounded.border')].map((element) => element.textContent);
    expect(chips).toEqual(expect.arrayContaining([
      expect.stringMatching(/9\.084\.692,55 HRK/),
      expect.stringMatching(/1\.205\.850,44/),
    ]));
  });
});
