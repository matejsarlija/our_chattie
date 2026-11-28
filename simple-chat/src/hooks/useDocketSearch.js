import { useCallback, useEffect, useRef, useState } from 'react';
import { searchRunChunks } from '../lib/apiClient';

const DEFAULT_LIMIT = 20;
const DEBOUNCE_MS = 250;

export function useDocketSearch(runId, { limit = DEFAULT_LIMIT } = {}) {
  const [query, setQueryState] = useState('');
  const [offset, setOffset] = useState(0);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const abortRef = useRef(null);

  const setQuery = useCallback((nextQuery) => {
    setQueryState(nextQuery);
    setOffset(0);
  }, []);

  const nextPage = useCallback(() => {
    setOffset((prev) => prev + limit);
  }, [limit]);

  const prevPage = useCallback(() => {
    setOffset((prev) => Math.max(0, prev - limit));
  }, [limit]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!runId || !trimmed) {
      if (abortRef.current) abortRef.current.abort();
      setResults([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      abortRef.current = controller;
      setLoading(true);
      setError('');
      try {
        const data = await searchRunChunks(
          runId,
          { q: trimmed, limit, offset },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResults(Array.isArray(data?.chunks) ? data.chunks : []);
        setTotal(typeof data?.total === 'number' ? data.total : 0);
        setLoading(false);
      } catch (err) {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        setResults([]);
        setTotal(0);
        setLoading(false);
        setError(err?.message || 'Pretraga spisa nije uspjela.');
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [runId, query, offset, limit]);

  return {
    query,
    setQuery,
    results,
    total,
    loading,
    error,
    offset,
    limit,
    hasNext: offset + results.length < total,
    hasPrev: offset > 0,
    nextPage,
    prevPage,
  };
}

export default useDocketSearch;
