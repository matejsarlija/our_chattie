import { render, screen } from '@testing-library/react';
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

  test('flows section renders Tijek imovine with an ungrounded marker in context', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{ entries: [] }}
        propertyFlow={{
          entries: [
            {
              id: 'prop-2', description: 'Proizvodni strojevi', assetType: 'pokretnina',
              transferor: 'Ducanor d.o.o.', transferee: 'Kupac Prostor d.o.o.',
              value: 25000, currency: 'EUR', date: '2023-02-10',
              fileName: 'Rjesenje_o_prodaji_imovine.pdf', grounded: false,
            },
          ],
        }}
        valueChanges={[]}
      />
    );
    expect(screen.getByText('Tijek imovine')).toBeInTheDocument();
    expect(screen.getByText('⚠ nepotvrđeno')).toBeInTheDocument();
  });

  test('flows section hides entirely when both flows are empty', () => {
    const { container } = render(
      <AnalysisFlowsSection moneyFlow={{ entries: [] }} propertyFlow={{ entries: [] }} valueChanges={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  test('flows section renders tražbina value-change timelines', () => {
    render(
      <AnalysisFlowsSection
        moneyFlow={{ entries: [] }}
        propertyFlow={{ entries: [] }}
        valueChanges={[
          { description: 'Tražbina vjerovnika', finding: 'Tražbina "Tražbina vjerovnika" u iznosu od 84,500 EUR ustupljena je za 15,000 EUR.' },
        ]}
      />
    );
    expect(screen.getByText('Vrijednosne promjene tražbina')).toBeInTheDocument();
  });
});
