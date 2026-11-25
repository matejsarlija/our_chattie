function createAnalysisRunStreamHandler({
  getAnalysisRunFull,
  buildSseEvent,
  isTerminalStatus,
  buildCursor,
  didRunChange,
  getNewEvents,
  shouldStartStreamTimers,
  streamPollMs = 1500,
  heartbeatMs = 25000,
}) {
  return async function analysisRunStreamHandler(req, res) {
    let currentState;
    try {
      currentState = await getAnalysisRunFull({
        id: req.params.id,
      });
    } catch (error) {
      console.error('[Analysis Runs] stream init failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let pollInFlight = false;
    let heartbeatTimer = null;
    let pollTimer = null;

    const cleanup = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const closeStream = () => {
      if (closed) return;
      closed = true;
      cleanup();
      if (!res.writableEnded) {
        res.end();
      }
    };

    const emit = (eventName, payload) => {
      if (closed || res.writableEnded) return false;
      res.write(buildSseEvent(eventName, payload));
      return true;
    };

    req.on('close', () => {
      closeStream();
    });

    let lastRun = currentState.run;
    let lastEvents = currentState.events || [];
    const snapshotSent = emit('snapshot', {
      run: lastRun,
      events: lastEvents,
      cursor: buildCursor(lastEvents),
    });
    if (!snapshotSent) {
      closeStream();
      return;
    }

    if (isTerminalStatus(lastRun?.status)) {
      emit('terminal', {
        run: lastRun,
        cursor: buildCursor(lastEvents),
      });
      closeStream();
      return;
    }

    if (!shouldStartStreamTimers({
      snapshotSent,
      closed,
      writableEnded: res.writableEnded,
    })) {
      return;
    }

    heartbeatTimer = setInterval(() => {
      emit('heartbeat', { ts: new Date().toISOString() });
    }, heartbeatMs);

    pollTimer = setInterval(async () => {
      if (closed || pollInFlight) return;
      pollInFlight = true;

      try {
        const latest = await getAnalysisRunFull({
          id: req.params.id,
        });

        const runChanged = didRunChange(lastRun, latest.run);
        const newEvents = getNewEvents(lastEvents, latest.events);
        const cursor = buildCursor(latest.events);

        if (runChanged) {
          emit('run.updated', { run: latest.run, cursor });
        }

        for (const event of newEvents) {
          emit('event.created', { event, cursor });
        }

        lastRun = latest.run;
        lastEvents = latest.events || [];

        if (isTerminalStatus(latest.run?.status)) {
          emit('terminal', { run: latest.run, cursor });
          closeStream();
        }
      } catch (error) {
        console.error('[Analysis Runs] stream update failed:', error.message);
        emit('error', { error: 'Stream update failed.' });
        closeStream();
      } finally {
        pollInFlight = false;
      }
    }, streamPollMs);
  };
}

module.exports = {
  createAnalysisRunStreamHandler,
};
