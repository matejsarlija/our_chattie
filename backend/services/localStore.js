const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  DEFAULT_REASONING_SETTINGS,
  REASONING_RERANK_MODES,
  REASONING_ON_OFF,
} = require('../helpers/reasoningSettings');

const { buildRunSummary, toRunListItem } = require('../court-analysis/utils/runSummary');

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
  const settingsFile = path.join(dataDir, 'settings.json');

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

  function readSettings() {
    const settings = readJson(settingsFile, {});
    return {
      reasoningRerankMode: REASONING_RERANK_MODES.includes(settings.reasoningRerankMode)
        ? settings.reasoningRerankMode
        : DEFAULT_REASONING_SETTINGS.rerankMode,
      reasoningPlanner: REASONING_ON_OFF.includes(settings.reasoningPlanner)
        ? settings.reasoningPlanner
        : DEFAULT_REASONING_SETTINGS.planner,
      reasoningFollowUp: REASONING_ON_OFF.includes(settings.reasoningFollowUp)
        ? settings.reasoningFollowUp
        : DEFAULT_REASONING_SETTINGS.followUp,
    };
  }

  function writeSettings(settings) {
    writeJson(settingsFile, settings);
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
        token_usage: null,
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

  async function updateAnalysisRunUsage({ analysisId, usage }) {
    return enqueue(() => {
      const runs = readRuns();
      const run = findRun(runs, analysisId);
      run.token_usage = usage ?? null;
      run.updated_at = nowIso();
      writeRuns(runs);
      return run;
    });
  }

  async function updateAnalysisRunReport({ analysisId, resultText, resultJson = null }) {
    return enqueue(() => {
      const runs = readRuns();
      const run = findRun(runs, analysisId);
      if (typeof resultText === 'string') run.result_text = resultText;
      if (resultJson !== null && resultJson !== undefined) {
        const stored = (run.result_json && typeof run.result_json === 'object') ? run.result_json : {};
        run.result_json = { ...stored, ...resultJson };
      }
      run.updated_at = nowIso();
      writeRuns(runs);
      return run;
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
      // Project the listable facts once, at completion, so the list endpoint
      // never has to ship result_json. buildRunSummary never throws, so this
      // cannot fail an otherwise-successful analysis.
      run.summary = buildRunSummary({ run, resultJson });
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
      // A failed run can still have discovered a case and partially analysed
      // documents, so the list row is worth populating.
      run.summary = buildRunSummary({ run, resultJson: run.result_json });
      run.completed_at = nowIso();
      run.updated_at = nowIso();
      writeRuns(runs);
      return run;
    });
  }

  /**
   * List runs, newest first.
   *
   * By default the heavy payload is stripped: each run carries ~120KB of
   * `result_text` + `result_json`, so a 10-row page was costing ~2.75MB. The
   * pre-projected `summary` carries everything a list view needs, and the full
   * payload stays available on the single-run endpoints.
   *
   * `includeResults: true` returns the full records and is for INTERNAL
   * consumers that genuinely need the evidence package — the analysis Lab
   * enumerates runs here to build its package catalogue, and would otherwise
   * silently start offering zero analysis-run packages. Do not pass it from an
   * HTTP list route.
   *
   * Runs completed before the projection existed have no `summary`, so it is
   * derived on read rather than leaving the column empty.
   */
  async function listAnalysisRuns({ limit, offset, includeResults = false }) {
    const runs = readRuns();
    const sorted = [...runs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const page = sorted.slice(offset, offset + limit);
    return {
      data: includeResults ? page : page.map(toRunListItem),
      count: sorted.length,
    };
  }

  async function getAnalysisRun({ id }) {
    const runs = readRuns();
    return findRun(runs, id);
  }

  async function getAnalysisEvents({ analysisId }) {
    const eventsMap = readEventsMap();
    // appendAnalysisEvent serializes writes and appends in causal order. Keep
    // that order: millisecond timestamps can tie, and random UUID tie-breaks
    // would reorder distinct events.
    return [...(eventsMap[analysisId] || [])];
  }

  async function getAnalysisRunFull({ id }) {
    const [run, events] = await Promise.all([
      getAnalysisRun({ id }),
      getAnalysisEvents({ analysisId: id }),
    ]);
    return { run, events };
  }

  function getSettings() {
    return readSettings();
  }

  async function updateSettings(patch) {
    return enqueue(() => {
      const next = readSettings();
      if (patch && typeof patch === 'object' && patch.reasoningRerankMode !== undefined) {
        if (!REASONING_RERANK_MODES.includes(patch.reasoningRerankMode)) {
          const err = new Error('Invalid reasoningRerankMode. Expected "auto", "force" or "off".');
          err.statusCode = 400;
          throw err;
        }
        next.reasoningRerankMode = patch.reasoningRerankMode;
      }
      for (const key of ['reasoningPlanner', 'reasoningFollowUp']) {
        if (patch && typeof patch === 'object' && patch[key] !== undefined) {
          if (!REASONING_ON_OFF.includes(patch[key])) {
            const err = new Error(`Invalid ${key}. Expected "on" or "off".`);
            err.statusCode = 400;
            throw err;
          }
          next[key] = patch[key];
        }
      }
      writeSettings(next);
      return next;
    });
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
    updateAnalysisRunReport,
    completeAnalysisRun,
    failAnalysisRun,
    updateAnalysisRunUsage,
    listAnalysisRuns,
    getAnalysisRun,
    getAnalysisEvents,
    getAnalysisRunFull,
    getSettings,
    updateSettings,
    reset,
  };
}

module.exports = {
  createLocalStore,
  DEFAULT_DATA_DIR,
};
