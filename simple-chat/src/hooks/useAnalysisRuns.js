import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

export function useAnalysisRuns({ token, limit = 10, enabled = true }) {
  const [runs, setRuns] = useState([]);
  const [count, setCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async (nextOffset = offset) => {
    if (!token || !enabled) return;

    setLoading(true);
    setError('');

    try {
      const query = new URLSearchParams({
        limit: String(limit),
        offset: String(nextOffset),
      });

      const data = await apiFetch(`/api/analysis/runs?${query.toString()}`, {
        token,
      });

      setRuns(data?.runs || []);
      setCount(data?.count || 0);
      setOffset(data?.offset || nextOffset || 0);
    } catch (err) {
      setError(err.message || 'Neuspjelo učitavanje analiza.');
    } finally {
      setLoading(false);
    }
  }, [enabled, limit, offset, token]);

  useEffect(() => {
    if (!enabled || !token) return;
    loadRuns(0);
  }, [enabled, token, loadRuns]);

  const nextPage = useCallback(() => {
    const nextOffset = offset + limit;
    if (nextOffset >= count) return;
    loadRuns(nextOffset);
  }, [count, limit, loadRuns, offset]);

  const prevPage = useCallback(() => {
    const nextOffset = Math.max(0, offset - limit);
    loadRuns(nextOffset);
  }, [limit, loadRuns, offset]);

  return {
    runs,
    count,
    limit,
    offset,
    loading,
    error,
    hasPrev: offset > 0,
    hasNext: offset + limit < count,
    loadRuns,
    nextPage,
    prevPage,
  };
}
