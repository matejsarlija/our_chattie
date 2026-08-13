const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'analysis');

function getDataDir(override) {
  return override || process.env.ANALYSIS_DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createId() {
  return crypto.randomUUID();
}

function createLocalStore(options = {}) {
  const dataDir = getDataDir(options.dataDir);
  const runsFile = path.join(dataDir, 'runs.json');
  const eventsFile = path.join(dataDir, 'events.json');

  let writeQueue = Promise.resolve();

  function enqueue(task) {
    const next = writeQueue.then(task, task);
    writeQueue = next.catch(() => {});
    return next;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function readRuns() {
    return readJson(runsFile, []);
  }

  function writeRuns(runs) {
    writeJson(runsFile, runs);
  }

  function readEventsMap() {
    return readJson(eventsFile, {});
  }

  function writeEventsMap(map) {
    writeJson(eventsFile, map);
  }

  function findRun(runs, id) {
    const run = runs.find((item) => item.id === id);
    if (!run) {
      throw new Error('Analysis run not found.');
    }
    return run;
  }

  async function createAnalysisRun({ oib, queryType = null, queryValue = null, status = 'running' }) {
    return enqueue(() => {
      const runs = readRuns();
      const run = {
        id: createId(),
        oib: oib ?? null,
        query_type: queryType || null,
        query_value: queryValue || null,
        status,
        result_format: 'markdown',
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      runs.push(run);
      writeRuns(runs);

      const eventsMap = readEventsMap();
      eventsMap[run.id] = [];
      writeEventsMap(eventsMap);

      return run;
    });
  }

  async function appendAnalysisEvent({ analysisId, eventType, message, metadata }) {
    return enqueue(() => {
      const runs = readRuns();
      const run = findRun(runs, analysisId);
      run.updated_at = nowIso();
      writeRuns(runs);

      const eventsMap = readEventsMap();
      const events = eventsMap[analysisId] || [];
      events.push({
        id: createId(),
        analysis_id: analysisId,
        event_type: eventType || 'progress',
        message: message || null,
        metadata: metadata || {},
        created_at: nowIso(),
      });
      eventsMap[analysisId] = events;
      writeEventsMap(eventsMap);

      return events[events.length - 1];
    });
  }

  async function completeAnalysisRun({ analysisId, resultText, resultJson = null }) {
    return enqueue(() => {
      const runs = readRuns();
      const run = findRun(runs, analysisId);
      run.status = 'done';
      run.result_text = resultText;
      run.result_format = 'markdown';
      run.result_json = resultJson;
      run.completed_at = nowIso();
      run.updated_at = nowIso();
      writeRuns(runs);
      return run;
    });
  }

  async function failAnalysisRun({ analysisId, errorMessage, resultJson = null, resultText = null }) {
    return enqueue(() => {
      const runs = readRuns();
      const run = findRun(runs, analysisId);
      run.status = 'error';
      run.error = errorMessage;
      if (resultJson !== null) run.result_json = resultJson;
      if (resultText !== null) run.result_text = resultText;
      run.completed_at = nowIso();
      run.updated_at = nowIso();
      writeRuns(runs);
      return run;
    });
  }

  async function listAnalysisRuns({ limit, offset }) {
    const runs = readRuns();
    const sorted = [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const page = sorted.slice(offset, offset + limit);
    return { data: page, count: sorted.length };
  }

  async function getAnalysisRun({ id }) {
    const runs = readRuns();
    return findRun(runs, id);
  }

  async function getAnalysisEvents({ analysisId }) {
    const eventsMap = readEventsMap();
    const events = eventsMap[analysisId] || [];
    return [...events].sort((a, b) => {
      if (a.created_at === b.created_at) return a.id < b.id ? -1 : 1;
      return a.created_at < b.created_at ? -1 : 1;
    });
  }

  async function getAnalysisRunFull({ id }) {
    const [run, events] = await Promise.all([
      getAnalysisRun({ id }),
      getAnalysisEvents({ analysisId: id }),
    ]);
    return { run, events };
  }

  function reset() {
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (err) {
      // Best-effort reset.
    }
    return dataDir;
  }

  return {
    dataDir,
    createAnalysisRun,
    appendAnalysisEvent,
    completeAnalysisRun,
    failAnalysisRun,
    listAnalysisRuns,
    getAnalysisRun,
    getAnalysisEvents,
    getAnalysisRunFull,
    reset,
  };
}

module.exports = {
  createLocalStore,
  DEFAULT_DATA_DIR,
};
