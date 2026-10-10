import { useCallback, useState } from 'react';
import { createLabExperiment } from '../lib/apiClient';

export function useCreateLabExperiment() {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState(null);

  const createExperiment = useCallback(async ({ evidencePackageRef }) => {
    if (!evidencePackageRef) {
      setCreateError('Odaberite ulazni paket.');
      return null;
    }

    setCreating(true);
    setCreateError('');

    try {
      const data = await createLabExperiment({ evidencePackageRef });
      setCreated(data || null);
      return data || null;
    } catch (err) {
      setCreateError(err.message || 'Neuspjelo pokretanje usporedbe.');
      return null;
    } finally {
      setCreating(false);
    }
  }, []);

  const reset = useCallback(() => {
    setCreateError('');
    setCreated(null);
  }, []);

  return { createExperiment, creating, createError, created, reset };
}
