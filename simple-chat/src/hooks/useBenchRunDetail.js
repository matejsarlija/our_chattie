import { useCallback, useEffect, useState } from 'react';
import {
  getBenchReview,
  getBenchRunReport,
  getBenchRunTraces,
  submitBenchReview,
} from '../lib/apiClient';

export function useBenchRunDetail(runId) {
  const [report, setReport] = useState(null);
  const [traces, setTraces] = useState([]);
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setError(null);
    try {
      const [rep, tr] = await Promise.all([
        getBenchRunReport(runId),
        getBenchRunTraces(runId).catch(() => ({ traces: [] })),
      ]);
      setReport(rep);
      setTraces(tr?.traces || []);
    } catch (err) {
      setError(err.message || 'Greška pri učitavanju Bench izvještaja.');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const loadReview = useCallback(async (sample = 3, seed = 7) => {
    const data = await getBenchReview(runId, { sample, seed });
    setReview(data);
    return data;
  }, [runId]);

  const saveVerdicts = useCallback(async (verdicts) => {
    const res = await submitBenchReview(runId, verdicts);
    await loadReview();
    return res;
  }, [runId, loadReview]);

  return {
    report,
    traces,
    review,
    loading,
    error,
    reload: load,
    loadReview,
    saveVerdicts,
  };
}
