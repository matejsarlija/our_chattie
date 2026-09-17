/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReasoningExperimentsPanel from '../ReasoningExperimentsPanel';
import AnalysisReasoningTelemetry from '../AnalysisReasoningTelemetry';
import { useSettings } from '../../../hooks/useSettings';

jest.mock('../../../hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

describe('ReasoningExperimentsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useSettings.mockReturnValue({
      reasoningRerankMode: 'auto',
      reasoningPlanner: 'on',
      reasoningFollowUp: 'on',
      saving: false,
      error: '',
      saveReasoningSettings: jest.fn().mockResolvedValue({}),
    });
  });

  test('renders all three switches with persisted values selected', () => {
    render(<ReasoningExperimentsPanel />);

    expect(screen.getByRole('radio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByRole('radio', { name: 'Uklj.' }).every((el) => el.getAttribute('aria-checked') === 'true')).toBe(true);
  });

  test('saving a rerank mode posts only that field', async () => {
    const saveReasoningSettings = jest.fn().mockResolvedValue({});
    useSettings.mockReturnValue({
      reasoningRerankMode: 'auto',
      reasoningPlanner: 'on',
      reasoningFollowUp: 'on',
      saving: false,
      error: '',
      saveReasoningSettings,
    });

    render(<ReasoningExperimentsPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'Prisilno' }));

    await waitFor(() => {
      expect(saveReasoningSettings).toHaveBeenCalledWith({ reasoningRerankMode: 'force' });
    });
  });

  test('planner and re-verify toggles post their own fields', async () => {
    const saveReasoningSettings = jest.fn().mockResolvedValue({});
    useSettings.mockReturnValue({
      reasoningRerankMode: 'auto',
      reasoningPlanner: 'on',
      reasoningFollowUp: 'on',
      saving: false,
      error: '',
      saveReasoningSettings,
    });

    render(<ReasoningExperimentsPanel />);
    const offButtons = screen.getAllByRole('radio', { name: 'Isklj.' });
    // Order: rerank(Isklj.), planner(Isklj.), followUp(Isklj.)
    fireEvent.click(offButtons[1]);
    fireEvent.click(offButtons[2]);

    await waitFor(() => {
      expect(saveReasoningSettings).toHaveBeenCalledWith({ reasoningPlanner: 'off' });
      expect(saveReasoningSettings).toHaveBeenCalledWith({ reasoningFollowUp: 'off' });
    });
  });
});

describe('AnalysisReasoningTelemetry', () => {
  test('renders planned vs template queries with counts and rerank status', () => {
    const report = {
      meta: {
        retrieval: {
          queries: [
            { id: 'planned-prodaja', purpose: 'asset-disposition', text: 'prodaja imovine strojevi kupac' },
            { id: 'timeline', purpose: 'timeline', text: 'datumi ročište rješenje' },
          ],
          metrics: { matchCount: 14, sourceTypeCounts: { chunk: 9, analysis: 4, documentLink: 1 } },
        },
        rerank: { rerankStatus: 'active', metrics: { rerankedMatchCount: 14 } },
      },
      conflicts: [],
    };

    render(<AnalysisReasoningTelemetry report={report} />);

    expect(screen.getByTestId('reasoning-telemetry')).toBeTruthy();
    expect(screen.getByText('PLAN')).toBeTruthy();
    expect(screen.getByText('PREDLOŽAK')).toBeTruthy();
    expect(screen.getByText(/rerank: Aktivan/)).toBeTruthy();
    expect(screen.getByText('prodaja imovine strojevi kupac')).toBeTruthy();
  });

  test('renders follow-up verdicts for annotated conflicts', () => {
    const report = {
      meta: { retrieval: { queries: [], metrics: {} }, rerank: { rerankStatus: 'skipped' } },
      conflicts: [
        { finding: 'Različiti iznosi za istu namjenu.', followUp: { verdict: 'refuted', reason: 'Dokaz pokazuje jedan iznos.' } },
      ],
    };

    render(<AnalysisReasoningTelemetry report={report} />);
    expect(screen.getByText('opovrgnut')).toBeTruthy();
    expect(screen.getByText(/Dokaz pokazuje jedan iznos/)).toBeTruthy();
  });

  test('graceful empty state when the run has no telemetry meta', () => {
    render(<AnalysisReasoningTelemetry report={{}} />);
    expect(screen.getByText(/Telemetrija nije dostupna/)).toBeTruthy();
  });

  test('M-07: planned-modelom chip filters the query table', () => {
    const report = {
      meta: {
        retrieval: {
          queries: [
            { id: 'planned-prodaja', purpose: 'asset-disposition', text: 'prodaja imovine' },
            { id: 'timeline', purpose: 'timeline', text: 'datumi ročište' },
          ],
          results: [
            { query: { id: 'planned-prodaja', purpose: 'asset-disposition', text: 'prodaja imovine' }, matches: [] },
            { query: { id: 'timeline', purpose: 'timeline', text: 'datumi ročište' }, matches: [] },
          ],
          metrics: { matchCount: 0 },
        },
        rerank: { rerankStatus: 'skipped' },
      },
      conflicts: [],
    };
    render(<AnalysisReasoningTelemetry report={report} />);
    expect(screen.getByText('prodaja imovine')).toBeTruthy();
    expect(screen.getByText('datumi ročište')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /planirano modelom/ }));
    expect(screen.getByText('prodaja imovine')).toBeTruthy();
    expect(screen.queryByText('datumi ročište')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Poništi filter/ }));
    expect(screen.getByText('datumi ročište')).toBeTruthy();
  });

  test('M-08: query rows expand into persisted match detail', () => {
    const report = {
      meta: {
        retrieval: {
          queries: [{ id: 'planned-prodaja', purpose: 'asset-disposition', text: 'prodaja imovine' }],
          results: [{
            query: { id: 'planned-prodaja', purpose: 'asset-disposition', text: 'prodaja imovine' },
            matches: [{
              sourceId: 'doc-1',
              score: 4.2,
              reasons: ['token:prodaja', 'anchor:St-2/2013'],
              snippet: 'Rješenje navodi prodaju strojeva kupcu.',
              fileName: 'Rjesenje.pdf',
              sourceType: 'analysis',
            }],
          }],
          metrics: { matchCount: 1, sourceTypeCounts: { analysis: 1 } },
        },
        rerank: { rerankStatus: 'skipped' },
      },
      conflicts: [],
    };
    render(<AnalysisReasoningTelemetry report={report} />);
    expect(screen.queryByText('Rješenje navodi prodaju strojeva kupcu.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /prodaja imovine/ }));
    expect(screen.getByText('Rješenje navodi prodaju strojeva kupcu.')).toBeTruthy();
    expect(screen.getByText('Rjesenje.pdf')).toBeTruthy();
    expect(screen.getByText(/token:prodaja/)).toBeTruthy();
  });
});
