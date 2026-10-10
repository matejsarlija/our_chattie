import { useCallback, useEffect, useState } from 'react';
import { listLabPackages } from '../lib/apiClient';

export function useLabPackages({ enabled = true } = {}) {
  const [packages, setPackages] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPackages = useCallback(async () => {
    if (!enabled) return;

    setLoading(true);
    setError('');

    try {
      const data = await listLabPackages();
      setPackages(data?.packages || []);
      setCount(data?.count ?? (data?.packages || []).length);
    } catch (err) {
      setError(err.message || 'Neuspjelo učitavanje paketa.');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    loadPackages();
  }, [enabled, loadPackages]);

  return { packages, count, loading, error, reload: loadPackages };
}
