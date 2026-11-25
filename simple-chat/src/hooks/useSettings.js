import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../lib/apiClient';

const DEFAULT_SETTINGS = { defaultScanDepth: 'balanced' };

export function useSettings() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getSettings();
      setSettings({ ...DEFAULT_SETTINGS, ...(data?.settings || {}) });
    } catch (err) {
      setError(err.message || 'Neuspjelo učitavanje postavki.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = useCallback(async (patch) => {
    setSaving(true);
    setError('');
    try {
      const data = await updateSettings(patch);
      const next = data?.settings || { ...settings, ...patch };
      setSettings({ ...DEFAULT_SETTINGS, ...next });
      return next;
    } catch (err) {
      setError(err.message || 'Neuspjelo spremanje postavki.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return { settings, loading, saving, error, loadSettings, saveSettings };
}
