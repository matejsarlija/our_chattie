import { useEffect, useRef, useState } from 'react';
import { SseEventParser } from '../utils/sseEventParser';
import { resolveApiUrl } from '../lib/apiClient';

export function useAnalysisRunStream({
  runId,
  enabled = true,
  afterSeq = 0,
  onSnapshot,
  onRunUpdated,
  onEventCreated,
  onPreflight,
  onTerminal,
  onHeartbeat,
  onError,
}) {
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState(null);
  const lastSeqRef = useRef({ runId: null, seq: 0 });
  const callbacksRef = useRef({
    onSnapshot,
    onRunUpdated,
    onEventCreated,
    onPreflight,
    onTerminal,
    onHeartbeat,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onSnapshot,
      onRunUpdated,
      onEventCreated,
      onPreflight,
      onTerminal,
      onHeartbeat,
      onError,
    };
  }, [onSnapshot, onRunUpdated, onEventCreated, onPreflight, onTerminal, onHeartbeat, onError]);

  useEffect(() => {
    const normalizedAfterSeq = Number.isSafeInteger(Number(afterSeq)) && Number(afterSeq) > 0
      ? Number(afterSeq)
      : 0;
    if (lastSeqRef.current.runId !== runId) {
      lastSeqRef.current = { runId: runId || null, seq: normalizedAfterSeq };
    } else if (normalizedAfterSeq > lastSeqRef.current.seq) {
      lastSeqRef.current.seq = normalizedAfterSeq;
    }
  }, [runId, afterSeq]);

  useEffect(() => {
    if (!enabled || !runId) {
      setConnected(false);
      return undefined;
    }

    const normalizedAfterSeq = Number.isSafeInteger(Number(afterSeq)) && Number(afterSeq) > 0
      ? Number(afterSeq)
      : 0;
    if (lastSeqRef.current.runId !== runId) {
      lastSeqRef.current = { runId, seq: normalizedAfterSeq };
    } else if (normalizedAfterSeq > lastSeqRef.current.seq) {
      lastSeqRef.current.seq = normalizedAfterSeq;
    }

    const controller = new AbortController();
    const parser = new SseEventParser();
    let cancelled = false;

    const reportError = (message) => {
      callbacksRef.current.onError?.(message);
    };

    const handleMessage = (message) => {
      if (!message) return;
      setLastEventAt(Date.now());

      const payload = message.data || {};
      const candidateSeq = payload?.seq ?? payload?.event?.seq ?? (message?.id != null ? Number(message.id) : null);
      if (Number.isSafeInteger(candidateSeq) && candidateSeq > lastSeqRef.current.seq) {
        lastSeqRef.current.seq = candidateSeq;
      }

      switch (message.event) {
        case 'snapshot':
          callbacksRef.current.onSnapshot?.(payload);
          break;
        case 'run.preflight':
          callbacksRef.current.onPreflight?.(payload);
          if (payload?.event) {
            callbacksRef.current.onEventCreated?.({ event: payload.event });
          }
          break;
        case 'stage.progress':
          callbacksRef.current.onEventCreated?.({ event: payload.event });
          break;
        case 'terminal':
        case 'run.terminal':
          callbacksRef.current.onTerminal?.(payload);
          controller.abort();
          break;
        case 'heartbeat':
          callbacksRef.current.onHeartbeat?.(payload);
          break;
        case 'error':
          reportError(payload?.error || 'Stream error.');
          break;
        default:
          break;
      }
    };

    const run = async () => {
      try {
        const resumeSeq = lastSeqRef.current.runId === runId ? lastSeqRef.current.seq : 0;
        const streamPath = resumeSeq > 0
          ? `/api/analysis/runs/${runId}/stream?afterSeq=${resumeSeq}`
          : `/api/analysis/runs/${runId}/stream`;
        const response = await fetch(resolveApiUrl(streamPath), {
          method: 'GET',
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || `Stream failed with status ${response.status}`);
        }

        if (!response.body) {
          throw new Error('Stream body is not available.');
        }

        setConnected(true);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const messages = parser.parseChunk(chunk);
            messages.forEach(handleMessage);
          }

          const trailing = parser.flush();
          if (trailing) {
            handleMessage(trailing);
          }
        } finally {
          reader.releaseLock();
        }

        if (!cancelled && !controller.signal.aborted) {
          setConnected(false);
          reportError('Stream connection ended.');
        }
      } catch (err) {
        if (cancelled || err?.name === 'AbortError') {
          return;
        }
        setConnected(false);
        reportError(err?.message || 'Stream connection failed.');
      }
    };

    run();

    return () => {
      cancelled = true;
      setConnected(false);
      controller.abort();
    };
  }, [enabled, runId]);

  return {
    connected,
    lastEventAt,
  };
}
