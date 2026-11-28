const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { buildRunSummary, toRunListItem } = require('../court-analysis/utils/runSummary');
const { normalizeQueryValue } = require('../change-detection/snapshot');

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'analysis');
const RUN_STATUSES = ['queued', 'running', 'done', 'partial', 'error', 'interrupted', 'canceled'];
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  oib TEXT,
  query_type TEXT,
  query_value TEXT,
  scan_depth TEXT NOT NULL DEFAULT 'balanced',
  status TEXT NOT NULL CHECK(status IN ('queued','running','done','partial','error','interrupted','canceled')),
  partial_reason TEXT,
  preflight_json TEXT,
  result_format TEXT DEFAULT 'markdown',
  summary_json TEXT,
  scorecard_json TEXT,
  token_usage_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS run_artifacts (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  result_text TEXT,
  result_json TEXT
);
CREATE TABLE IF NOT EXISTS run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_run_events_run_seq ON run_events(run_id, seq);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ocr_transcripts (
  content_hash TEXT NOT NULL,
  engine TEXT NOT NULL,
  task_type TEXT NOT NULL,
  provider_slug TEXT,
  prompt_version INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  page_count INTEGER NOT NULL,
  text TEXT NOT NULL,
  page_map_json TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (content_hash, engine, prompt_version, model_id)
);
CREATE TABLE IF NOT EXISTS segment_checkpoints (
  checkpoint_key TEXT PRIMARY KEY,
  content_hash TEXT,
  segment_id TEXT,
  model_id TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  parsed_json TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd REAL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS llm_traces (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  task_type TEXT NOT NULL,
  doc_hash TEXT,
  segment_id TEXT,
  prompt_hash TEXT NOT NULL,
  user_prompt TEXT,
  request_params_json TEXT,
  requested_model TEXT NOT NULL,
  actual_model TEXT,
  actual_provider TEXT,
  finish_reason TEXT,
  raw_response TEXT,
  validation_errors_json TEXT,
  grounding_stats_json TEXT,
  ttft_ms INTEGER,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  cost_usd REAL,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_traces_run ON llm_traces(run_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_traces_doc ON llm_traces(doc_hash, task_type);
CREATE TABLE IF NOT EXISTS prompt_registry (
  prompt_hash TEXT PRIMARY KEY,
  prompt_name TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  system_prompt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bench_candidates (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  content_hash TEXT NOT NULL,
  doc_name TEXT,
  frozen_transcript TEXT NOT NULL,
  known_parties_json TEXT,
  prod_ai_result_json TEXT,
  trigger_reasons_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bench_candidates_status ON bench_candidates(status, created_at DESC);
CREATE TABLE IF NOT EXISTS run_facts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('amount','property','party','procedural_outcome')),
  description TEXT,
  value REAL,
  value_eur REAL,
  value_hrk REAL,
  currency TEXT,
  date TEXT,
  direction TEXT,
  amount_role TEXT,
  event_type TEXT,
  value_role TEXT,
  legal_effect TEXT,
  isplatni_red TEXT,
  supersedes TEXT,
  claim_registry_number TEXT,
  filing_reference TEXT,
  canonical_party_id TEXT,
  payer_oib TEXT,
  recipient_oib TEXT,
  grounded INTEGER NOT NULL DEFAULT 0,
  doc_hash TEXT,
  source_entry_index INTEGER,
  source_chunk_id TEXT,
  source_start_index INTEGER,
  source_end_index INTEGER,
  source_pages_json TEXT,
  raw_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_facts_run ON run_facts(run_id);
CREATE INDEX IF NOT EXISTS idx_run_facts_identity ON run_facts(run_id, claim_registry_number, filing_reference);
CREATE INDEX IF NOT EXISTS idx_run_facts_party ON run_facts(run_id, canonical_party_id);
CREATE INDEX IF NOT EXISTS idx_run_facts_doc ON run_facts(run_id, doc_hash);
CREATE TABLE IF NOT EXISTS run_chunks (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  doc_id TEXT NOT NULL,
  file_name TEXT,
  case_number TEXT,
  source_entry_index INTEGER,
  source_link_id TEXT,
  start_index INTEGER,
  end_index INTEGER,
  page_numbers_json TEXT,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_run_chunks_run ON run_chunks(run_id);
CREATE INDEX IF NOT EXISTS idx_run_chunks_id ON run_chunks(run_id, chunk_id);
CREATE VIRTUAL TABLE IF NOT EXISTS run_chunks_fts USING fts5(
  normalized_text,
  content='run_chunks',
  content_rowid='rowid',
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS run_chunks_ai AFTER INSERT ON run_chunks BEGIN
  INSERT INTO run_chunks_fts(rowid, normalized_text) VALUES (new.rowid, new.normalized_text);
END;
CREATE TRIGGER IF NOT EXISTS run_chunks_ad AFTER DELETE ON run_chunks BEGIN
  INSERT INTO run_chunks_fts(run_chunks_fts, rowid, normalized_text) VALUES ('delete', old.rowid, old.normalized_text);
END;
CREATE TRIGGER IF NOT EXISTS run_chunks_au AFTER UPDATE ON run_chunks BEGIN
  INSERT INTO run_chunks_fts(run_chunks_fts, rowid, normalized_text) VALUES ('delete', old.rowid, old.normalized_text);
  INSERT INTO run_chunks_fts(rowid, normalized_text) VALUES (new.rowid, new.normalized_text);
END;
CREATE TABLE IF NOT EXISTS registry_cache (
  oib_or_key TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_pricing_cache (
  model_id TEXT PRIMARY KEY,
  context_length INTEGER,
  max_completion_tokens INTEGER,
  input_usd_per_m REAL,
  output_usd_per_m REAL,
  capabilities_json TEXT,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_snapshots (
  query_id TEXT PRIMARY KEY,
  query_value TEXT,
  snapshot_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_snapshots_query_value ON change_snapshots(query_value);
CREATE TABLE IF NOT EXISTS change_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_id TEXT NOT NULL,
  query_value TEXT,
  snapshot_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_change_diffs_query ON change_diffs(query_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_change_diffs_query_value ON change_diffs(query_value, id DESC);
`;

function createId() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function stringify(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeScanDepth(value) {
  if (value === 'standard') return 'balanced';
  return value === 'full' ? 'full' : 'balanced';
}
function buildFtsMatchQuery(value, operator = 'AND') {
  const normalized = String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const terms = normalized.match(/[a-z0-9]+/g) || [];
  const joiner = operator === 'OR' ? ' OR ' : ' AND ';
  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(joiner);
}


function stripDuplicateAiResults(resultJson) {
  if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) return resultJson;
  if (!Array.isArray(resultJson.processedCases)) return resultJson;
  return {
    ...resultJson,
    processedCases: resultJson.processedCases.map((processedCase) => {
      const analyses = processedCase?.analysis?.individualAnalyses;
      if (!Array.isArray(analyses)) return processedCase;
      return {
        ...processedCase,
        analysis: {
          ...processedCase.analysis,
          individualAnalyses: analyses.map(({ aiResult, ...analysis }) => analysis),
        },
      };
    }),
  };
}

function hydrateRun(row) {
  if (!row) return null;
  return {
    ...row,
    error: row.error_message,
    result_json: parseJson(row.result_json),
    summary: parseJson(row.summary_json),
    scorecard: parseJson(row.scorecard_json),
    token_usage: parseJson(row.token_usage_json),
    preflight: parseJson(row.preflight_json),
  };
}

function createSqliteStore(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.ANALYSIS_DATA_DIR || DEFAULT_DATA_DIR);
  const isMemoryDb = options.dbPath === ':memory:';
  const dbPath = isMemoryDb ? ':memory:' : path.resolve(options.dbPath || path.join(dataDir, 'analysis.db'));
  if (!isMemoryDb) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath, options.databaseOptions);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -64000');
  db.exec(SCHEMA_SQL);

  const insertRun = db.prepare(`
    INSERT INTO runs (id, oib, query_type, query_value, scan_depth, status, result_format, created_at, updated_at)
    VALUES (@id, @oib, @query_type, @query_value, @scan_depth, @status, 'markdown', @created_at, @updated_at)
  `);
  const getRunRow = db.prepare(`
    SELECT runs.*, run_artifacts.result_text, run_artifacts.result_json
    FROM runs LEFT JOIN run_artifacts ON run_artifacts.run_id = runs.id WHERE runs.id = ?
  `);
  const requireRun = (id) => {
    const row = getRunRow.get(id);
    if (!row) throw new Error('Analysis run not found.');
    return hydrateRun(row);
  };

  const hasRunStmt = db.prepare('SELECT 1 FROM runs WHERE id = ?');
  const touchRunStmt = db.prepare('UPDATE runs SET updated_at = ? WHERE id = ?');
  const insertEvent = db.prepare(`
    INSERT INTO run_events (id, run_id, seq, event_type, message, metadata_json, created_at)
    VALUES (@id, @run_id, @seq, @event_type, @message, @metadata_json, @created_at)
  `);
  const nextEventSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM run_events WHERE run_id = ?');
  function appendEventsInTransaction(analysisId, events) {
    if (!hasRunStmt.get(analysisId)) throw new Error('Analysis run not found.');
    let seq = nextEventSeq.get(analysisId).seq;
    const created = [];
    for (const event of events) {
      const row = {
        id: event.id || createId(),
        run_id: analysisId,
        seq: seq++,
        event_type: event.eventType || event.event_type || 'progress',
        message: event.message || null,
        metadata_json: stringify(event.metadata || {}),
        created_at: event.created_at || nowIso(),
      };
      insertEvent.run(row);
      created.push({ ...row, analysis_id: analysisId, metadata: parseJson(row.metadata_json, {}) });
    }
    if (events.length) touchRunStmt.run(nowIso(), analysisId);
    return created;
  }

  const insertFact = db.prepare(`
    INSERT OR REPLACE INTO run_facts (
      id, run_id, kind, description, value, value_eur, value_hrk, currency, date, direction,
      amount_role, event_type, value_role, legal_effect, isplatni_red, supersedes,
      claim_registry_number, filing_reference, canonical_party_id, payer_oib, recipient_oib,
      grounded, doc_hash, source_entry_index, source_chunk_id, source_start_index,
      source_end_index, source_pages_json, raw_json
    ) VALUES (
      @id, @run_id, @kind, @description, @value, @value_eur, @value_hrk, @currency, @date, @direction,
      @amount_role, @event_type, @value_role, @legal_effect, @isplatni_red, @supersedes,
      @claim_registry_number, @filing_reference, @canonical_party_id, @payer_oib, @recipient_oib,
      @grounded, @doc_hash, @source_entry_index, @source_chunk_id, @source_start_index,
      @source_end_index, @source_pages_json, @raw_json
    )
  `);
  function insertFactsInTransaction(runId, facts) {
    if (facts.length && !hasRunStmt.get(runId)) throw new Error('Analysis run not found.');
    for (const fact of facts) {
      const raw = fact.raw_json ?? fact.rawJson ?? fact;
      insertFact.run({
        id: fact.id || createId(), run_id: runId, kind: fact.kind || 'amount',
        description: fact.description ?? null, value: fact.value ?? null,
        value_eur: fact.value_eur ?? fact.valueEur ?? null, value_hrk: fact.value_hrk ?? fact.valueHrk ?? null,
        currency: fact.currency ?? null, date: fact.date ?? null, direction: fact.direction ?? null,
        amount_role: fact.amount_role ?? fact.amountRole ?? null, event_type: fact.event_type ?? fact.eventType ?? null,
        value_role: fact.value_role ?? fact.valueRole ?? null, legal_effect: fact.legal_effect ?? fact.legalEffect ?? null,
        isplatni_red: fact.isplatni_red ?? fact.isplatniRed ?? null, supersedes: fact.supersedes ?? null,
        claim_registry_number: fact.claim_registry_number ?? fact.claimRegistryNumber ?? null,
        filing_reference: fact.filing_reference ?? fact.filingReference ?? null,
        canonical_party_id: fact.canonical_party_id ?? fact.canonicalPartyId ?? null,
        payer_oib: fact.payer_oib ?? fact.payerOib ?? null, recipient_oib: fact.recipient_oib ?? fact.recipientOib ?? null,
        grounded: fact.grounded ? 1 : 0, doc_hash: fact.doc_hash ?? fact.docHash ?? null,
        source_entry_index: fact.source_entry_index ?? fact.sourceEntryIndex ?? null,
        source_chunk_id: fact.source_chunk_id ?? fact.sourceChunkId ?? null,
        source_start_index: fact.source_start_index ?? fact.sourceStartIndex ?? null,
        source_end_index: fact.source_end_index ?? fact.sourceEndIndex ?? null,
        source_pages_json: stringify(fact.source_pages ?? fact.sourcePages), raw_json: stringify(raw),
      });
    }
  }

  const insertChunk = db.prepare(`
    INSERT INTO run_chunks (
      chunk_id, run_id, doc_id, file_name, case_number, source_entry_index, source_link_id,
      start_index, end_index, page_numbers_json, text, normalized_text
    ) VALUES (
      @chunk_id, @run_id, @doc_id, @file_name, @case_number, @source_entry_index, @source_link_id,
      @start_index, @end_index, @page_numbers_json, @text, @normalized_text
    )
  `);
  function insertChunksInTransaction(runId, chunks) {
    if (chunks.length && !hasRunStmt.get(runId)) throw new Error('Analysis run not found.');
    for (const chunk of chunks) {
      const text = String(chunk.text ?? '');
      insertChunk.run({
        chunk_id: chunk.chunk_id ?? chunk.chunkId ?? createId(), run_id: runId,
        doc_id: chunk.doc_id ?? chunk.docId ?? '', file_name: chunk.file_name ?? chunk.fileName ?? null,
        case_number: chunk.case_number ?? chunk.caseNumber ?? null,
        source_entry_index: chunk.source_entry_index ?? chunk.sourceEntryIndex ?? null,
        source_link_id: chunk.source_link_id ?? chunk.sourceLinkId ?? null,
        start_index: chunk.start_index ?? chunk.startIndex ?? null,
        end_index: chunk.end_index ?? chunk.endIndex ?? null,
        page_numbers_json: stringify(chunk.page_numbers ?? chunk.pageNumbers), text,
        normalized_text: String(chunk.normalized_text ?? chunk.normalizedText ?? text),
      });
    }
  }

  const insertFacts = db.transaction(insertFactsInTransaction);
  const insertChunks = db.transaction(insertChunksInTransaction);
  const appendEvents = db.transaction(appendEventsInTransaction);
  const appendEventsAndFacts = db.transaction(({ analysisId, events = [], facts = [] }) => {
    const createdEvents = appendEventsInTransaction(analysisId, events);
    insertFactsInTransaction(analysisId, facts);
    return { events: createdEvents, factsWritten: facts.length };
  });

  function importLegacyJson() {
    if (db.pragma('user_version', { simple: true }) >= 1) return;
    const legacySettingsPath = path.join(dataDir, 'settings.json');
    if (fs.existsSync(legacySettingsPath)) {
      const legacySettings = JSON.parse(fs.readFileSync(legacySettingsPath, 'utf8'));
      const normalized = {};
      if (['balanced', 'full', 'standard'].includes(legacySettings.defaultScanDepth)) {
        normalized.defaultScanDepth = normalizeScanDepth(legacySettings.defaultScanDepth);
      }
      if (legacySettings.uiPreferences && typeof legacySettings.uiPreferences === 'object' && !Array.isArray(legacySettings.uiPreferences)) {
        normalized.uiPreferences = legacySettings.uiPreferences;
      }
      for (const [key, value] of Object.entries(normalized)) {
        db.prepare('INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(key, stringify(value), nowIso());
      }
    }

    const legacyRunsPath = path.join(dataDir, 'runs.json');
    const legacyEventsPath = path.join(dataDir, 'events.json');
    const legacyRuns = fs.existsSync(legacyRunsPath) ? JSON.parse(fs.readFileSync(legacyRunsPath, 'utf8')) : [];
    const legacyEvents = fs.existsSync(legacyEventsPath) ? JSON.parse(fs.readFileSync(legacyEventsPath, 'utf8')) : {};
    if (!Array.isArray(legacyRuns) || !legacyEvents || typeof legacyEvents !== 'object' || Array.isArray(legacyEvents)) {
      throw new Error('Legacy analysis data has an invalid shape; refusing to mark migration complete.');
    }

    const migrate = db.transaction(() => {
      for (const legacy of legacyRuns) {
        const id = legacy.id;
        if (typeof id !== 'string' || !id) continue;
        const status = RUN_STATUSES.includes(legacy.status) ? legacy.status : 'error';
        insertRun.run({
          id, oib: legacy.oib ?? null, query_type: legacy.query_type ?? null,
          query_value: legacy.query_value ?? null, scan_depth: normalizeScanDepth(legacy.scan_depth),
          status, created_at: legacy.created_at || nowIso(), updated_at: legacy.updated_at || nowIso(),
        });
        const resultJson = stripDuplicateAiResults(legacy.result_json);
        const summary = legacy.summary || buildRunSummary({ run: legacy, resultJson });
        db.prepare(`UPDATE runs SET error_message = ?, completed_at = ?, result_format = ?, token_usage_json = ?, summary_json = ? WHERE id = ?`)
          .run(legacy.error ?? null, legacy.completed_at ?? null, legacy.result_format || 'markdown', stringify(legacy.token_usage), stringify(summary), id);
        if (resultJson !== null || legacy.result_text != null) {
          db.prepare('INSERT OR REPLACE INTO run_artifacts (run_id, result_text, result_json) VALUES (?, ?, ?)')
            .run(id, legacy.result_text ?? null, stringify(resultJson));
        }
        const events = Array.isArray(legacyEvents[id]) ? legacyEvents[id] : [];
        appendEventsInTransaction(id, events.map((event) => ({
          ...event,
          eventType: event.event_type || event.eventType || 'progress',
          metadata: event.metadata || {},
        })));
      }
      db.pragma('user_version = 1');
    });
    migrate();
  }

  function importLegacyChangeDetection() {
    if (db.pragma('user_version', { simple: true }) >= 2) return;
    const legacyDir = path.resolve(options.legacyChangeDetectionDir
      || process.env.CHANGE_DETECTION_DATA_DIR
      || (options.dataDir || options.dbPath
        ? path.join(dataDir, 'change-detection')
        : path.join(__dirname, '..', 'data', 'change-detection')));
    const latestByQuery = new Map();
    const snapshotDir = path.join(legacyDir, 'snapshots');
    if (fs.existsSync(snapshotDir)) {
      for (const name of fs.readdirSync(snapshotDir).filter((entry) => entry.endsWith('.json'))) {
        try {
          const snapshot = JSON.parse(fs.readFileSync(path.join(snapshotDir, name), 'utf8'));
          if (snapshot?.id && snapshot?.query && snapshot.snapshotId) latestByQuery.set(snapshot.id, snapshot);
        } catch {
          // Preserve valid history even if one legacy snapshot is corrupt.
        }
      }
    }

    const historyDir = path.join(legacyDir, 'history');
    const legacyDiffs = [];
    if (fs.existsSync(historyDir)) {
      for (const queryId of fs.readdirSync(historyDir)) {
        const diffPath = path.join(historyDir, queryId, 'diffs.jsonl');
        if (!fs.existsSync(diffPath)) continue;
        const snapshot = latestByQuery.get(queryId);
        const queryValue = snapshot?.query
          ? normalizeQueryValue(snapshot.query.type, snapshot.query.value)
          : null;
        for (const line of fs.readFileSync(diffPath, 'utf8').split(/\r?\n/)) {
          if (!line.trim()) continue;
          try {
            legacyDiffs.push({ queryId, queryValue, diff: JSON.parse(line) });
          } catch {
            // A torn legacy JSONL row must not hide later valid records.
          }
        }
      }
    }

    const migrate = db.transaction(() => {
      for (const [queryId, snapshot] of latestByQuery) {
        db.prepare(`INSERT OR REPLACE INTO change_snapshots (query_id, query_value, snapshot_id, payload_json, captured_at)
          VALUES (?, ?, ?, ?, ?)`)
          .run(queryId, normalizeQueryValue(snapshot.query.type, snapshot.query.value), snapshot.snapshotId,
            stringify(snapshot), snapshot.capturedAt || nowIso());
      }
      const insertDiff = db.prepare('INSERT INTO change_diffs (query_id, query_value, snapshot_id, diff_json, created_at) VALUES (?, ?, ?, ?, ?)');
      for (const { queryId, queryValue, diff } of legacyDiffs) {
        insertDiff.run(queryId, queryValue, diff.toSnapshotId || diff.snapshotId || '', stringify(diff), diff.computedAt || nowIso());
      }
      db.pragma('user_version = 2');
    });
    migrate();
  }

  importLegacyJson();
  importLegacyChangeDetection();

  const store = {
    dataDir,
    dbPath,
    db,
    markStaleRunsInterrupted() {
      const now = nowIso();
      return db.prepare(`UPDATE runs SET status = 'interrupted', error_message = ?, completed_at = ?, updated_at = ?
        WHERE status IN ('running', 'queued')`).run('Run interrupted by server restart.', now, now).changes;
    },
    markRunsInterrupted(runIds) {
      if (!Array.isArray(runIds) || runIds.length === 0) return 0;
      const now = nowIso();
      const mark = db.prepare(`UPDATE runs SET status = 'interrupted', error_message = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`);
      const markAll = db.transaction((ids) => {
        let changed = 0;
        for (const id of ids) changed += mark.run('Run interrupted by server shutdown.', now, now, id).changes;
        return changed;
      });
      return markAll(runIds);
    },
    async createAnalysisRun({ oib, queryType = null, queryValue = null, scanDepth = 'balanced', status = 'running' }) {
      const run = {
        id: createId(), oib: oib ?? null, query_type: queryType || null,
        query_value: queryValue || null, scan_depth: normalizeScanDepth(scanDepth), status,
        created_at: nowIso(), updated_at: nowIso(),
      };
      insertRun.run(run);
      return requireRun(run.id);
    },
    async appendAnalysisEvent(event) {
      return appendEvents(event.analysisId, [event])[0];
    },
    async appendAnalysisEvents({ analysisId, events }) {
      return appendEvents(analysisId, events || []);
    },
    appendAnalysisEventsAndFacts: appendEventsAndFacts,
    async updateAnalysisRunUsage({ analysisId, usage }) {
      const result = db.prepare('UPDATE runs SET token_usage_json = ?, updated_at = ? WHERE id = ?').run(stringify(usage), nowIso(), analysisId);
      if (!result.changes) throw new Error('Analysis run not found.');
      return requireRun(analysisId);
    },
    updateAnalysisRunPreflight({ analysisId, preflight }) {
      const result = db.prepare('UPDATE runs SET preflight_json = ?, updated_at = ? WHERE id = ?').run(stringify(preflight), nowIso(), analysisId);
      if (!result.changes) throw new Error('Analysis run not found.');
      return requireRun(analysisId);
    },
    async updateAnalysisRunReport({ analysisId, resultText, resultJson = null, scorecard = undefined }) {
      const run = requireRun(analysisId);
      const merged = resultJson == null ? run.result_json : { ...(run.result_json || {}), ...resultJson };
      const bounded = stripDuplicateAiResults(merged);
      const hasUpgradedLlmReport = Boolean(
        bounded?.report && bounded.report.generationMode !== 'deterministic_fallback',
      );
      const nextStatus = hasUpgradedLlmReport && run.status === 'partial' ? 'done' : run.status;
      const nextPartialReason = hasUpgradedLlmReport ? null : run.partial_reason;
      const nextSummary = buildRunSummary({
        run: { ...run, status: nextStatus, partial_reason: nextPartialReason },
        resultJson: bounded,
      });
      const nextScorecard = scorecard !== undefined ? stringify(scorecard) : run.scorecard_json;
      db.transaction(() => {
        db.prepare(`INSERT INTO run_artifacts (run_id, result_text, result_json) VALUES (?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET result_text = COALESCE(excluded.result_text, run_artifacts.result_text), result_json = excluded.result_json`)
          .run(analysisId, resultText ?? run.result_text ?? null, stringify(bounded));
        db.prepare(`UPDATE runs SET status = ?, partial_reason = ?, summary_json = ?, scorecard_json = ?, updated_at = ? WHERE id = ?`)
          .run(nextStatus, nextPartialReason, stringify(nextSummary), nextScorecard, nowIso(), analysisId);
      })();
      return requireRun(analysisId);
    },
    async completeAnalysisRun({ analysisId, resultText, resultJson = null, partialReason = null, preflight = null, scorecard = null, tokenUsage = undefined }) {
      const existing = requireRun(analysisId);
      const effectivePartialReason = partialReason ?? existing.partial_reason ?? null;
      const effectiveStatus = effectivePartialReason ? 'partial' : 'done';
      const boundedResult = stripDuplicateAiResults(resultJson);
      const summary = buildRunSummary({ run: { ...existing, status: effectiveStatus }, resultJson: boundedResult });
      db.transaction(() => {
        db.prepare(`INSERT INTO run_artifacts (run_id, result_text, result_json) VALUES (?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET result_text = excluded.result_text, result_json = excluded.result_json`)
          .run(analysisId, resultText ?? null, stringify(boundedResult));
        db.prepare(`UPDATE runs SET status = ?, partial_reason = COALESCE(?, partial_reason), preflight_json = COALESCE(?, preflight_json), summary_json = ?, scorecard_json = ?,
          token_usage_json = COALESCE(?, token_usage_json), completed_at = ?, updated_at = ? WHERE id = ?`)
          .run(effectiveStatus, partialReason, stringify(preflight), stringify(summary), stringify(scorecard), stringify(tokenUsage), nowIso(), nowIso(), analysisId);
      })();
      return requireRun(analysisId);
    },
    async failAnalysisRun({ analysisId, errorMessage, resultJson = null, resultText = null }) {
      const existing = requireRun(analysisId);
      const boundedResult = resultJson == null ? existing.result_json : stripDuplicateAiResults(resultJson);
      const summary = buildRunSummary({ run: { ...existing, status: 'error' }, resultJson: boundedResult });
      db.transaction(() => {
        if (resultJson !== null || resultText !== null) {
          db.prepare(`INSERT INTO run_artifacts (run_id, result_text, result_json) VALUES (?, ?, ?)
            ON CONFLICT(run_id) DO UPDATE SET result_text = COALESCE(excluded.result_text, run_artifacts.result_text), result_json = COALESCE(excluded.result_json, run_artifacts.result_json)`)
            .run(analysisId, resultText ?? existing.result_text ?? null, stringify(boundedResult));
        }
        db.prepare('UPDATE runs SET status = ?, error_message = ?, summary_json = ?, completed_at = ?, updated_at = ? WHERE id = ?')
          .run('error', errorMessage, stringify(summary), nowIso(), nowIso(), analysisId);
      })();
      return requireRun(analysisId);
    },
    async startAnalysisRun({ analysisId }) {
      db.prepare(`UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'`).run(nowIso(), analysisId);
      return requireRun(analysisId);
    },
    async cancelAnalysisRun({ analysisId }) {
      const now = nowIso();
      db.prepare(`UPDATE runs SET status = 'canceled', error_message = NULL, completed_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('queued', 'running')`).run(now, now, analysisId);
      return requireRun(analysisId);
    },
    async listAnalysisRuns({ limit, offset, includeResults = false }) {
      const count = db.prepare('SELECT COUNT(*) AS count FROM runs').get().count;
      const rows = db.prepare(`SELECT runs.*, ${includeResults ? 'run_artifacts.result_text, run_artifacts.result_json' : 'NULL AS result_text, NULL AS result_json'}
        FROM runs LEFT JOIN run_artifacts ON run_artifacts.run_id = runs.id ORDER BY runs.created_at DESC LIMIT ? OFFSET ?`).all(limit, offset);
      const data = rows.map(hydrateRun);
      return { data: includeResults ? data : data.map(toRunListItem), count };
    },
    async getAnalysisRun({ id }) {
      return requireRun(id);
    },
    async getAnalysisEvents({ analysisId }) {
      return db.prepare('SELECT id, run_id AS analysis_id, seq, event_type, message, metadata_json, created_at FROM run_events WHERE run_id = ? ORDER BY seq ASC')
        .all(analysisId).map((event) => ({ ...event, metadata: parseJson(event.metadata_json, {}) }));
    },
    async getAnalysisEventsAfterSeq({ analysisId, afterSeq = 0 }) {
      return db.prepare(`SELECT id, run_id AS analysis_id, seq, event_type, message, metadata_json, created_at
        FROM run_events WHERE run_id = ? AND seq > ? ORDER BY seq ASC`)
        .all(analysisId, Math.max(0, Math.floor(Number(afterSeq) || 0)))
        .map((event) => ({ ...event, metadata: parseJson(event.metadata_json, {}) }));
    },
    async getAnalysisRunFull({ id }) {
      const run = requireRun(id);
      const events = await store.getAnalysisEvents({ analysisId: id });
      return { run, events };
    },
    getSettings() {
      const settings = {};
      for (const row of db.prepare("SELECT key, value_json FROM settings WHERE key IN ('defaultScanDepth', 'uiPreferences')").all()) {
        settings[row.key] = parseJson(row.value_json);
      }
      if (settings.defaultScanDepth === 'standard') {
        settings.defaultScanDepth = 'balanced';
        db.prepare('UPDATE settings SET value_json = ?, updated_at = ? WHERE key = ?').run(stringify('balanced'), nowIso(), 'defaultScanDepth');
      }
      return settings;
    },
    async updateSettings(patch) {
      const next = store.getSettings();
      if (patch && typeof patch === 'object' && patch.defaultScanDepth !== undefined) {
        if (!['balanced', 'full'].includes(patch.defaultScanDepth)) {
          const error = new Error('Invalid defaultScanDepth. Expected "balanced" or "full".');
          error.statusCode = 400;
          throw error;
        }
        next.defaultScanDepth = patch.defaultScanDepth;
      }
      if (patch && typeof patch === 'object' && patch.uiPreferences !== undefined) {
        if (!patch.uiPreferences || typeof patch.uiPreferences !== 'object' || Array.isArray(patch.uiPreferences)) {
          const error = new Error('Invalid uiPreferences. Expected an object.');
          error.statusCode = 400;
          throw error;
        }
        next.uiPreferences = patch.uiPreferences;
      }
      const writeSettings = db.transaction(() => {
        for (const key of ['defaultScanDepth', 'uiPreferences']) {
          if (Object.hasOwn(next, key)) {
            db.prepare(`INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
              .run(key, stringify(next[key]), nowIso());
          }
        }
      });
      writeSettings();
      return next;
    },
    insertRunFacts({ runId, facts }) {
      return insertFacts(runId, facts || []);
    },
    insertRunChunks({ runId, chunks }) {
      return insertChunks(runId, chunks || []);
    },
    listRunFacts({ runId, kind, partyId, grounded, q, limit = 20, offset = 0 }) {
      requireRun(runId);
      const clauses = ['run_id = ?'];
      const params = [runId];
      if (kind) {
        clauses.push('kind = ?');
        params.push(kind);
      }
      if (partyId) {
        clauses.push('canonical_party_id = ?');
        params.push(partyId);
      }
      if (grounded !== undefined && grounded !== null) {
        clauses.push('grounded = ?');
        params.push(grounded ? 1 : 0);
      }
      if (q) {
        clauses.push("(COALESCE(description, '') LIKE ? OR raw_json LIKE ?)");
        params.push(`%${q}%`, `%${q}%`);
      }
      const where = clauses.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS total FROM run_facts WHERE ${where}`).get(...params).total;
      const rows = db.prepare(`SELECT * FROM run_facts WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(...params, limit, offset)
        .map((row) => {
          const raw = parseJson(row.raw_json, {});
          return {
            id: row.id,
            kind: row.kind,
            description: row.description,
            value: row.value,
            valueEur: row.value_eur,
            valueHrk: row.value_hrk,
            currency: row.currency,
            date: row.date,
            direction: row.direction,
            amountRole: row.amount_role,
            eventType: row.event_type,
            valueRole: row.value_role,
            legalEffect: row.legal_effect,
            isplatniRed: row.isplatni_red,
            supersedes: row.supersedes,
            claimRegistryNumber: row.claim_registry_number,
            filingReference: row.filing_reference,
            canonicalPartyId: row.canonical_party_id,
            payerOib: row.payer_oib,
            recipientOib: row.recipient_oib,
            grounded: Boolean(row.grounded),
            docId: raw?.docId || raw?.doc?.docId || raw?.doc?.analysisId || row.doc_hash || null,
            docHash: row.doc_hash,
            sourceEntryIndex: row.source_entry_index,
            sourceChunkId: row.source_chunk_id,
            sourceStartIndex: row.source_start_index,
            sourceEndIndex: row.source_end_index,
            sourcePages: parseJson(row.source_pages_json, []),
            raw,
          };
        });
      return { facts: rows, total };
    },
    getRunChunk({ runId, chunkId }) {
      requireRun(runId);
      const row = db.prepare(`SELECT chunk_id, doc_id, file_name, case_number, source_entry_index,
        page_numbers_json, start_index, end_index, text FROM run_chunks WHERE run_id = ? AND chunk_id = ? ORDER BY rowid LIMIT 1`)
        .get(runId, chunkId);
      if (!row) return null;
      return {
        chunkId: row.chunk_id,
        docId: row.doc_id,
        fileName: row.file_name,
        caseNumber: row.case_number,
        sourceEntryIndex: row.source_entry_index,
        pageNumbers: parseJson(row.page_numbers_json, []),
        startIndex: row.start_index,
        endIndex: row.end_index,
        text: row.text,
      };
    },
    searchRunChunks({ runId, query, operator = 'AND', limit = 20, offset = 0 }) {
      requireRun(runId);
      const match = buildFtsMatchQuery(query, operator);
      if (!match) return { chunks: [], total: 0 };
      const where = 'run_chunks_fts MATCH ? AND c.run_id = ?';
      const total = db.prepare(`SELECT COUNT(*) AS total FROM run_chunks_fts
        JOIN run_chunks c ON c.rowid = run_chunks_fts.rowid WHERE ${where}`).get(match, runId).total;
      const rows = db.prepare(`SELECT c.chunk_id, c.doc_id, c.file_name, c.case_number, c.source_entry_index,
        c.page_numbers_json, c.start_index, c.end_index, c.text, c.normalized_text,
        snippet(run_chunks_fts, 0, '<mark>', '</mark>', '…', 18) AS snippet,
        bm25(run_chunks_fts) AS rank
        FROM run_chunks_fts JOIN run_chunks c ON c.rowid = run_chunks_fts.rowid
        WHERE ${where} ORDER BY rank ASC, c.rowid ASC LIMIT ? OFFSET ?`)
        .all(match, runId, limit, offset)
        .map((row) => ({
          chunkId: row.chunk_id,
          docId: row.doc_id,
          fileName: row.file_name,
          caseNumber: row.case_number,
          sourceEntryIndex: row.source_entry_index,
          pageNumbers: parseJson(row.page_numbers_json, []),
          startIndex: row.start_index,
          endIndex: row.end_index,
          text: row.text,
          normalizedText: row.normalized_text,
          snippet: row.snippet,
          rank: row.rank,
        }));
      return { chunks: rows, total };
    },
    listRunTraces({ runId, limit = 20, offset = 0 }) {
      requireRun(runId);
      const total = db.prepare('SELECT COUNT(*) AS total FROM llm_traces WHERE run_id = ?').get(runId).total;
      const traces = db.prepare(`SELECT id, task_type, doc_hash, segment_id, prompt_hash, requested_model,
        actual_model, actual_provider, finish_reason, validation_errors_json, grounding_stats_json, ttft_ms,
        latency_ms, input_tokens, output_tokens, cached_tokens, reasoning_tokens, cost_usd, error_message, created_at
        FROM llm_traces WHERE run_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?`)
        .all(runId, limit, offset)
        .map((row) => ({
          id: row.id,
          taskType: row.task_type,
          docHash: row.doc_hash,
          segmentId: row.segment_id,
          promptHash: row.prompt_hash,
          requestedModel: row.requested_model,
          actualModel: row.actual_model,
          actualProvider: row.actual_provider,
          finishReason: row.finish_reason,
          validationErrors: parseJson(row.validation_errors_json, []),
          groundingStats: parseJson(row.grounding_stats_json, null),
          ttftMs: row.ttft_ms,
          latencyMs: row.latency_ms,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cachedTokens: row.cached_tokens,
          reasoningTokens: row.reasoning_tokens,
          costUsd: row.cost_usd,
          errorMessage: row.error_message,
          createdAt: row.created_at,
        }));
      return { traces, total };
    },
    getRunTrace({ runId, traceId }) {
      requireRun(runId);
      const row = db.prepare('SELECT * FROM llm_traces WHERE run_id = ? AND id = ?').get(runId, traceId);
      if (!row) return null;
      return {
        id: row.id,
        runId: row.run_id,
        taskType: row.task_type,
        docHash: row.doc_hash,
        segmentId: row.segment_id,
        promptHash: row.prompt_hash,
        userPrompt: row.user_prompt,
        requestParams: parseJson(row.request_params_json, null),
        requestedModel: row.requested_model,
        actualModel: row.actual_model,
        actualProvider: row.actual_provider,
        finishReason: row.finish_reason,
        rawResponse: row.raw_response,
        validationErrors: parseJson(row.validation_errors_json, []),
        groundingStats: parseJson(row.grounding_stats_json, null),
        ttftMs: row.ttft_ms,
        latencyMs: row.latency_ms,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        cachedTokens: row.cached_tokens,
        reasoningTokens: row.reasoning_tokens,
        costUsd: row.cost_usd,
        errorMessage: row.error_message,
        createdAt: row.created_at,
      };
    },
    getOcrPage(contentHash, pageNumber, options = {}) {
      const key = `${contentHash}:p${pageNumber}`;
      const engine = options.engine || 'page-cache';
      const promptVersion = options.promptVersion || 1;
      const row = options.modelId
        ? db.prepare(`SELECT text FROM ocr_transcripts WHERE content_hash = ? AND engine = ? AND task_type = ? AND prompt_version = ? AND model_id = ?`)
            .get(key, engine, 'TranscribePage', promptVersion, options.modelId)
        : db.prepare(`SELECT text FROM ocr_transcripts WHERE content_hash = ? AND engine = ? AND task_type = ? AND prompt_version = ? ORDER BY created_at DESC LIMIT 1`)
            .get(key, engine, 'TranscribePage', promptVersion);
      return row ? row.text : null;
    },
    putOcrPage(contentHash, pageNumber, text, options = {}) {
      if (typeof text !== 'string') return;
      db.prepare(`INSERT INTO ocr_transcripts (content_hash, engine, task_type, prompt_version, model_id, page_count, text, created_at)
        VALUES (?, ?, 'TranscribePage', ?, ?, 1, ?, ?)
        ON CONFLICT(content_hash, engine, prompt_version, model_id) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`)
        .run(`${contentHash}:p${pageNumber}`, options.engine || 'page-cache', options.promptVersion || 1, options.modelId || 'page-cache', text, nowIso());
    },
    getOcrTranscript({ contentHash, engine, promptVersion = 2, modelId }) {
      if (!contentHash) return null;
      const row = engine && modelId
        ? db.prepare(`SELECT * FROM ocr_transcripts WHERE content_hash = ? AND engine = ? AND prompt_version = ? AND model_id = ?`)
            .get(contentHash, engine, promptVersion, modelId)
        : db.prepare(`SELECT * FROM ocr_transcripts WHERE content_hash = ? AND instr(content_hash, ':p') = 0 ORDER BY created_at DESC LIMIT 1`)
            .get(contentHash);
      if (!row) return null;
      return {
        contentHash: row.content_hash,
        engine: row.engine,
        taskType: row.task_type,
        providerSlug: row.provider_slug,
        promptVersion: row.prompt_version,
        modelId: row.model_id,
        pageCount: row.page_count,
        text: row.text,
        pageMap: parseJson(row.page_map_json, null),
        truncated: Boolean(row.truncated),
        costUsd: row.cost_usd,
        createdAt: row.created_at,
      };
    },
    hasOcrTranscript(contentHash) {
      if (!contentHash) return false;
      const row = db.prepare(`SELECT 1 FROM ocr_transcripts WHERE content_hash = ? OR content_hash LIKE ? LIMIT 1`)
        .get(contentHash, `${contentHash}:p%`);
      return Boolean(row);
    },
    putOcrTranscript({
      contentHash,
      engine,
      taskType = 'TranscribePage',
      providerSlug = null,
      promptVersion = 2,
      modelId,
      pageCount = 1,
      text,
      pageMap = null,
      truncated = false,
      costUsd = null,
    }) {
      if (!contentHash || typeof text !== 'string') return;
      db.prepare(`INSERT INTO ocr_transcripts (
        content_hash, engine, task_type, provider_slug, prompt_version, model_id,
        page_count, text, page_map_json, truncated, cost_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(content_hash, engine, prompt_version, model_id) DO UPDATE SET
        provider_slug = excluded.provider_slug,
        page_count = excluded.page_count,
        text = excluded.text,
        page_map_json = excluded.page_map_json,
        truncated = excluded.truncated,
        cost_usd = excluded.cost_usd,
        created_at = excluded.created_at`)
        .run(
          contentHash,
          engine,
          taskType,
          providerSlug,
          promptVersion,
          modelId,
          pageCount,
          text,
          stringify(pageMap),
          truncated ? 1 : 0,
          costUsd,
          nowIso(),
        );
    },
    hasSegmentCheckpointForContentHash(contentHash) {
      if (!contentHash) return false;
      return Boolean(db.prepare('SELECT 1 FROM segment_checkpoints WHERE content_hash = ? LIMIT 1').get(contentHash));
    },
    getSegmentCheckpoint(checkpointKey) {
      if (!checkpointKey) return null;
      const row = db.prepare('SELECT * FROM segment_checkpoints WHERE checkpoint_key = ?').get(checkpointKey);
      if (!row) return null;
      return {
        checkpointKey: row.checkpoint_key,
        contentHash: row.content_hash,
        segmentId: row.segment_id,
        modelId: row.model_id,
        promptHash: row.prompt_hash,
        schemaVersion: row.schema_version,
        parsed: parseJson(row.parsed_json, null),
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        reasoningTokens: row.reasoning_tokens,
        costUsd: row.cost_usd,
        latencyMs: row.latency_ms,
        createdAt: row.created_at,
      };
    },
    putSegmentCheckpoint({
      checkpointKey,
      contentHash,
      segmentId,
      modelId,
      promptHash,
      schemaVersion,
      parsed,
      inputTokens = null,
      outputTokens = null,
      reasoningTokens = null,
      costUsd = null,
      latencyMs = null,
    }) {
      if (!checkpointKey || !contentHash || !segmentId || !parsed) return false;
      db.prepare(`INSERT INTO segment_checkpoints (
        checkpoint_key, content_hash, segment_id, model_id, prompt_hash, schema_version,
        parsed_json, input_tokens, output_tokens, reasoning_tokens, cost_usd, latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(checkpoint_key) DO UPDATE SET
        parsed_json = excluded.parsed_json,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        reasoning_tokens = excluded.reasoning_tokens,
        cost_usd = excluded.cost_usd,
        latency_ms = excluded.latency_ms,
        created_at = excluded.created_at`)
        .run(
          checkpointKey,
          contentHash,
          segmentId,
          String(modelId || 'z-ai/glm-5.3-flash'),
          String(promptHash || 'v5'),
          Number(schemaVersion || 5),
          stringify(parsed),
          inputTokens,
          outputTokens,
          reasoningTokens,
          costUsd,
          latencyMs,
          nowIso(),
        );
      return true;
    },
    insertBenchCandidate({
      id = crypto.randomUUID(),
      runId = null,
      contentHash = null,
      docName,
      frozenTranscript,
      knownParties = null,
      prodAiResult = null,
      triggerReasons = [],
      status = 'pending',
    } = {}) {
      if (!docName || typeof frozenTranscript !== 'string') return null;
      db.prepare(`INSERT INTO bench_candidates (
        id, run_id, content_hash, doc_name, frozen_transcript, known_parties_json,
        prod_ai_result_json, trigger_reasons_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          runId,
          contentHash,
          docName,
          frozenTranscript,
          stringify(knownParties),
          stringify(prodAiResult),
          stringify(triggerReasons),
          status,
          nowIso(),
        );
      return id;
    },
    listBenchCandidates({ runId = null, limit = 50 } = {}) {
      const rows = runId
        ? db.prepare('SELECT * FROM bench_candidates WHERE run_id = ? ORDER BY created_at DESC LIMIT ?').all(runId, limit)
        : db.prepare('SELECT * FROM bench_candidates ORDER BY created_at DESC LIMIT ?').all(limit);
      return rows.map((row) => ({
        id: row.id,
        runId: row.run_id,
        contentHash: row.content_hash,
        docName: row.doc_name,
        frozenTranscript: row.frozen_transcript,
        knownParties: parseJson(row.known_parties_json, null),
        prodAiResult: parseJson(row.prod_ai_result_json, null),
        triggerReasons: parseJson(row.trigger_reasons_json, []),
        status: row.status,
        createdAt: row.created_at,
      }));
    },
    setRunPartialReason({ id, partialReason }) {
      if (!id) return false;
      const result = db.prepare('UPDATE runs SET partial_reason = ? WHERE id = ?').run(partialReason || null, id);
      return result.changes > 0;
    },
    upsertPromptRegistry({ promptHash, promptName, schemaVersion, systemPrompt }) {
      if (!promptHash || !promptName) return false;
      db.prepare(`INSERT INTO prompt_registry (prompt_hash, prompt_name, schema_version, system_prompt, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(prompt_hash) DO UPDATE SET
          prompt_name = excluded.prompt_name,
          schema_version = excluded.schema_version,
          system_prompt = excluded.system_prompt`)
        .run(promptHash, promptName, Number(schemaVersion || 1), String(systemPrompt || ''), nowIso());
      return true;
    },
    insertLlmTrace({
      id = crypto.randomUUID(),
      runId = null,
      taskType = null,
      docHash = null,
      segmentId = null,
      promptHash = null,
      userPrompt = null,
      requestParams = null,
      requestedModel = null,
      actualModel = null,
      actualProvider = null,
      finishReason = null,
      rawResponse = null,
      validationErrors = null,
      groundingStats = null,
      ttftMs = null,
      latencyMs = null,
      inputTokens = null,
      outputTokens = null,
      cachedTokens = null,
      reasoningTokens = null,
      costUsd = null,
      errorMessage = null,
    } = {}) {
      db.prepare(`INSERT INTO llm_traces (
        id, run_id, task_type, doc_hash, segment_id, prompt_hash, user_prompt,
        request_params_json, requested_model, actual_model, actual_provider,
        finish_reason, raw_response, validation_errors_json, grounding_stats_json,
        ttft_ms, latency_ms, input_tokens, output_tokens, cached_tokens,
        reasoning_tokens, cost_usd, error_message, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          runId,
          taskType,
          docHash,
          segmentId,
          promptHash,
          userPrompt,
          stringify(requestParams),
          requestedModel,
          actualModel,
          actualProvider,
          finishReason,
          rawResponse,
          stringify(validationErrors),
          stringify(groundingStats),
          Number.isFinite(ttftMs) ? Math.round(ttftMs) : null,
          Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
          Number.isFinite(inputTokens) ? Math.round(inputTokens) : null,
          Number.isFinite(outputTokens) ? Math.round(outputTokens) : null,
          Number.isFinite(cachedTokens) ? Math.round(cachedTokens) : null,
          Number.isFinite(reasoningTokens) ? Math.round(reasoningTokens) : null,
          Number.isFinite(Number(costUsd)) ? Number(costUsd) : null,
          errorMessage,
          nowIso(),
        );
      return id;
    },
    pruneOldLlmTraces({ retentionDays = 30 } = {}) {
      const days = Math.max(1, Number(retentionDays) || 30);
      const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
      const result = db.prepare('DELETE FROM llm_traces WHERE created_at < ?').run(cutoff);
      return result.changes || 0;
    },
    getLatestSnapshot(queryId) {
      const row = db.prepare('SELECT payload_json FROM change_snapshots WHERE query_id = ?').get(queryId);
      return row ? parseJson(row.payload_json) : null;
    },
    recordCheck(snapshot, diff) {
      try {
        const write = db.transaction(() => {
          db.prepare(`INSERT INTO change_snapshots (query_id, query_value, snapshot_id, payload_json, captured_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(query_id) DO UPDATE SET query_value = excluded.query_value, snapshot_id = excluded.snapshot_id,
              payload_json = excluded.payload_json, captured_at = excluded.captured_at`)
            .run(snapshot.id, normalizeQueryValue(snapshot.query.type, snapshot.query.value), snapshot.snapshotId, stringify(snapshot), snapshot.capturedAt);
          db.prepare('INSERT INTO change_diffs (query_id, query_value, snapshot_id, diff_json, created_at) VALUES (?, ?, ?, ?, ?)')
            .run(snapshot.id, normalizeQueryValue(snapshot.query.type, snapshot.query.value), snapshot.snapshotId, stringify(diff), nowIso());
        });
        write();
        return { save: { ok: true, archived: true }, append: { ok: true }, ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    getHistory(queryId) {
      const snapshots = db.prepare('SELECT DISTINCT snapshot_id FROM change_diffs WHERE query_id = ? ORDER BY id')
        .all(queryId).map((row) => ({ snapshotId: row.snapshot_id }));
      const diffs = db.prepare('SELECT diff_json FROM change_diffs WHERE query_id = ? ORDER BY id')
        .all(queryId).map((row) => parseJson(row.diff_json)).filter(Boolean);
      return { queryId, snapshots, diffs };
    },
    getHistoryByQueryValue(queryValue) {
      const rows = db.prepare('SELECT DISTINCT query_id FROM change_diffs WHERE query_value = ? ORDER BY id DESC').all(queryValue);
      const histories = rows.map(({ query_id }) => store.getHistory(query_id));
      if (histories.length === 1) return histories[0];
      return { queryValue, histories };
    },
    getRegistryCache(key) {
      const row = db.prepare('SELECT payload_json, expires_at FROM registry_cache WHERE oib_or_key = ?').get(key);
      if (!row) return null;
      if (Date.parse(row.expires_at) <= Date.now()) {
        db.prepare('DELETE FROM registry_cache WHERE oib_or_key = ?').run(key);
        return null;
      }
      return parseJson(row.payload_json);
    },
    putRegistryCache(key, payload, ttlMs = 24 * 60 * 60 * 1000) {
      const fetchedAt = nowIso();
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();
      db.prepare(`INSERT INTO registry_cache (oib_or_key, payload_json, fetched_at, expires_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(oib_or_key) DO UPDATE SET payload_json = excluded.payload_json, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`)
        .run(key, stringify(payload), fetchedAt, expiresAt);
    },
    close() {
      if (db.open) db.close();
    },
  };

  return store;
}

module.exports = {
  createSqliteStore,
  DEFAULT_DATA_DIR,
  SCHEMA_SQL,
};
