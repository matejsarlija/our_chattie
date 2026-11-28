import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useDocketSearch } from '../../../hooks/useDocketSearch';
import DocketSearchPanel from '../DocketSearchPanel';
import { searchRunChunks } from '../../../lib/apiClient';

vi.mock('../../../lib/apiClient', () => ({
  searchRunChunks: vi.fn(),
}));

describe('useDocketSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('debounces search by 250ms and supports pagination', async () => {
    searchRunChunks.mockResolvedValue({
      chunks: [{ chunkId: 'c1', fileName: 'Rjesenje.pdf', pageNumbers: [1], snippet: 'Stečajni postupak' }],
      total: 25,
    });

    const { result } = renderHook(() => useDocketSearch('run-1', { limit: 20 }));

    act(() => {
      result.current.setQuery('stečaj');
    });

    expect(searchRunChunks).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(searchRunChunks).toHaveBeenCalledWith(
      'run-1',
      { q: 'stečaj', limit: 20, offset: 0 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    expect(result.current.results).toHaveLength(1);
    expect(result.current.hasNext).toBe(true);
    expect(result.current.hasPrev).toBe(false);

    act(() => {
      result.current.nextPage();
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    expect(searchRunChunks).toHaveBeenLastCalledWith(
      'run-1',
      { q: 'stečaj', limit: 20, offset: 20 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );
  });
});

describe('DocketSearchPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('renders idle, populated, empty, and error states and triggers onOpenEvidence', async () => {
    const onOpenEvidence = vi.fn();
    render(<DocketSearchPanel runId="run-1" onOpenEvidence={onOpenEvidence} />);

    expect(screen.getByText(/Unesite pojam za pretragu/)).toBeInTheDocument();

    searchRunChunks.mockResolvedValueOnce({
      chunks: [
        {
          chunkId: 'c-42',
          docId: 'd-1',
          fileName: 'Popis.pdf',
          caseNumber: 'St-2/2013',
          pageNumbers: [3],
          snippet: 'Vjerovnik Zagreb d.d.',
        },
      ],
      total: 1,
    });

    const input = screen.getByRole('searchbox', { name: 'Pretraga teksta spisa' });
    fireEvent.change(input, { target: { value: 'Zagreb' } });

    await act(async () => {
      vi.advanceTimersByTime(250);
    });

    await waitFor(() => {
      expect(screen.getByText('Popis.pdf')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Prikaži u kontekstu' }));
    expect(onOpenEvidence).toHaveBeenCalledWith(expect.objectContaining({
      chunkId: 'c-42',
      quote: 'Zagreb',
      fileName: 'Popis.pdf',
    }));

    // Empty results state
    searchRunChunks.mockResolvedValueOnce({ chunks: [], total: 0 });
    fireEvent.change(input, { target: { value: 'Nepostojeći' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => {
      expect(screen.getByText(/Nema pronađenih isječaka/)).toBeInTheDocument();
    });

    // Error state
    searchRunChunks.mockRejectedValueOnce(new Error('FTS5 greška'));
    fireEvent.change(input, { target: { value: 'Greška' } });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('FTS5 greška');
    });
  });
});
