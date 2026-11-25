import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import AnalysisReasoningTelemetry from '../AnalysisReasoningTelemetry';

const report = {
  meta: {
    retrieval: {
      queries: [],
      results: [{
        query: { id: 'amounts', purpose: 'financial-amounts', text: 'iznos tražbina' },
        matches: [{
          sourceId: 'doc-1',
          score: 4.2,
          reasons: ['token:tražbina'],
          snippet: 'Rješenje navodi tražbinu od 10.000 EUR.',
          fileName: 'Rjesenje.pdf',
          sourceType: 'chunk',
        }],
      }],
      metrics: { queryCount: 1, matchCount: 1, sourceTypeCounts: { chunk: 1 } },
    },
    rerank: { rerankStatus: 'fallback' },
  },
  conflicts: [{ finding: 'Sukob.', followUp: { verdict: 'refuted' } }],
};

describe('AnalysisReasoningTelemetry', () => {
  test('shows deterministic retrieval evidence without retired pass telemetry', () => {
    render(<AnalysisReasoningTelemetry report={report} />);

    expect(screen.getByText('upita')).toBeInTheDocument();
    expect(screen.getByText('PREDLOŽAK')).toBeInTheDocument();
    expect(screen.queryByText(/rerank|konflikata opovrgnut|PLAN/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /iznos tražbina/ }));
    expect(screen.getByText('Rjesenje.pdf')).toBeInTheDocument();
    expect(screen.getByText('Rješenje navodi tražbinu od 10.000 EUR.')).toBeInTheDocument();
  });

  test('filters deterministic queries by matched source type', () => {
    const filteredReport = {
      meta: {
        retrieval: {
          results: [
            { query: { id: 'q-analysis', text: 'upit analize' }, matches: [{ sourceType: 'analysis' }] },
            { query: { id: 'q-chunk', text: 'upit dokumenta' }, matches: [{ sourceType: 'chunk' }] },
          ],
          metrics: { queryCount: 2, matchCount: 2, sourceTypeCounts: { analysis: 1, chunk: 1 } },
        },
      },
    };
    render(<AnalysisReasoningTelemetry report={filteredReport} />);

    fireEvent.click(screen.getByRole('button', { name: /analysis/ }));
    expect(screen.getByRole('button', { name: /upit analize/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /upit dokumenta/ })).not.toBeInTheDocument();
  });
});
