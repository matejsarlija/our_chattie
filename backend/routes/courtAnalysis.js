const express = require('express');
const { buildCourtAnalysisPayload } = require('../http/courtAnalysisPayload');
const { friendlyAnalysisErrorMessage } = require('../http/friendlyAnalysisError');
const { parseCourtAnalysisRequest } = require('../http/courtAnalysisRequest');
const { normalizeAnalysisProgressEvent } = require('../http/analysisStage');
const { runCourtAnalysis } = require('../court-analysis/pipeline');
const logger = require('../services/logger');

function createCourtAnalysisRouter({ analysisStore, courtAnalysisQueue, writeLimiter, runAbortRegistry, runBus }) {
  const router = express.Router();

  router.post('/', writeLimiter, async (req, res) => {
    let parsedRequest;
    try {
      parsedRequest = parseCourtAnalysisRequest(req.body);
    } catch (err) {
      if (err.statusCode === 400) return res.status(400).json({ error: err.message });
      throw err;
    }

    let analysisRun;
    try {
      analysisRun = await analysisStore.createAnalysisRun({
        oib: parsedRequest.query.value,
        queryType: parsedRequest.query.type,
        queryValue: parsedRequest.query.value,
        scanDepth: parsedRequest.options.scanDepth,
        status: 'queued',
      });
    } catch (error) {
      logger.agent.error('[Court Analysis Queue] Failed to create run:', error.message);
      return res.status(500).json({ error: 'Failed to queue analysis.' });
    }

    const runId = analysisRun.id;
    const controller = runAbortRegistry.register(runId);
    await runBus.publish({
      runId,
      eventType: 'queued',
      message: 'Zahtjev je zaprimljen.',
      metadata: { progress: 1, status: 'queued' },
    });

    const safeProgress = async (event) => {
      const normalizedEvent = normalizeAnalysisProgressEvent(event);
      const isUsageUpdate = Boolean(
        normalizedEvent.usage
        && typeof normalizedEvent.usage === 'object'
        && normalizedEvent.message == null
        && normalizedEvent.data == null
      );
      if (isUsageUpdate) {
        try {
          await analysisStore.updateAnalysisRunUsage({ analysisId: runId, usage: normalizedEvent.usage });
        } catch (err) {
          logger.agent.error('[Analysis Runs] Failed to persist token usage:', err.message);
        }
        return;
      }
      const metadata = {
        progress: normalizedEvent.progress ?? null,
        kind: normalizedEvent.kind,
        ...(normalizedEvent.metadata || {}),
      };
      try {
        await runBus.publish({
          runId,
          eventType: normalizedEvent.step || 'progress',
          message: normalizedEvent.message || null,
          metadata,
        });
      } catch (err) {
        logger.agent.error('[Analysis Events] Failed to persist progress:', err.message);
      }
    };

    const runQueuedAnalysis = async () => {
      try {
        if (controller.signal.aborted) return;
        await analysisStore.startAnalysisRun({ analysisId: runId });
        await safeProgress({ step: 'starting', progress: 5, message: 'Vaš zahtjev je započeo s obradom...' });

        const finalResult = await runCourtAnalysis(
          parsedRequest.query.value,
          {
            query: parsedRequest.query,
            scanDepth: parsedRequest.options.scanDepth,
            analysisStore,
            runId,
            signal: controller.signal,
          },
          safeProgress,
        );
        controller.signal.throwIfAborted();
        const finalPayload = buildCourtAnalysisPayload(finalResult);
        await analysisStore.completeAnalysisRun({
          analysisId: runId,
          resultText: finalPayload.comparativeAnalysis,
          resultJson: finalPayload,
        });
        await safeProgress({ step: 'complete', progress: 100, message: 'Analiza je završena!' });
        const completedRun = await analysisStore.getAnalysisRun({ id: runId });
        await runBus.publishTerminal(runId, completedRun.status);
      } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
          const canceledRun = await analysisStore.cancelAnalysisRun({ analysisId: runId });
          await runBus.publishTerminal(runId, canceledRun.status);
          return;
        }
        logger.agent.error('[Court Analysis Queue] Pipeline error:', error);
        const partialPayload = error?.partialResult ? buildCourtAnalysisPayload(error.partialResult) : null;
        const errorMessage = friendlyAnalysisErrorMessage(error, {
          stage: error?.stage || null,
          hasPartial: Boolean(partialPayload),
        });
        await analysisStore.failAnalysisRun({
          analysisId: runId,
          errorMessage,
          resultJson: partialPayload,
          resultText: partialPayload?.comparativeAnalysis || null,
        }).catch((err) => logger.agent.error('[Analysis Runs] Failed to mark error:', err.message));
        await runBus.publish({ runId, eventType: 'error', message: errorMessage, metadata: { status: 'error' } });
        await runBus.publishTerminal(runId, 'error');
      } finally {
        runAbortRegistry.unregister(runId, controller);
      }
    };

    courtAnalysisQueue.add(runQueuedAnalysis).catch((error) => {
      logger.agent.error('[Court Analysis Queue] Failed to enqueue run:', error.message);
    });

    return res.status(202).json({ analysisId: runId, status: 'queued' });
  });

  return router;
}
module.exports = { createCourtAnalysisRouter };
