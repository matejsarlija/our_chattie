import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunFacts } from '../lib/apiClient';

const DEFAULT_FILTERS = {
  kind: '',
  partyId: '',
  grounded: undefined,
  q: '',
};

const DEFAULT_LIMIT = 50;

export function useRunFacts(runId, { limit = DEFAULT_LIMIT, enabled = true } = {}) {
  const [facts, setFacts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [offset, setOffset] = useState(0);

  const abortRef = useRef(null);

  useEffect(() => {
    setFilters(DEFAULT_FILTERS);
    setOffset(0);
  }, [runId]);

  useEffect(() => {
    if (!enabled || !runId) {
      setFacts([]);
      setTotal(0);
      setLoading(false);
      setError('');
      return undefined;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');

    const params = {
      limit,
      offset,
    };
    if (filters.kind) params.kind = filters.kind;
    if (filters.partyId) params.partyId = filters.partyId;
    if (filters.grounded !== undefined && filters.grounded !== null && filters.grounded !== '') {
      params.grounded = filters.grounded;
    }
    if (filters.q && String(filters.q).trim()) {
      params.q = String(filters.q).trim();
    }

    Promise.resolve(getRunFacts(runId, params, { signal: controller.signal }))
      .then((data) => {
        if (controller.signal.aborted) return;
        setFacts(Array.isArray(data?.facts) ? data.facts : []);
        setTotal(Number.isFinite(Number(data?.total)) ? Number(data.total) : 0);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        setFacts([]);
        setTotal(0);
        setLoading(false);
        setError(err?.message || 'Učitavanje činjenica nije uspjelo.');
      });

    return () => {
      controller.abort();
    };
  }, [runId, enabled, limit, offset, filters]);

  const setFilter = useCallback((keyOrPatch, value) => {
    setOffset(0);
    setFilters((prev) => {
      if (typeof keyOrPatch === 'string') {
        return { ...prev, [keyOrPatch]: value };
      }
      if (keyOrPatch && typeof keyOrPatch === 'object') {
        return { ...prev, ...keyOrPatch };
      }
      return prev;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setOffset(0);
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasPrev = offset > 0;
  const hasNext = offset + facts.length < total;

  const nextPage = useCallback(() => {
    setOffset((prev) => (prev + facts.length < total ? prev + limit : prev));
  }, [facts.length, total, limit]);

  const prevPage = useCallback(() => {
    setOffset((prev) => Math.max(0, prev - limit));
  }, [limit]);

  return {
    facts,
    total,
    loading,
    error,
    filters,
    setFilter,
    resetFilters,
    offset,
    limit,
    hasNext,
    hasPrev,
    nextPage,
    prevPage,
  };
}

export default useRunFacts;
