import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../lib/apiClient';

const TERMINAL = new Set(['done', 'error', 'failed', 'completed', 'canceled']);

export function useAnalysisRunDetail({ runId, token, pollMs = 5000, enabled = true }) {
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadRun = useCallback(async () => {
    if (!enabled || !token || !runId) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/api/analysis/runs/${runId}`, { token });
      setRun(data?.run || null);
    } catch (err) {
      setError(err.message || 'Neuspjelo učitavanje analize.');
    } finally {
      setLoading(false);
    }
  }, [enabled, runId, token]);

  const loadEvents = useCallback(async () => {
    if (!enabled || !token || !runId) return;
    setEventsLoading(true);
    try {
      const data = await apiFetch(`/api/analysis/runs/${runId}/events`, { token });
      setEvents(data?.events || []);
    } catch (err) {
      setError((prev) => prev || err.message || 'Neuspjelo učitavanje događaja.');
    } finally {
      setEventsLoading(false);
    }
  }, [enabled, runId, token]);

  useEffect(() => {
    if (!enabled || !token || !runId) return;
    loadRun();
    loadEvents();
  }, [enabled, runId, token, loadRun, loadEvents]);

  const isRunning = useMemo(() => {
    const status = String(run?.status || '').toLowerCase();
    return Boolean(status) && !TERMINAL.has(status);
  }, [run?.status]);

  const lastUpdatedAt = useMemo(
    () => run?.completed_at || run?.updated_at || run?.created_at || null,
    [run?.completed_at, run?.updated_at, run?.created_at],
  );

  useEffect(() => {
    if (!enabled || !token || !runId || !isRunning) return;

    const interval = setInterval(() => {
      loadRun();
      loadEvents();
    }, pollMs);

    return () => clearInterval(interval);
  }, [enabled, token, runId, isRunning, pollMs, loadRun, loadEvents]);

  return {
    run,
    events,
    loading,
    eventsLoading,
    error,
    isRunning,
    lastUpdatedAt,
    refresh: async () => {
      await loadRun();
      await loadEvents();
    },
  };
}
