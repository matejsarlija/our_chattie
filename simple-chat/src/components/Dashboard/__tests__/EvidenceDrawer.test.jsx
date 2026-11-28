import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useEvidenceDrawer } from '../../../hooks/useEvidenceDrawer';
import EvidenceDrawer from '../EvidenceDrawer';
import { getRunChunk } from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  getRunChunk: vi.fn(),
}));

describe('useEvidenceDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('fetches chunk, caches by chunkId, and aborts in-flight request on rapid switch', async () => {
    const signals = [];
    let resolveSecond;
    getRunChunk
      .mockImplementationOnce((_runId, _chunkId, opts) => {
        signals.push(opts.signal);
        return new Promise(() => {});
      })
      .mockImplementationOnce((_runId, _chunkId, opts) => {
        signals.push(opts.signal);
        return new Promise((resolve) => {
          resolveSecond = resolve;
        });
      });

    const { result } = renderHook(() => useEvidenceDrawer('run-1'));

    act(() => {
      result.current.openEvidence({ chunkId: 'c1', fileName: 'A.pdf', quote: 'prvi' });
    });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.openEvidence({ chunkId: 'c2', fileName: 'B.pdf', quote: 'drugi' });
    });
    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      resolveSecond({ id: 'c2', fileName: 'B.pdf', text: 'Ovo je drugi citat iz spisa.' });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.chunk.id).toBe('c2');

    // Second open of c2 uses in-memory cache without re-fetching
    act(() => {
      result.current.openEvidence({ chunkId: 'c2', fileName: 'B.pdf', quote: 'drugi' });
    });
    expect(getRunChunk).toHaveBeenCalledTimes(2);
  });

  test('handles missing chunkId and 404 errors cleanly', async () => {
    getRunChunk.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 }));

    const { result } = renderHook(() => useEvidenceDrawer('run-1'));

    await act(async () => {
      await result.current.openEvidence({ fileName: 'Legacy.pdf', quote: 'bez id' });
    });
    expect(result.current.error).toMatch(/chunkId/i);

    await act(async () => {
      await result.current.openEvidence({ chunkId: 'missing-1', fileName: 'Missing.pdf' });
    });
    expect(result.current.error).toMatch(/nije pronađen/i);
  });
});

describe('EvidenceDrawer', () => {
  test('highlights verbatim quote with semantic <mark> and renders external e-Oglasna link', () => {
    const onClose = vi.fn();
    render(
      <EvidenceDrawer
        isOpen
        onClose={onClose}
        activeContext={{
          chunkId: 'c1',
          quote: 'tražbina od 10.000,00 EUR',
          url: 'https://e-oglasna.pravosudje.hr/objave/1',
        }}
        chunk={{
          id: 'c1',
          fileName: 'Rjesenje.pdf',
          caseNumber: 'St-2/2013',
          entryDisplayId: '128734',
          pageNumbers: [4, 5],
          text: 'Utvrđuje se tražbina od 10.000,00 EUR u stečajnom postupku.',
        }}
      />,
    );

    expect(screen.getByText('Rjesenje.pdf')).toBeInTheDocument();
    expect(screen.getByText('str. 4–5')).toBeInTheDocument();
    const mark = screen.getByText('tražbina od 10.000,00 EUR');
    expect(mark.tagName).toBe('MARK');
    expect(mark.className).toContain('bg-warning-surface');

    const link = screen.getByRole('link', { name: /Otvori izvornik/ });
    expect(link).toHaveAttribute('href', 'https://e-oglasna.pravosudje.hr/objave/1');

    fireEvent.click(screen.getByRole('button', { name: 'Zatvori preglednik' }));
    expect(onClose).toHaveBeenCalled();
  });

  test('renders error state with saved quote fallback', async () => {
    render(
      <EvidenceDrawer
        isOpen
        onClose={vi.fn()}
        activeContext={{ fileName: 'Rjesenje.pdf', quote: 'Sačuvani citat' }}
        error="Isječak nije pronađen."
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Isječak nije pronađen.');
    });
    expect(screen.getByText(/Sačuvani citat/)).toBeInTheDocument();
  });
});
