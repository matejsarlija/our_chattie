const { formatRunEvent } = require('./runBus');

function parseAfterSeq(queryValue, headerValue) {
  const raw = queryValue ?? headerValue;
  if (raw == null || raw === '') return 0;
  if (!/^\d+$/.test(String(raw))) return null;
  const seq = Number(raw);
  return Number.isSafeInteger(seq) ? seq : null;
}

function createAnalysisRunStreamHandler({ getAnalysisRun, getAnalysisEventsAfterSeq, runBus, heartbeatMs = 25000 }) {
  return async function analysisRunStreamHandler(req, res) {
    const afterSeq = parseAfterSeq(req.query?.afterSeq, req.get?.('Last-Event-ID') || req.headers?.['last-event-id']);
    if (afterSeq === null) return res.status(400).json({ error: 'Invalid event sequence.' });

    try {
      await getAnalysisRun({ id: req.params.id });
    } catch {
      return res.status(404).json({ error: 'Analysis run not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    let replaying = true;
    let lastSeq = afterSeq;
    let heartbeatTimer = null;
    const pending = [];

    const cleanup = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      unsubscribe();
    };
    const closeStream = () => {
      if (closed) return;
      closed = true;
      cleanup();
      if (!res.writableEnded) res.end();
    };
    const send = (message) => {
      if (closed || message.seq <= lastSeq) return false;
      res.write(message.frame);
      lastSeq = message.seq;
      if (message.event === 'run.terminal') closeStream();
      return true;
    };
    const onMessage = (message) => {
      if (message.event === 'close') return closeStream();
      if (replaying) pending.push(message);
      else send(message);
    };
    const unsubscribe = runBus.subscribe(req.params.id, onMessage);
    req.on('close', closeStream);

    try {
      const history = await getAnalysisEventsAfterSeq({ analysisId: req.params.id, afterSeq });
      for (const row of history) {
        const message = formatRunEvent(row);
        if (message.seq > lastSeq) send(message);
        if (closed) return;
      }
      pending.sort((left, right) => left.seq - right.seq);
      replaying = false;
      for (const message of pending) {
        if (message.seq > lastSeq) send(message);
        if (closed) return;
      }
    } catch (error) {
      console.error('[Analysis Runs] stream replay failed:', error.message);
      closeStream();
      return;
    }

    heartbeatTimer = setInterval(() => {
      if (!closed && !res.writableEnded) res.write(`event: heartbeat\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
    }, heartbeatMs);
  };
}

module.exports = { createAnalysisRunStreamHandler, parseAfterSeq };
