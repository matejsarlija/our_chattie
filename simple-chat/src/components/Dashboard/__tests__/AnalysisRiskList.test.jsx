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

    expect(screen.getByText('Rizici i otvorena pitanja')).toBeInTheDocument();
    expect(screen.getByText('Različiti iznosi za istu namjenu.')).toBeInTheDocument();
    expect(screen.getByText('Moguće povezane tvrdnje.')).toBeInTheDocument();
    expect(screen.getByText('Aritmetika')).toBeInTheDocument();
    expect(screen.getByText('Životni ciklus')).toBeInTheDocument();
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
  });

  test('badges render only on ranked items with the heuristic label', () => {
    render(<AnalysisRiskList
      conflicts={[conflict({ heuristicRank: { rank: 1, significance: 'high', reason: 'Dioba.' } })]}
      openQuestions={[question()]}
    />);

    expect(screen.getByText(/Visok značaj \(#1\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/heuristika/)).toHaveLength(1);
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
    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(2);

    const { container } = render(<AnalysisRiskList conflicts={[]} openQuestions={[]} />);
    expect(container).toBeEmptyDOMElement();

    render(<AnalysisRiskList conflicts={[]} openQuestions={[]} hasStructuredReport />);
    expect(screen.getByText('Nema utvrđenih rizika ni otvorenih pitanja.')).toBeInTheDocument();
  });
});
