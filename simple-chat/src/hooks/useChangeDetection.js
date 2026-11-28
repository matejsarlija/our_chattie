import { useCallback, useEffect, useMemo, useState } from 'react';
import { getChangeDetectionHistory, runChangeDetectionCheck } from '../lib/apiClient';

const TERMINAL_ELIGIBLE = new Set(['done', 'partial', 'completed', 'complete', 'success']);

const inferQueryType = (value) => {
  const trimmed = String(value || '').trim();
  if (/^\d{11}$/.test(trimmed)) return 'oib';
  if (/[/-]\d{2,4}/.test(trimmed)) return 'case_number';
  return 'text';
};

const extractHistorySummary = (data) => {
  if (!data || typeof data !== 'object') {
    return { snapshots: [], diffs: [], lastCheckedAt: null };
  }
  if (Array.isArray(data.histories)) {
    const snapshots = data.histories.flatMap((h) => (Array.isArray(h?.snapshots) ? h.snapshots : []));
    const diffs = data.histories.flatMap((h) => (Array.isArray(h?.diffs) ? h.diffs : []));
    const latestDiff = diffs[diffs.length - 1] || null;
    const latestSnapshot = snapshots[snapshots.length - 1] || null;
    return {
      snapshots,
      diffs,
      lastCheckedAt: latestDiff?.checkedAt || latestDiff?.createdAt || latestSnapshot?.capturedAt || null,
    };
  }
  const snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
  const diffs = Array.isArray(data.diffs) ? data.diffs : [];
  const latestDiff = diffs[diffs.length - 1] || null;
  const latestSnapshot = snapshots[snapshots.length - 1] || null;
  return {
    snapshots,
    diffs,
    lastCheckedAt: latestDiff?.checkedAt || latestDiff?.createdAt || latestSnapshot?.capturedAt || null,
  };
};

export function useChangeDetection({ queryType, queryValue, status, enabled = true } = {}) {
  const [history, setHistory] = useState(null);
  const [latestCheck, setLatestCheck] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const isEligible = useMemo(() => {
    const normalizedStatus = String(status || '').toLowerCase();
    return Boolean(enabled && queryValue && TERMINAL_ELIGIBLE.has(normalizedStatus));
  }, [enabled, queryValue, status]);

  useEffect(() => {
    if (!isEligible || !queryValue) {
      setHistory(null);
      setLoadingHistory(false);
      return undefined;
    }

    let cancelled = false;
    setLoadingHistory(true);

    Promise.resolve(getChangeDetectionHistory(queryValue))
      .then((data) => {
        if (cancelled) return;
        setHistory(extractHistorySummary(data));
        setLoadingHistory(false);
      })
      .catch(() => {
        if (cancelled) return;
        // History is best-effort; do not block the UI on initial history lookup.
        setHistory(null);
        setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isEligible, queryValue]);

  const checkNow = useCallback(async () => {
    if (!isEligible || !queryValue || checking) return null;
    setChecking(true);
    setError('');
    try {
      const resolvedType = queryType || inferQueryType(queryValue);
      const data = await runChangeDetectionCheck({ type: resolvedType, value: queryValue });
      const checkedAt = data?.snapshot?.capturedAt || new Date().toISOString();
      const nextCheck = {
        baseline: Boolean(data?.baseline),
        snapshot: data?.snapshot || null,
        diff: data?.diff || { added: [], changed: [], removed: [] },
        warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        checkedAt,
      };
      setLatestCheck(nextCheck);
      setHistory((prev) => ({
        snapshots: [...(prev?.snapshots || []), ...(data?.snapshot ? [data.snapshot] : [])],
        diffs: [...(prev?.diffs || []), ...(data?.diff ? [data.diff] : [])],
        lastCheckedAt: checkedAt,
      }));
      return nextCheck;
    } catch (err) {
      const message = err?.message || 'Provjera novih objava nije uspjela.';
      setError(message);
      return null;
    } finally {
      setChecking(false);
    }
  }, [isEligible, queryType, queryValue, checking]);

  return {
    isEligible,
    history,
    latestCheck,
    loadingHistory,
    checking,
    error,
    checkNow,
  };
}

export default useChangeDetection;
