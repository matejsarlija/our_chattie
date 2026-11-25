const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const express = require('express');
const request = require('supertest');
const { createSqliteStore } = require('../services/sqliteStore');
const { createRunBus } = require('../http/runBus');
const { createAnalysisRunsRouter } = require('../routes/analysisRuns');

const pass = (req, res, next) => next();

describe('analysis run thin read APIs', () => {
  let dataDir;
  let analysisStore;
  let run;
  let app;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-read-api-'));
    analysisStore = createSqliteStore({ dataDir });
    run = await analysisStore.createAnalysisRun({ queryType: 'case_number', queryValue: 'St-2/2013' });
    const runBus = createRunBus({ analysisStore });
    app = express();
    app.use('/api/analysis', createAnalysisRunsRouter({
      analysisStore,
      readLimiter: pass,
      writeLimiter: pass,
      runAbortRegistry: { get: () => null },
      runBus,
    }));
  });

  afterEach(() => {
    analysisStore?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('filters facts and returns bounded pagination metadata', async () => {
    analysisStore.insertRunFacts({ runId: run.id, facts: [
      {
        id: 'fact-1', kind: 'amount', description: 'Prijavljena tražbina', canonicalPartyId: 'party-1',
        grounded: true, valueEur: 120, valueHrk: 904.14, valueRole: 'claim_balance', supersedes: 'fact-0',
        sourceStartIndex: 10, sourceEndIndex: 45, doc: { analysisId: 'doc-1', contentHash: 'hash-1' },
        docHash: 'hash-1',
      },
      { id: 'fact-2', kind: 'amount', description: 'Trošak postupka', canonicalPartyId: 'party-1', grounded: false, valueEur: 20 },
      { id: 'fact-3', kind: 'property', description: 'Prodana nekretnina', canonicalPartyId: 'party-2', grounded: true },
    ] });

    const response = await request(app).get(`/api/analysis/runs/${run.id}/facts?kind=amount&partyId=party-1&grounded=true&q=tražbina&limit=1&offset=0`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ total: 1, limit: 1, offset: 0 });
    expect(response.body.facts).toHaveLength(1);
    expect(response.body.facts[0]).toMatchObject({
      id: 'fact-1',
      grounded: true,
      canonicalPartyId: 'party-1',
      docId: 'doc-1',
      docHash: 'hash-1',
      valueHrk: 904.14,
      valueRole: 'claim_balance',
      supersedes: 'fact-0',
      sourceStartIndex: 10,
      sourceEndIndex: 45,
    });
  });

  test('returns full chunk details and run-scoped BM25 snippets with exact identifiers', async () => {
    analysisStore.insertRunChunks({ runId: run.id, chunks: [
      {
        chunkId: 'chunk-oib', docId: 'doc-1', fileName: 'Podnesak.pdf', caseNumber: 'St-2/2013',
        sourceEntryIndex: 4, pageNumbers: [1, 2], startIndex: 0, endIndex: 110,
        text: 'OIB 66124057408; redni broj 98; tražbina vjerovnika.',
        normalizedText: 'oib 66124057408 redni broj 98 trazbina vjerovnika',
      },
      {
        chunkId: 'chunk-other', docId: 'doc-2', fileName: 'Rješenje.pdf', caseNumber: 'St-2/2013',
        sourceEntryIndex: 5, pageNumbers: [3], startIndex: 0, endIndex: 60,
        text: 'Zaključak o raspravi.', normalizedText: 'zakljucak o raspravi',
      },
    ] });

    const detail = await request(app).get(`/api/analysis/runs/${run.id}/chunks/chunk-oib`);
    expect(detail.status).toBe(200);
    expect(detail.body).toEqual({
      chunkId: 'chunk-oib', docId: 'doc-1', fileName: 'Podnesak.pdf', caseNumber: 'St-2/2013',
      sourceEntryIndex: 4, pageNumbers: [1, 2], startIndex: 0, endIndex: 110,
      text: 'OIB 66124057408; redni broj 98; tražbina vjerovnika.',
    });

    const startedAt = performance.now();
    const bm25 = analysisStore.searchRunChunks({ runId: run.id, query: 'redni broj 98' });
    const elapsedMs = performance.now() - startedAt;
    expect(bm25.total).toBe(1);
    expect(bm25.chunks[0].chunkId).toBe('chunk-oib');
    const search = await request(app).get(`/api/analysis/runs/${run.id}/chunks?q=${encodeURIComponent('redni broj 98')}`);
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(1);
    expect(search.body.chunks[0]).toMatchObject({
      chunkId: 'chunk-oib', docId: 'doc-1', fileName: 'Podnesak.pdf', pageNumbers: [1, 2],
    });
    expect(search.body.chunks[0].snippet).toContain('<mark>98</mark>');
    expect(typeof search.body.chunks[0].rank).toBe('number');
    expect(elapsedMs).toBeLessThan(25);

    const oibSearch = await request(app).get(`/api/analysis/runs/${run.id}/chunks?q=66124057408`);
    expect(oibSearch.body.chunks.map((chunk) => chunk.chunkId)).toEqual(['chunk-oib']);
  });

  test('lists trace summaries without raw responses and exposes raw data only on detail', async () => {
    analysisStore.db.prepare(`INSERT INTO llm_traces (
      id, run_id, task_type, prompt_hash, user_prompt, request_params_json, requested_model,
      actual_model, actual_provider, raw_response, validation_errors_json, grounding_stats_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'trace-1', run.id, 'extract', 'prompt-hash', 'private prompt', '{"temperature":0}',
      'model-requested', 'model-actual', 'openrouter', '{"decision":"evidence"}',
      '[]', '{"grounded":2}', '2026-01-01T00:00:00.000Z',
    );

    const list = await request(app).get(`/api/analysis/runs/${run.id}/traces?limit=1`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.traces[0]).toMatchObject({ id: 'trace-1', taskType: 'extract', requestedModel: 'model-requested' });
    expect(list.body.traces[0]).not.toHaveProperty('rawResponse');

    const detail = await request(app).get(`/api/analysis/runs/${run.id}/traces/trace-1`);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      id: 'trace-1', userPrompt: 'private prompt', requestParams: { temperature: 0 },
      rawResponse: '{"decision":"evidence"}', groundingStats: { grounded: 2 },
    });
  });
});
