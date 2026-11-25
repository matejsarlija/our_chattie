const express = require('express');
const { parsePagination } = require('../http/pagination');
const { createAnalysisRunStreamHandler } = require('../http/analysisStreamHandler');
const { createAnalysisReportRetryHandler } = require('../http/analysisReportRetry');
const { generateClusterReport, composeOverviewMarkdown } = require('../court-analysis/reasoning/synthesis/reportService');
const logger = require('../services/logger');

const FACT_KINDS = new Set(['amount', 'property', 'party', 'procedural_outcome']);

function parseGroundedFilter(value) {
  if (value === undefined) return { valid: true, value: undefined };
  if (value === 'true' || value === '1') return { valid: true, value: true };
  if (value === 'false' || value === '0') return { valid: true, value: false };
  return { valid: false, value: undefined };
}


function createAnalysisRunsRouter({ analysisStore, readLimiter, writeLimiter, runAbortRegistry, runBus }) {
  const router = express.Router();

  router.get('/runs', readLimiter, async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const result = await analysisStore.listAnalysisRuns({ limit, offset });
      res.json({ runs: result.data, count: result.count, limit, offset });
    } catch (error) {
      logger.agent.error('[Analysis Runs] list failed:', error.message);
      res.status(500).json({ error: 'Failed to load analysis runs.' });
    }
  });

  router.get('/runs/:id', readLimiter, async (req, res) => {
    try {
      const run = await analysisStore.getAnalysisRun({ id: req.params.id });
      res.json({ run });
    } catch (error) {
      logger.agent.error('[Analysis Runs] get failed:', error.message);
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.get('/runs/:id/full', readLimiter, async (req, res) => {
    try {
      const result = await analysisStore.getAnalysisRunFull({ id: req.params.id });
      res.json({
        run: result.run,
        events: result.events,
        server_time: new Date().toISOString(),
      });
    } catch (error) {
      logger.agent.error('[Analysis Runs] get full failed:', error.message);
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.get('/runs/:id/events', readLimiter, async (req, res) => {
    try {
      const events = await analysisStore.getAnalysisEvents({ analysisId: req.params.id });
      res.json({ events });
    } catch (error) {
      logger.agent.error('[Analysis Events] get failed:', error.message);
      res.status(404).json({ error: 'Analysis events not found.' });
    }
  });
  router.get('/runs/:id/facts', readLimiter, async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    if (req.query.kind && !FACT_KINDS.has(req.query.kind)) {
      return res.status(400).json({ error: 'Invalid fact kind.' });
    }
    const grounded = parseGroundedFilter(req.query.grounded);
    if (!grounded.valid) return res.status(400).json({ error: 'Invalid grounded filter.' });
    try {
      const result = await analysisStore.listRunFacts({
        runId: req.params.id,
        kind: req.query.kind,
        partyId: req.query.partyId,
        grounded: grounded.value,
        q: req.query.q,
        limit,
        offset,
      });
      return res.json({ facts: result.facts, total: result.total, limit, offset });
    } catch (error) {
      logger.agent.error('[Analysis Facts] list failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.get('/runs/:id/chunks', readLimiter, async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    try {
      const result = await analysisStore.searchRunChunks({
        runId: req.params.id,
        query: req.query.q,
        limit,
        offset,
      });
      const chunks = result.chunks.map(({ text, normalizedText, ...chunk }) => chunk);
      return res.json({ chunks, total: result.total, limit, offset });
    } catch (error) {
      logger.agent.error('[Analysis Chunks] search failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.get('/runs/:id/chunks/:chunkId', readLimiter, async (req, res) => {
    try {
      const chunk = await analysisStore.getRunChunk({ runId: req.params.id, chunkId: req.params.chunkId });
      return chunk ? res.json(chunk) : res.status(404).json({ error: 'Analysis chunk not found.' });
    } catch (error) {
      logger.agent.error('[Analysis Chunks] get failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.get('/runs/:id/traces', readLimiter, async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    try {
      const result = await analysisStore.listRunTraces({ runId: req.params.id, limit, offset });
      return res.json({ traces: result.traces, total: result.total, limit, offset });
    } catch (error) {
      logger.agent.error('[Analysis Traces] list failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.get('/runs/:id/traces/:traceId', readLimiter, async (req, res) => {
    try {
      const trace = await analysisStore.getRunTrace({ runId: req.params.id, traceId: req.params.traceId });
      return trace ? res.json(trace) : res.status(404).json({ error: 'Analysis trace not found.' });
    } catch (error) {
      logger.agent.error('[Analysis Traces] get failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  router.post('/runs/:id/cancel', writeLimiter, async (req, res) => {
    try {
      const run = await analysisStore.getAnalysisRun({ id: req.params.id });
      if (!['queued', 'running'].includes(run.status)) {
        return res.status(409).json({ error: 'Analysis run is not active.', run });
      }
      const controller = runAbortRegistry.get(req.params.id);
      if (!controller) return res.status(409).json({ error: 'Analysis run cannot be canceled.' });
      controller.abort(new Error('Analysis canceled by user.'));
      const canceledRun = await analysisStore.cancelAnalysisRun({ analysisId: req.params.id });
      if (canceledRun.status !== 'canceled') {
        return res.status(409).json({ error: 'Analysis run is no longer active.', run: canceledRun });
      }
      await runBus.publishTerminal(req.params.id, 'canceled');
      return res.json({ analysisId: req.params.id, status: 'canceled' });
    } catch (error) {
      logger.agent.error('[Analysis Runs] cancel failed:', error.message);
      return res.status(404).json({ error: 'Analysis run not found.' });
    }
  });


  const analysisRunStreamHandler = createAnalysisRunStreamHandler({
    getAnalysisRun: analysisStore.getAnalysisRun,
    getAnalysisEventsAfterSeq: analysisStore.getAnalysisEventsAfterSeq,
    runBus,
    heartbeatMs: 25000,
  });
  router.get('/runs/:id/stream', readLimiter, analysisRunStreamHandler);

  router.post(
    '/runs/:id/report',
    writeLimiter,
    createAnalysisReportRetryHandler({
      store: analysisStore,
      regenerate: (evidencePackage, opts) => generateClusterReport(evidencePackage, opts),
      composeNarrative: (report) => composeOverviewMarkdown(report),
    }),
  );

  return router;
}

module.exports = { createAnalysisRunsRouter };
