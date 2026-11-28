/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AnalysisEntitiesExplorer from '../AnalysisEntitiesExplorer';
import { getRunFacts } from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  getRunFacts: vi.fn(),
}));

describe('AnalysisEntitiesExplorer & useRunFacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRunFacts.mockResolvedValue({
      facts: [
        {
          id: 'fact-1',
          kind: 'amount',
          description: 'Prijavljena tražbina banke',
          valueEur: 12500.5,
          currency: 'HRK',
          valueHrk: 94185.02,
          date: '2024-03-10',
          canonicalPartyId: 'oib:11111111111',
          grounded: true,
          sourceChunkId: 'chunk-1',
          docId: 'doc-1',
          sourcePages: [2],
          raw: { quote: '12.500,50 EUR' },
        },
        {
          id: 'fact-2',
          kind: 'procedural_outcome',
          description: 'Nepotvrđeni podnesak',
          date: '2024-04-01',
          grounded: false,
          sourceChunkId: 'chunk-2',
        },
      ],
      total: 2,
    });
  });

  test('renders canonical parties, creditor digest, and cross-filters facts on click', async () => {
    const onOpenEvidence = vi.fn();

    render(
      <AnalysisEntitiesExplorer
        runId="run-1"
        canonicalParties={[
          {
            canonicalPartyId: 'oib:11111111111',
            name: 'Prva Banka d.d.',
            oib: '11111111111',
            roles: ['vjerovnik'],
            aliases: ['Prva Banka d.d.', 'PRVA BANKA'],
            documentCount: 4,
          },
        ]}
        creditorDigest={{
          topCreditors: [
            {
              canonicalPartyId: 'oib:11111111111',
              creditor: 'Prva Banka d.d.',
              isplatniRed: 'I. viši isplatni red',
              totalEur: 12500.5,
              cession: true,
            },
          ],
        }}
        onOpenEvidence={onOpenEvidence}
      />,
    );

    expect(screen.getByText('Prva Banka d.d.', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('OIB 11111111111')).toBeInTheDocument();
    expect(screen.getByText('2 naziva')).toBeInTheDocument();
    expect(screen.getByText('4 dok.')).toBeInTheDocument();
    expect(screen.getByText('Ustup / prijenos')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Prijavljena tražbina banke')).toBeInTheDocument();
    });
    expect(screen.getByTestId('fact-unverified-badge')).toHaveTextContent('⚠ nepotvrđeno');

    // Click party to cross-filter
    fireEvent.click(screen.getByText('Prva Banka d.d.', { selector: 'p' }));
    await waitFor(() => {
      expect(getRunFacts).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ partyId: 'oib:11111111111', limit: 50, offset: 0 }),
        expect.objectContaining({ signal: expect.any(Object) }),
      );
    });

    // Toggle grounded filter
    fireEvent.click(screen.getByRole('button', { name: 'Samo potvrđeno' }));
    await waitFor(() => {
      expect(getRunFacts).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ grounded: true, partyId: 'oib:11111111111' }),
        expect.any(Object),
      );
    });

    // Open evidence drawer from fact
    fireEvent.click(screen.getAllByRole('button', { name: 'Prikaži u kontekstu' })[0]);
    expect(onOpenEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: 'chunk-1',
        docId: 'doc-1',
        quote: '12.500,50 EUR',
        pageNumbers: [2],
      }),
    );
  });

  test('falls back to AnalysisDocumentParties for legacy pre-R100 runs', async () => {
    getRunFacts.mockResolvedValue({ facts: [], total: 0 });

    render(
      <AnalysisEntitiesExplorer
        runId="run-legacy"
        canonicalParties={[]}
        creditorDigest={null}
        legacyAnalyses={[
          {
            id: 'a-1',
            fileName: 'Legacy.pdf',
            documentParties: [
              { name: 'Stari Dužnik d.o.o.', oib: '99999999999', role: 'dužnik', quote: 'OIB 99999999999', grounded: true },
            ],
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('document-parties')).toBeInTheDocument();
    });
    expect(screen.getByText('Stari Dužnik d.o.o.')).toBeInTheDocument();
  });
});
