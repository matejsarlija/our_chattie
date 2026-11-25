const MAX_SSE_FRAME_BYTES = 2048;
const LANES = ['download', 'preflight', 'ocr', 'extract'];
const STAGE_TO_LANE = {
  downloading: 'download',
  preflight: 'preflight',
  ocr: 'ocr',
  extracting: 'extract',
};
const ALLOWED_METADATA = ['kind', 'stage', 'done', 'failed', 'total', 'unit', 'progress', 'lanes', 'fileName', 'status', 'reasonCode'];

function safeMetadata(metadata = {}) {
  return Object.fromEntries(ALLOWED_METADATA.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
}

function makeFrame(row, eventName, payload, maxFrameBytes = MAX_SSE_FRAME_BYTES) {
  let data = JSON.stringify(payload);
  let frame = `id: ${row.seq}\nevent: ${eventName}\ndata: ${data}\n\n`;
  if (Buffer.byteLength(frame) > maxFrameBytes) {
    const compact = {
      runId: payload.runId,
      seq: row.seq,
      stage: payload.stage,
      status: payload.status,
      message: typeof payload.message === 'string' ? payload.message.slice(0, 256) : undefined,
      lanes: payload.lanes,
      run: payload.run,
      event: payload.event ? {
        id: payload.event.id,
        analysis_id: payload.event.analysis_id,
        seq: payload.event.seq,
        event_type: payload.event.event_type,
        message: typeof payload.event.message === 'string' ? payload.event.message.slice(0, 256) : null,
        metadata: payload.lanes ? { lanes: payload.lanes } : {},
      } : undefined,
    };
    data = JSON.stringify(compact);
    frame = `id: ${row.seq}\nevent: ${eventName}\ndata: ${data}\n\n`;
  }
  if (Buffer.byteLength(frame) > maxFrameBytes) throw new Error(`SSE delta exceeded ${maxFrameBytes} bytes.`);
  return frame;
}

function formatRunEvent(row, maxFrameBytes = MAX_SSE_FRAME_BYTES) {
  const metadata = safeMetadata(row.metadata || {});
  const eventName = row.event_type === 'run.terminal' ? 'run.terminal' : 'stage.progress';
  const lanes = metadata.lanes || Object.fromEntries(LANES.map((lane) => [lane, null]));
  const payload = eventName === 'run.terminal'
    ? { runId: row.analysis_id || row.run_id, seq: row.seq, status: metadata.status, run: { id: row.analysis_id || row.run_id, status: metadata.status } }
    : {
      runId: row.analysis_id || row.run_id,
      seq: row.seq,
      stage: row.event_type,
      message: typeof row.message === 'string' ? row.message.slice(0, 512) : null,
      lanes,
      event: {
        id: row.id,
        analysis_id: row.analysis_id || row.run_id,
        seq: row.seq,
        event_type: row.event_type,
        message: typeof row.message === 'string' ? row.message.slice(0, 512) : null,
        metadata: { ...metadata, lanes },
      },
    };
  return { event: eventName, seq: row.seq, payload, frame: makeFrame(row, eventName, payload, maxFrameBytes) };
}

function createRunBus({ analysisStore, maxFrameBytes = MAX_SSE_FRAME_BYTES }) {
  const subscribers = new Map();
  const laneState = new Map();
  const terminalPromises = new Map();

  function lanesFor(runId, stage, metadata) {
    const lanes = laneState.get(runId) || Object.fromEntries(LANES.map((lane) => [lane, null]));
    const lane = STAGE_TO_LANE[stage] || STAGE_TO_LANE[metadata.stage];
    if (lane) {
      lanes[lane] = {
        done: Number.isFinite(metadata.done) ? metadata.done : null,
        failed: Number.isFinite(metadata.failed) ? metadata.failed : 0,
        total: Number.isFinite(metadata.total) ? metadata.total : null,
        unit: typeof metadata.unit === 'string' ? metadata.unit : null,
      };
    }
    laneState.set(runId, lanes);
    return { ...lanes };
  }

  function broadcast(runId, message) {
    const listeners = subscribers.get(runId);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(message);
  }

  async function publish({ runId, eventType, message = null, metadata = {} }) {
    if (terminalPromises.has(runId)) return null;
    const lanes = lanesFor(runId, eventType, metadata);
    const persistedMetadata = { ...safeMetadata(metadata), lanes };
    const row = await analysisStore.appendAnalysisEvent({ analysisId: runId, eventType, message, metadata: persistedMetadata });
    const live = formatRunEvent({ ...row, analysis_id: runId }, maxFrameBytes);
    broadcast(runId, { ...live, payload: live.payload });
    return row;
  }

  function publishTerminal(runId, status) {
    if (terminalPromises.has(runId)) return terminalPromises.get(runId);
    const promise = (async () => {
      const row = await analysisStore.appendAnalysisEvent({
        analysisId: runId,
        eventType: 'run.terminal',
        message: null,
        metadata: { status },
      });
      const live = formatRunEvent({ ...row, analysis_id: runId }, maxFrameBytes);
      broadcast(runId, live);
      laneState.delete(runId);
      return row;
    })();
    terminalPromises.set(runId, promise);
    return promise;
  }

  function subscribe(runId, listener) {
    if (!subscribers.has(runId)) subscribers.set(runId, new Set());
    const listeners = subscribers.get(runId);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) subscribers.delete(runId);
    };
  }

  function closeAll() {
    for (const listeners of subscribers.values()) {
      for (const listener of [...listeners]) listener({ event: 'close' });
    }
    subscribers.clear();
    laneState.clear();
  }

  return {
    publish,
    publishTerminal,
    subscribe,
    closeAll,
    maxFrameBytes,
    activeLaneRunCount: () => laneState.size,
  };
}

module.exports = { createRunBus, formatRunEvent, MAX_SSE_FRAME_BYTES, LANES, STAGE_TO_LANE };
