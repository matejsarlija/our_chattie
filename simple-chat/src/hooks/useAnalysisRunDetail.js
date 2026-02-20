import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/apiClient';
import { useAnalysisRunStream } from './useAnalysisRunStream';

const TERMINAL = new Set(['done', 'error', 'failed', 'completed', 'canceled']);
const MAX_BACKOFF_MS = 60_000;

const withJitter = (ms) => {
  const factor = 0.8 + Math.random() * 0.4;
  return Math.max(1_000, Math.round(ms * factor));
};

const parseRetryAfterMs = (retryAfter) => {
  if (!retryAfter) return null;

  const asNumber = Number(retryAfter);
  if (Number.isFinite(asNumber) && asNumber >= 0) {
    return asNumber * 1_000;
  }

  const asDate = Date.parse(retryAfter);
  if (Number.isNaN(asDate)) {
    return null;
  }

  return Math.max(0, asDate - Date.now());
};

const nextBackoffMs = ({ currentMs, pollMs, retryAfterMs }) => {
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  }

  const stepped = currentMs > pollMs ? currentMs * 2 : pollMs * 2;
  return Math.min(stepped, MAX_BACKOFF_MS);
};

export function useAnalysisRunDetail({ runId, token, pollMs = 5000, enabled = true, streamEnabled = false }) {
  const [run, setRun] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamError, setStreamError] = useState('');
  const [streamFallback, setStreamFallback] = useState(false);
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return document.visibilityState !== 'hidden';
  });

  const pollInFlightRef = useRef(false);
  const pollDelayRef = useRef(pollMs);
  const pollTimeoutRef = useRef(null);
  const previousVisibleRef = useRef(isVisible);

  const clearTimer = useCallback(() => {
    if (!pollTimeoutRef.current) return;
    clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    pollDelayRef.current = pollMs;
  }, [pollMs]);

  useEffect(() => {
    setStreamFallback(false);
    setStreamError('');
  }, [runId, token]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState !== 'hidden');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  const loadDetail = useCallback(async ({ silent = false } = {}) => {
    if (!enabled || !token || !runId) return { ok: false, run: null };

    if (!silent) {
      setLoading(true);
      setEventsLoading(true);
    }

    try {
      const data = await apiFetch(`/api/analysis/runs/${runId}/full`, { token });
      const nextRun = data?.run || null;
      const nextEvents = data?.events || [];

      setRun(nextRun);
      setEvents(nextEvents);
      setError('');
      setStreamError('');
      pollDelayRef.current = pollMs;
      return { ok: true, run: nextRun };
    } catch (err) {
      setError((prev) => prev || err.message || 'Neuspjelo učitavanje analize.');
      const retryAfterMs = parseRetryAfterMs(err?.retryAfter);
      const shouldBackoff = err?.status === 429 || (err?.status >= 500 && err?.status < 600) || !err?.status;
      if (shouldBackoff) {
        pollDelayRef.current = nextBackoffMs({
          currentMs: pollDelayRef.current,
          pollMs,
          retryAfterMs,
        });
      }
      return { ok: false, run: null };
    } finally {
      if (!silent) {
        setLoading(false);
        setEventsLoading(false);
      }
    }
  }, [enabled, runId, token, pollMs]);

  useEffect(() => {
    if (!enabled || !token || !runId) return;
    clearTimer();
    void loadDetail();
  }, [enabled, runId, token, loadDetail, clearTimer]);

  const isRunning = useMemo(() => {
    const status = String(run?.status || '').toLowerCase();
    return Boolean(status) && !TERMINAL.has(status);
  }, [run?.status]);

  const shouldUseStream = streamEnabled
    && enabled
    && Boolean(token)
    && Boolean(runId)
    && isRunning
    && isVisible
    && !streamFallback;

  const { connected: streamConnected } = useAnalysisRunStream({
    runId,
    token,
    enabled: shouldUseStream,
    onSnapshot: (payload) => {
      setRun(payload?.run || null);
      setEvents(payload?.events || []);
      setLoading(false);
      setEventsLoading(false);
      setError('');
      setStreamError('');
      pollDelayRef.current = pollMs;
    },
    onRunUpdated: (payload) => {
      const nextRun = payload?.run || null;
      if (!nextRun) return;
      setRun(nextRun);
      setError('');
      setStreamError('');
      pollDelayRef.current = pollMs;
    },
    onEventCreated: (payload) => {
      const nextEvent = payload?.event;
      if (!nextEvent?.id) return;
      setEvents((prev) => {
        if (prev.some((event) => event.id === nextEvent.id)) {
          return prev;
        }
        return [...prev, nextEvent];
      });
      setStreamError('');
    },
    onTerminal: (payload) => {
      if (payload?.run) {
        setRun(payload.run);
      }
      setStreamError('');
      setStreamFallback(false);
    },
    onError: (message) => {
      setStreamError(message || 'Stream connection failed.');
      setStreamFallback(true);
    },
  });

  useEffect(() => {
    if (!streamFallback || !enabled || !token || !runId || !isRunning || !isVisible) return undefined;
    const retryTimer = setTimeout(() => {
      setStreamFallback(false);
      setStreamError('');
    }, 15_000);
    return () => clearTimeout(retryTimer);
  }, [streamFallback, enabled, token, runId, isRunning, isVisible, streamEnabled]);

  const lastUpdatedAt = useMemo(
    () => run?.completed_at || run?.updated_at || run?.created_at || null,
    [run?.completed_at, run?.updated_at, run?.created_at],
  );

  const connectionMode = useMemo(() => {
    if (!isRunning) return 'idle';
    if (shouldUseStream && streamConnected) return 'live';
    return 'syncing';
  }, [isRunning, shouldUseStream, streamConnected]);

  useEffect(() => {
    clearTimer();
    if (!enabled || !token || !runId || !isRunning || !isVisible || shouldUseStream) return undefined;

    let cancelled = false;

    const scheduleNext = (delayMs) => {
      if (cancelled) return;
      pollTimeoutRef.current = setTimeout(async () => {
        if (cancelled || pollInFlightRef.current) {
          scheduleNext(withJitter(Math.max(pollMs, pollDelayRef.current)));
          return;
        }

        pollInFlightRef.current = true;
        try {
          const result = await loadDetail({ silent: true });
          const status = String(result?.run?.status || '').toLowerCase();
          const terminal = Boolean(status) && TERMINAL.has(status);
          if (!terminal) {
            scheduleNext(withJitter(pollDelayRef.current));
          }
        } finally {
          pollInFlightRef.current = false;
        }
      }, delayMs);
    };

    scheduleNext(withJitter(pollMs));

    return () => {
      cancelled = true;
      clearTimer();
    };
  }, [enabled, token, runId, isRunning, isVisible, shouldUseStream, pollMs, loadDetail, clearTimer]);

  useEffect(() => {
    if (!enabled || !token || !runId) {
      previousVisibleRef.current = isVisible;
      return;
    }

    const becameVisible = !previousVisibleRef.current && isVisible;
    previousVisibleRef.current = isVisible;
    if (!becameVisible) return;

    void loadDetail({ silent: true });
  }, [enabled, token, runId, isVisible, loadDetail]);

  return {
    run,
    events,
    loading,
    eventsLoading,
    error: error || streamError,
    isRunning,
    connectionMode,
    lastUpdatedAt,
    refresh: async () => {
      await loadDetail();
    },
  };
}
