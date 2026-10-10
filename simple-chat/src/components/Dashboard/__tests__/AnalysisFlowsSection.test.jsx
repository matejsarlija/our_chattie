import { fireEvent, render, screen } from '@testing-library/react';
import AnalysisCoverageBanner from '../AnalysisCoverageBanner';
import AnalysisFlowsSection from '../AnalysisFlowsSection';

describe('grounding + property-flow UI surfacing', () => {
  test('coverage banner shows grounded-claims counts when present', () => {
    render(
      <AnalysisCoverageBanner
        coverage={{ analyzed: 3, failed: 0, total: 3, coverageRatio: 1, complete: true, failedFiles: [], groundedClaims: 11, totalClaims: 14 }}
      />
    );
    expect(screen.getByTestId('grounding-banner')).toHaveTextContent('11/14 navoda potvrđeno u izvornom tekstu');
  });

  test('coverage banner omits grounding line for pre-migration coverage', () => {
    render(
      <AnalysisCoverageBanner
        coverage={{ analyzed: 2, failed: 1, total: 3, coverageRatio: 0.67, complete: false, failedFiles: [] }}
      />
    );
    expect(screen.queryByTestId('grounding-banner')).not.toBeInTheDocument();
  });

  test('coverage banner states document counts and failures', () => {
    render(
      <AnalysisCoverageBanner
        coverage={{ analyzed: 57, failed: 6, total: 63, coverageRatio: 0.9, complete: false, failedFiles: [] }}
      />
    );
    expect(screen.getByText('Pokrivenost analize')).toBeInTheDocument();
    expect(screen.getByText(/57 od 63 dokumenata · 6 nije uspjelo/)).toBeInTheDocument();
  });

  test('coverage banner identifies partially processed documents and their chunk coverage', () => {
    render(
      <AnalysisCoverageBanner
        coverage={{
          analyzed: 3, failed: 0, partial: 1, total: 3, coverageRatio: 1,
          partialFiles: [{
            fileName: 'large-filing.pdf',
            degraded: true,
            analysisChunks: { completed: 7, total: 8 },
          }],
        }}
      />
    );
    expect(screen.getByText(/1 djelomično obrađeno/)).toBeInTheDocument();
    expect(screen.getByText('Dokumenti obrađeni djelomično (1)')).toBeInTheDocument();
    const partialDetails = screen.getByText('Dokumenti obrađeni djelomično (1)').closest('details');
    expect(partialDetails.querySelector('li')).toHaveTextContent(/large-filing\.pdf — 7\/8 odlomaka analizirano/);
  });

  test('coverage banner lists failed documents, tolerating both fixture shapes', () => {
    // The frozen replay fixture stores failedFiles as bare strings; the current
    // producer emits objects. Both must render, never "undefined".
    const { unmount } = render(
      <AnalysisCoverageBanner
        coverage={{ analyzed: 1, failed: 2, total: 3, failedFiles: ['a.pdf', 'b.pdf'] }}
      />
    );
    expect(screen.getByText('Dokumenti koji nisu analizirani (2)')).toBeInTheDocument();
    unmount();

    render(
      <AnalysisCoverageBanner
        coverage={{ analyzed: 1, failed: 1, total: 3, failedFiles: [{ fileName: 'c.pdf', reason: 'x' }] }}
      />
    );
    expect(screen.getByText('Dokumenti koji nisu analizirani (1)')).toBeInTheDocument();
  });

  test('bounds the unified evidence register to ten rows per page', () => {
    const entries = Array.from({ length: 24 }, (_, index) => ({
      id: `money-${index + 1}`,
      description: `Stavka financijskog registra ${index + 1}`,
      amount: index + 1,
      amountEur: index + 1,
      currency: 'EUR',
      direction: 'potraživanje',
      grounded: true,
    }));
    const { container } = render(
      <AnalysisFlowsSection moneyFlow={{ entries }} propertyFlow={{ entries: [] }} valueChanges={[]} />
    );

    expect(container.querySelectorAll('[data-testid="evidence-record-row"]')).toHaveLength(10);
    expect(screen.getByText('Prikaz 1–10 od 24')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sljedeća' }));
    expect(container.querySelectorAll('[data-testid="evidence-record-row"]')).toHaveLength(10);
    expect(screen.getByText('Prikaz 11–20 od 24')).toBeInTheDocument();
  });

  test('category filters retain bounded property records and surface grounding doubts', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `property-${index + 1}`,
      description: `Imovina ${index + 1}`,
      assetType: 'nekretnina',
      grounded: index !== 0,
    }));
    const { container } = render(
      <AnalysisFlowsSection moneyFlow={{ entries: [] }} propertyFlow={{ entries }} valueChanges={[]} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Imovina 12' }));
    expect(screen.getByRole('button', { name: 'Imovina 12' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('[data-testid="evidence-record-row"]')).toHaveLength(10);
    expect(screen.getByText(/provjerite izvor/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sljedeća' }));
    expect(container.querySelectorAll('[data-testid="evidence-record-row"]')).toHaveLength(2);
    expect(container.textContent).toContain('Imovina 12');
  });

  test('flows section labels an ungrounded property record for source review', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{ entries: [] }}
        propertyFlow={{
          entries: [{
            id: 'prop-2', sourceId: 'analysis-prop', description: 'Proizvodni strojevi', assetType: 'pokretnina',
            transferor: 'Ducanor d.o.o.', transferee: 'Kupac Prostor d.o.o.',
            value: 25000, valueEur: 25000, currency: 'EUR', date: '2023-02-10',
            fileName: 'Rjesenje_o_prodaji_imovine.pdf', grounded: false,
          }],
        }}
        valueChanges={[]}
        sourceDocuments={[{ id: 'analysis-prop', fileName: 'Rjesenje_o_prodaji_imovine.pdf', url: 'https://court.example.test/file.pdf' }]}
      />
    );
    expect(screen.getByRole('link', { name: 'Rjesenje_o_prodaji_imovine.pdf' })).toHaveAttribute('href', 'https://court.example.test/file.pdf');
    expect(screen.getByRole('button', { name: 'Imovina 1' })).toBeInTheDocument();
    expect(screen.getByText(/provjerite izvor/)).toBeInTheDocument();
  });

  test('flows section hides entirely when both flows are empty', () => {
    const { container } = render(
      <AnalysisFlowsSection moneyFlow={{ entries: [] }} propertyFlow={{ entries: [] }} valueChanges={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('money records keep parties and direction inspectable', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{
          entries: [{
            id: 'money-1', description: 'Tražbina CroGo', amount: 1000, currency: 'EUR',
            amountEur: 1000, direction: 'potraživanje',
            from: 'Kerum d.o.o.', to: 'CroGo d.o.o.',
            fileName: 'Prilog.pdf',
          }],
        }}
        propertyFlow={{ entries: [] }}
        valueChanges={[]}
      />
    );
    expect(screen.getByRole('button', { name: 'Novčane stavke 1' })).toBeInTheDocument();
    expect(screen.getByText('Kerum d.o.o. · CroGo d.o.o.')).toBeInTheDocument();
    expect(screen.getAllByText('potraživanje').length).toBeGreaterThan(0);
  });

  test('merges an exact cross-category echo into one expandable evidence row', () => {
    const { container } = render(
      <AnalysisFlowsSection
        moneyFlow={{
          entries: [{
            id: 'money-1', crossCategoryFactId: 'cross-123', description: 'Prodajna cijena strojeva',
            amount: 25000, amountEur: 25000, currency: 'EUR', quote: 'strojevi za 25.000 EUR',
          }],
        }}
        propertyFlow={{
          entries: [{
            id: 'property-1', crossCategoryFactId: 'cross-123', description: 'Prodaja strojeva',
            assetType: 'pokretnina', value: 25000, valueEur: 25000, currency: 'EUR',
          }],
        }}
        valueChanges={[]}
      />
    );

    expect(container.querySelectorAll('[data-testid="evidence-record-row"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Novčane stavke 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imovina 1' })).toBeInTheDocument();
    expect(screen.getByText('Isti izvorni podatak u dvije kategorije; prikazan jednom.')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('Prodaja strojeva')[0]);
    expect(screen.getByText('Prodajna cijena strojeva')).toBeInTheDocument();
    expect(screen.getByText('strojevi za 25.000 EUR', { exact: false })).toBeInTheDocument();
  });


  test('does not sum claims and liabilities into a misleading register total', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{
          entries: [
            { id: 'claim', description: 'Prijavljena tražbina', amount: 100, amountEur: 100, currency: 'EUR', direction: 'potraživanje' },
            { id: 'liability', description: 'Dosuđena obveza', amount: 100, amountEur: 100, currency: 'EUR', direction: 'obveza' },
          ],
        }}
        propertyFlow={{ entries: [] }}
        valueChanges={[]}
      />
    );

    expect(screen.queryByText('zbroj svih stavki — nije iznos tražbine')).not.toBeInTheDocument();
    expect(screen.queryByText('200,00 €')).not.toBeInTheDocument();
    expect(screen.getByText(/Zbroj različitih tvrdnji se ne prikazuje/)).toBeInTheDocument();
  });

  test('money flow renders English ruling-outcome directions as Croatian labels', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{
          entries: [
            { id: 'money-2', description: 'Trosak zalbenog postupka', amount: 63.38, currency: 'EUR', amountEur: 63.38, direction: 'netted' },
          ],
        }}
        propertyFlow={{ entries: [] }}
        valueChanges={[]}
      />
    );
    expect(screen.getAllByText('prebijeno').length).toBeGreaterThan(0);
    expect(screen.queryByText('netted')).not.toBeInTheDocument();
  });

  // P3: a converted figure must never be presented as if it had been stated.
  test('money flow shows the source-stated figure beneath a converted EUR figure', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{
          entries: [{
            id: 'money-3', description: 'Tražbina drugog višeg reda',
            amount: 177218.01, currency: 'HRK', amountEur: 23520.87, amountEurSource: 'converted',
            direction: 'potraživanje',
          }],
        }}
        propertyFlow={{ entries: [] }}
        valueChanges={[]}
      />
    );
    expect(screen.getByText('23.520,87 €')).toBeInTheDocument();
    expect(screen.getByText('izvorno 177.218,01 HRK')).toBeInTheDocument();
  });

  test('money flow omits the source line when the figure was stated in EUR', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{ entries: [{ id: 'm', description: 'Polog', amount: 1200, currency: 'EUR', amountEur: 1200 }] }}
        propertyFlow={{ entries: [] }}
        valueChanges={[]}
      />
    );
    expect(screen.getAllByText('1.200,00 €').length).toBe(1);
    // no HRK marker when the figure was stated in EUR
    expect(screen.queryByText('iz HRK')).not.toBeInTheDocument();
    expect(screen.queryByText(/^iznos u izvoru/)).not.toBeInTheDocument();
  });

  // The lifecycle timeline is the point of this rewrite: valueChanges carries
  // stages[], originalValue, latestValue, delta and discountPct, and the old UI
  // rendered only `finding`.
  test('value changes render a lifecycle timeline with delta and discount', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{ entries: [] }}
        propertyFlow={{ entries: [] }}
        valueChanges={[{
          description: 'Tražbina vjerovnika prema dužniku Ducanor d.o.o.',
          linkage: 'supersedes',
          originalValue: 84500,
          latestValue: 15000,
          delta: -69500,
          discountPct: -82.25,
          comparisonStatus: 'comparable',
          stages: [
            { id: 'prop-1', eventType: 'prijava', value: 84500, valueRole: 'claim_balance', currency: 'EUR', date: '2022-06-15', transferor: 'Vjerovnik A d.o.o.', fileName: 'Poziv_vjerovnicima_za_prijavu_trazbina.pdf' },
            { id: 'prop-3', eventType: 'ustup', value: 15000, valueRole: 'claim_balance', currency: 'EUR', date: '2023-06-01', transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac Tražbina d.o.o.', fileName: 'Rjesenje_o_prodaji_imovine.pdf' },
          ],
        }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Povijest tražbina 1' }));
    expect(screen.getByRole('region', { name: 'Povijest tražbina' })).toBeInTheDocument();
    // The claim overview and event rows retain the reported amounts.
    expect(screen.getAllByText('84.500,00 €').length).toBe(2);
    expect(screen.getAllByText('15.000,00 €').length).toBe(2);
    // event types
    expect(screen.getByText(/Prijava/)).toBeInTheDocument();
    expect(screen.getAllByText(/Ustup/).length).toBeGreaterThan(0);
    // parties and both source documents
    expect(screen.getAllByText('Vjerovnik A d.o.o.').length).toBeGreaterThan(0);
    expect(screen.getByText('Kupac Tražbina d.o.o.')).toBeInTheDocument();
    // single-record rows show their source inline; multi-record rows disclose it
    expect(screen.getByText('Poziv_vjerovnicima_za_prijavu_trazbina.pdf')).toBeInTheDocument();
    expect(screen.getByText('Rjesenje_o_prodaji_imovine.pdf')).toBeInTheDocument();
    // the delta and the percentage
    expect(screen.getByText(/69\.500,00/)).toBeInTheDocument();
    expect(screen.getByText(/82,25/)).toBeInTheDocument();
  });

  test('value changes fall back to `finding` when no stages were recorded', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{ entries: [] }}
        propertyFlow={{ entries: [] }}
        valueChanges={[{ description: 'Tražbina vjerovnika', finding: 'Tražbina ustupljena je za 15,000 EUR.' }]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Povijest tražbina 1' }));
    expect(screen.getByText(/Tražbina ustupljena je za 15,000 EUR\./)).toBeInTheDocument();
  });
});
