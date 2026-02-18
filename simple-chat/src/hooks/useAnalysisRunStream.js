import { useEffect, useRef, useState } from 'react';
import { SseEventParser } from '../utils/sseEventParser';

export function useAnalysisRunStream({
  runId,
  token,
  enabled = true,
  onSnapshot,
  onRunUpdated,
  onEventCreated,
  onTerminal,
  onHeartbeat,
  onError,
}) {
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState(null);
  const callbacksRef = useRef({
    onSnapshot,
    onRunUpdated,
    onEventCreated,
    onTerminal,
    onHeartbeat,
    onError,
  });

  useEffect(() => {
    callbacksRef.current = {
      onSnapshot,
      onRunUpdated,
      onEventCreated,
      onTerminal,
      onHeartbeat,
      onError,
    };
  }, [onSnapshot, onRunUpdated, onEventCreated, onTerminal, onHeartbeat, onError]);

  useEffect(() => {
    if (!enabled || !token || !runId) {
      setConnected(false);
      return undefined;
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
      switch (message.event) {
        case 'snapshot':
          callbacksRef.current.onSnapshot?.(payload);
          break;
        case 'run.updated':
          callbacksRef.current.onRunUpdated?.(payload);
          break;
        case 'event.created':
          callbacksRef.current.onEventCreated?.(payload);
          break;
        case 'terminal':
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
        const response = await fetch(`/api/analysis/runs/${runId}/stream`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
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
  }, [enabled, runId, token]);

  return {
    connected,
    lastEventAt,
  };
}
