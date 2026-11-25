const express = require('express');
const { parsePagination } = require('../http/pagination');
const { buildSseEvent } = require('../http/sse');
const { createAnalysisRunStreamHandler } = require('../http/analysisStreamHandler');
const {
  isTerminalStatus,
  buildCursor,
  didRunChange,
  getNewEvents,
  shouldStartStreamTimers,
} = require('../http/analysisStream');
const { createAnalysisReportRetryHandler } = require('../http/analysisReportRetry');
const { generateClusterReport, composeOverviewMarkdown } = require('../court-analysis/reasoning/synthesis/reportService');
const logger = require('../services/logger');

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
