/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LiveRunControlBar from '../LiveRunControlBar';
import { cancelAnalysisRun } from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  cancelAnalysisRun: vi.fn(),
}));

describe('LiveRunControlBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders preflight manifest from preflight_json and 4 concurrent lanes', () => {
    render(
      <LiveRunControlBar
        isRunning
        run={{
          id: 'run-1',
          status: 'running',
          preflight_json: JSON.stringify({
            estimatedMinUsd: 0.012,
            estimatedExpectedUsd: 0.045,
            cachedHits: 3,
            ocrPages: 12,
            digitalDocs: 4,
            scannedDocs: 2,
            hybridDocs: 1,
          }),
        }}
        lanes={{
          download: { done: 7, total: 7, failed: 0 },
          preflight: { done: 7, total: 7, failed: 0 },
          ocr: { docsDone: 1, docsTotal: 3, pagesDone: 4, pagesTotal: 12, failed: 0 },
          extract: { done: 2, total: 7, failed: 1 },
        }}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByText('$0.012–$0.045')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByTestId('lane-progress-grid')).toBeInTheDocument();
    expect(screen.getByText('1/3 · 4/12 str.')).toBeInTheDocument();
    expect(screen.getByText('2/7 (1✗)')).toBeInTheDocument();
  });

  test('confirms cancel and handles 409 Conflict gracefully', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const conflictErr = new Error('Analysis run is not active.');
    conflictErr.status = 409;
    cancelAnalysisRun.mockRejectedValue(conflictErr);

    render(
      <LiveRunControlBar
        isRunning
        run={{ id: 'run-1', status: 'running' }}
        lanes={null}
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Otkaži analizu' }));
    expect(screen.getByText('Otkazati analizu?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Potvrdi otkazivanje' }));

    await waitFor(() => {
      expect(cancelAnalysisRun).toHaveBeenCalledWith('run-1');
    });
    expect(await screen.findByText('Analiza je već dovršena ili otkazana.')).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
  });
});
