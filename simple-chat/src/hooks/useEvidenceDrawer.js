import { useCallback, useEffect, useRef, useState } from 'react';
import { getRunChunk } from '../lib/apiClient';

export function useEvidenceDrawer(runId) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeContext, setActiveContext] = useState(null);
  const [chunk, setChunk] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const cacheRef = useRef(new Map());
  const abortRef = useRef(null);

  const abortInFlight = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    cacheRef.current.clear();
    return () => {
      abortInFlight();
    };
  }, [runId, abortInFlight]);

  const closeEvidence = useCallback(() => {
    abortInFlight();
    setIsOpen(false);
  }, [abortInFlight]);

  const openEvidence = useCallback(async (context = {}) => {
    abortInFlight();
    setIsOpen(true);
    setActiveContext(context);

    const chunkId = context?.chunkId || context?.sourceChunkId;
    if (!runId || !chunkId) {
      setChunk(null);
      setLoading(false);
      setError('Identifikator isječka (chunkId) nije dostupan za ovu stavku.');
      return;
    }

    const cacheKey = `${runId}:${chunkId}`;
    if (cacheRef.current.has(cacheKey)) {
      setChunk(cacheRef.current.get(cacheKey));
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setChunk(null);
    setLoading(true);
    setError('');

    try {
      const data = await getRunChunk(runId, chunkId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      cacheRef.current.set(cacheKey, data);
      setChunk(data);
      setLoading(false);
    } catch (err) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setChunk(null);
      setLoading(false);
      setError(
        err?.status === 404
          ? 'Izvorni isječak dokumenta nije pronađen.'
          : err?.message || 'Učitavanje izvornog isječka nije uspjelo.',
      );
    }
  }, [runId, abortInFlight]);

  return {
    isOpen,
    activeContext,
    chunk,
    loading,
    error,
    openEvidence,
    closeEvidence,
  };
}

export default useEvidenceDrawer;
