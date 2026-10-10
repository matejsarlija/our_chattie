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

describe('AnalysisRiskList (TU-1 merged severity-ranked surface)', () => {
  test('merges conflicts and questions into one ordered list with kind tags', () => {
    render(<AnalysisRiskList
      conflicts={[conflict()]}
      openQuestions={[question()]}
    />);

    expect(screen.getByText('Konflikti i pitanja')).toBeInTheDocument();
    expect(screen.getByText('Različiti iznosi za istu namjenu.')).toBeInTheDocument();
    expect(screen.getByText('Moguće povezane tvrdnje.')).toBeInTheDocument();
    expect(screen.getByText('Aritmetika')).toBeInTheDocument();
    expect(screen.getByText('Životni ciklus tražbine')).toBeInTheDocument();
  });

  test('orders high, then unranked, then medium, then low — conflicts before questions', () => {
    const { container } = render(<AnalysisRiskList
      conflicts={[
        conflict({ finding: 'Niski sukob.', heuristicRank: { rank: 3, significance: 'low', reason: 'Rubno.' } }),
        conflict({ finding: 'Visoki sukob.', heuristicRank: { rank: 1, significance: 'high', reason: 'Dioba.' } }),
      ]}
      openQuestions={[
        question({ text: 'Srednje pitanje.', heuristicRank: { rank: 2, significance: 'medium', reason: 'Provjera.' } }),
        question({ text: 'Neocijenjeno pitanje.' }),
      ]}
    />);

    const items = [...container.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(/Visoki sukob/);
    expect(items[1]).toMatch(/Neocijenjeno pitanje/);
    expect(items[2]).toMatch(/Srednje pitanje/);
    // Low tier is gated behind the expander, not filtered silently.
    expect(screen.getByRole('button', { name: /Prikaži manje značajne \(1\)/ })).toBeInTheDocument();
    expect(screen.queryByText(/Niski sukob/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Prikaži manje značajne/ }));
    expect(screen.getByText(/Niski sukob/)).toBeInTheDocument();
    expect([...container.querySelectorAll('li')]).toHaveLength(4);
    expect(screen.getByText('AI procjena · nizak značaj (#3)')).toBeInTheDocument();
  });

  test('renders large risk lists incrementally instead of mounting every row', () => {
    const conflicts = Array.from({ length: 24 }, (_, index) => conflict({ finding: `Sukob ${index + 1}.` }));
    render(<AnalysisRiskList conflicts={conflicts} openQuestions={[]} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Prikaži još 10 stavki' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Prikaži još 4 stavke' })).toBeInTheDocument();
  });
  test('identifies report order when no significance ratings are present', () => {
    render(<AnalysisRiskList conflicts={[conflict()]} openQuestions={[]} />);

    expect(screen.getByText(/redoslijed izvještaja/)).toBeInTheDocument();
    expect(screen.getByText(/AI procjena, kada postoji/)).toBeInTheDocument();
  });


  test('badges render only on ranked items and describe tier grouping accurately', () => {
    render(<AnalysisRiskList
      conflicts={[conflict({ heuristicRank: { rank: 1, significance: 'high', reason: 'Dioba.' } })]}
      openQuestions={[question()]}
    />);

    expect(screen.getByText(/AI procjena · visok značaj \(#1\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/Razlog AI procjene značaja/)).toHaveLength(1);
    expect(screen.getByText(/grupirano po procjeni značaja/)).toBeInTheDocument();
  });

  test('judge verdicts render as compact same/different notes, uncertain stays silent', () => {
    render(<AnalysisRiskList
      conflicts={[conflict({ claimJudge: { verdict: 'same', confidence: 'high', reasons: 'Isti dužnik.' } })]}
      openQuestions={[question({ claimJudge: { verdict: 'different', confidence: 'medium', reasons: 'Drugi dužnik.' } })]}
    />);

    expect(screen.getByText(/procjena: ista tražbina/)).toBeInTheDocument();
    expect(screen.getByText(/procjena: različite tražbine/)).toBeInTheDocument();
  });

  test('malformed items fall back to dashes, empty lists hide without a report', () => {
    render(<AnalysisRiskList conflicts={[{}]} openQuestions={[{}]} />);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);

    const { container } = render(<AnalysisRiskList conflicts={[]} openQuestions={[]} />);
    expect(container).toBeEmptyDOMElement();

    render(<AnalysisRiskList conflicts={[]} openQuestions={[]} hasStructuredReport />);
    expect(screen.getByText('Nema utvrđenih konflikata ni otvorenih pitanja.')).toBeInTheDocument();
  });

  // The audit's finding: every item was an amber-filled box, so a high-severity
  // conflict and a low-severity one rendered identically. Severity now reads
  // from the rail weight AND the label.
  test('severity is distinguishable between tiers, not one uniform amber box', () => {
    const { container } = render(<AnalysisRiskList
      conflicts={[
        conflict({ finding: 'Visoki sukob.', heuristicRank: { rank: 1, significance: 'high', reason: 'Dioba.' } }),
        conflict({ finding: 'Srednji sukob.', heuristicRank: { rank: 2, significance: 'medium', reason: 'Provjera.' } }),
        conflict({ finding: 'Neocijenjeni sukob.' }),
      ]}
      openQuestions={[]}
    />);

    const rows = [...container.querySelectorAll('ol > li')];
    const rails = rows.map((row) => row.className);
    expect(new Set(rails).size).toBe(3);

    expect(screen.getByText(/AI procjena · visok značaj/)).toBeInTheDocument();
    expect(screen.getByText(/AI procjena · srednji značaj/)).toBeInTheDocument();
    expect(screen.getByText('Bez procjene značaja')).toBeInTheDocument();

    // and none of the severity rails is an alarm fill
    expect(container.querySelector('.bg-amber-50')).toBeNull();
    expect(container.querySelector('.bg-amber-100')).toBeNull();
  });
  test('shows accurate conflict type, recorded origin, and linked source documents', () => {
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
    const chips = [...document.querySelectorAll('span.rounded.border')].map((el) => el.textContent);
    expect(chips).toEqual(expect.arrayContaining([
      expect.stringMatching(/9\.084\.692,55 HRK/),
      expect.stringMatching(/1\.205\.850,44/),
    ]));
  });
});
