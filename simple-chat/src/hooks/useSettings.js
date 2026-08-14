import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../lib/apiClient';

const DEFAULT_SETTINGS = { geminiPlan: 'free' };

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
      setSettings(data?.settings || DEFAULT_SETTINGS);
    } catch (err) {
      setError(err.message || 'Neuspjelo učitavanje postavki.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveGeminiPlan = useCallback(async (geminiPlan) => {
    setSaving(true);
    setError('');
    try {
      const data = await updateSettings({ geminiPlan });
      setSettings(data?.settings || { ...settings, geminiPlan });
      return data?.settings || { ...settings, geminiPlan };
    } catch (err) {
      setError(err.message || 'Neuspjelo spremanje postavki.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return {
    settings,
    geminiPlan: settings.geminiPlan,
    loading,
    saving,
    error,
    loadSettings,
    saveGeminiPlan,
  };
}
