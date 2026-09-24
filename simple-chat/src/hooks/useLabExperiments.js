import { useCallback, useEffect, useRef, useState } from 'react';
import { listLabExperiments } from '../lib/apiClient';

export function useLabExperiments({ limit = 10, enabled = true } = {}) {
  const [experiments, setExperiments] = useState([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const offsetRef = useRef(0);
  const requestIdRef = useRef(0);

  const loadExperiments = useCallback(async (nextOffset = offsetRef.current) => {
    if (!enabled) return;

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');

    try {
      const data = await listLabExperiments({ limit, offset: nextOffset });
      if (requestId !== requestIdRef.current) return;
      setExperiments(data?.experiments || []);
      setCount(data?.count || 0);
      const resolvedOffset = data?.offset ?? nextOffset ?? 0;
      offsetRef.current = resolvedOffset;
      setOffset(resolvedOffset);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message || 'Neuspjelo učitavanje eksperimenata.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [enabled, limit]);

  useEffect(() => {
    if (!enabled) return;
    loadExperiments(0);
    return () => {
      requestIdRef.current += 1;
    };
  }, [enabled, limit, loadExperiments]);

  const nextPage = useCallback(() => {
    if (loading) return;
    const nextOffset = offset + limit;
    if (nextOffset >= count) return;
    loadExperiments(nextOffset);
  }, [count, limit, loadExperiments, loading, offset]);

  const prevPage = useCallback(() => {
    if (loading) return;
    const nextOffset = Math.max(0, offset - limit);
    loadExperiments(nextOffset);
  }, [limit, loadExperiments, loading, offset]);

  return {
    experiments,
    count,
    limit,
    offset,
    loading,
    error,
    hasPrev: offset > 0,
    hasNext: offset + limit < count,
    loadExperiments,
    nextPage,
    prevPage,
  };
}
