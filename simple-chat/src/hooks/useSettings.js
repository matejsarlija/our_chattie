import { useCallback, useEffect, useState } from 'react';
import { getSettings, updateSettings } from '../lib/apiClient';

const DEFAULT_SETTINGS = {
  reasoningRerankMode: 'auto',
  reasoningPlanner: 'on',
  reasoningFollowUp: 'on',
};

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

  // Generic patch saver for the reasoning experiment switches. The backend
  // validates each field; on failure the prior selection is kept and `error`
  // carries a Croatian message.
  const saveReasoningSettings = useCallback(async (patch) => {
    setSaving(true);
    setError('');
    try {
      const data = await updateSettings(patch);
      setSettings(data?.settings || { ...settings, ...patch });
      return data?.settings || { ...settings, ...patch };
    } catch (err) {
      setError(err.message || 'Neuspjelo spremanje postavki.');
      throw err;
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return {
    settings,
    reasoningRerankMode: settings.reasoningRerankMode,
    reasoningPlanner: settings.reasoningPlanner,
    reasoningFollowUp: settings.reasoningFollowUp,
    loading,
    saving,
    error,
    loadSettings,
    saveReasoningSettings,
  };
}
