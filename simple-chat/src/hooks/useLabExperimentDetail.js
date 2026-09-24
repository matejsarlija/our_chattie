import { useCallback, useEffect, useState } from 'react';
import { getLabExperiment } from '../lib/apiClient';

export function useLabExperimentDetail(experimentId, { enabled = true } = {}) {
  const [experiment, setExperiment] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadExperiment = useCallback(async () => {
    if (!enabled || !experimentId) return;

    setLoading(true);
    setError('');

    try {
      const data = await getLabExperiment(experimentId);
      setExperiment(data?.experiment || null);
      setComparison(data?.comparison || null);
      if (!data?.experiment) {
        setError('Eksperiment nije pronađen.');
      }
    } catch (err) {
      setExperiment(null);
      setComparison(null);
      setError(err.message || 'Neuspjelo učitavanje eksperimenta.');
    } finally {
      setLoading(false);
    }
  }, [enabled, experimentId]);

  useEffect(() => {
    loadExperiment();
  }, [loadExperiment]);

  return { experiment, comparison, loading, error, reload: loadExperiment };
}
