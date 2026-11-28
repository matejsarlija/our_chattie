/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangeDetectionControl from '../ChangeDetectionControl';
import { getChangeDetectionHistory, runChangeDetectionCheck } from '../../../lib/apiClient';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', () => ({
  __esModule: true,
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../lib/apiClient', () => ({
  getChangeDetectionHistory: vi.fn(),
  runChangeDetectionCheck: vi.fn(),
}));

describe('ChangeDetectionControl & useChangeDetection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('loads history on mount and renders clean state when zero changes detected', async () => {
    getChangeDetectionHistory.mockResolvedValue({
      queryId: 'a'.repeat(40),
      snapshots: [{ snapshotId: 's1', capturedAt: '2026-03-01T10:00:00.000Z' }],
      diffs: [],
    });
    runChangeDetectionCheck.mockResolvedValue({
      ok: true,
      snapshot: { capturedAt: '2026-03-02T10:00:00.000Z' },
      diff: { added: [], changed: [], removed: [] },
    });

    render(<ChangeDetectionControl queryType="oib" queryValue="12345678901" status="done" />);

    await waitFor(() => {
      expect(getChangeDetectionHistory).toHaveBeenCalledWith('12345678901');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Provjeri nove objave' }));

    await waitFor(() => {
      expect(screen.getByText('Nema novih objava od zadnje provjere')).toBeInTheDocument();
    });
  });

  test('renders diff summary callout with new analysis CTA when changes exist', async () => {
    getChangeDetectionHistory.mockResolvedValue({ snapshots: [], diffs: [] });
    runChangeDetectionCheck.mockResolvedValue({
      ok: true,
      snapshot: { capturedAt: '2026-03-02T10:00:00.000Z' },
      diff: { added: [{ id: 'new-1' }], changed: [{ id: 'chg-1' }], removed: [] },
    });

    render(<ChangeDetectionControl queryType="oib" queryValue="12345678901" status="done" />);

    fireEvent.click(screen.getByRole('button', { name: 'Provjeri nove objave' }));

    await waitFor(() => {
      expect(screen.getByText('Pronađene su nove ili izmijenjene objave')).toBeInTheDocument();
    });
    expect(screen.getByText(/1 novih, 1 izmijenjenih/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Pokreni novu analizu' }));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard?new=1');
  });

  test('handles 502 upstream errors calmly without crashing', async () => {
    getChangeDetectionHistory.mockResolvedValue({ snapshots: [], diffs: [] });
    const err502 = new Error('e-Oglasna trenutno nije dostupna.');
    err502.status = 502;
    runChangeDetectionCheck.mockRejectedValue(err502);

    render(<ChangeDetectionControl queryType="oib" queryValue="12345678901" status="partial" />);

    fireEvent.click(screen.getByRole('button', { name: 'Provjeri nove objave' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('e-Oglasna trenutno nije dostupna.');
    });
  });
});
