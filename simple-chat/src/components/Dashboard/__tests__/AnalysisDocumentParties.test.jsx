import { render, screen } from '@testing-library/react';
import AnalysisDocumentParties from '../AnalysisDocumentParties';

describe('AnalysisDocumentParties', () => {
  test('shows source identity, quote, grounding status, and linked source document', () => {
    render(
      <AnalysisDocumentParties
        analyses={[{
          id: 'analysis-1',
          documentParties: [{
            name: 'ADRIA RIJEKA d.o.o.',
            oib: '08697489827',
            role: 'dužnik',
            quote: 'ADRIA RIJEKA d.o.o., OIB: 08697489827',
            grounded: true,
          }],
        }]}
        sourceDocuments={[{ id: 'analysis-1', fileName: 'Podnesak.pdf', url: 'https://court.example.test/podnesak.pdf' }]}
      />
    );

    expect(screen.getByRole('heading', { name: 'OIB-ovi navedeni u dokumentima' })).toBeInTheDocument();
    expect(screen.getByText('08697489827')).toBeInTheDocument();
    expect(screen.getByText('ADRIA RIJEKA d.o.o., OIB: 08697489827')).toBeInTheDocument();
    expect(screen.getByText('Navod potvrđen u tekstu')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Podnesak.pdf' })).toHaveAttribute('href', 'https://court.example.test/podnesak.pdf');
  });

  test('marks ungrounded identities for review and does not invent a name or source link', () => {
    render(
      <AnalysisDocumentParties
        analyses={[{
          id: 'analysis-2',
          fileName: 'Odluka.pdf',
          documentParties: [{ oib: '08697489827', quote: 'Nepotvrđen navod', grounded: false }],
        }]}
      />
    );

    expect(screen.getByText('Ime nije navedeno uz OIB')).toBeInTheDocument();
    expect(screen.getByText('Navod nije potvrđen — provjerite izvornik')).toBeInTheDocument();
    expect(screen.getByText('Odluka.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Odluka.pdf' })).not.toBeInTheDocument();
  });

  test('omits the section when no document identities exist', () => {
    const { container } = render(<AnalysisDocumentParties analyses={[{ parties: [{ name: 'Court-page participant' }] }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
