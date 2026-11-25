const express = require('express');
const { buildCourtAnalysisPayload } = require('../http/courtAnalysisPayload');
const { friendlyAnalysisErrorMessage } = require('../http/friendlyAnalysisError');
const { parseCourtAnalysisRequest } = require('../http/courtAnalysisRequest');
const { normalizeAnalysisProgressEvent } = require('../http/analysisStage');
const { runCourtAnalysis } = require('../court-analysis/pipeline');
const logger = require('../services/logger');

function createCourtAnalysisRouter({ analysisStore, courtAnalysisQueue, writeLimiter }) {
  const router = express.Router();

  router.post('/', writeLimiter, async (req, res) => {
    let parsedRequest;
    try {
      parsedRequest = parseCourtAnalysisRequest(req.body);
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    courtAnalysisQueue.add(async () => {
      let analysisRun = null;
      const progressCallback = (data) => {
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        analysisRun = await analysisStore.createAnalysisRun({
          oib: parsedRequest.query.value,
          queryType: parsedRequest.query.type,
          queryValue: parsedRequest.query.value,
          scanDepth: parsedRequest.options.scanDepth,
          status: 'running',
        });

        const runId = analysisRun.id;
        const safeProgress = async (event) => {
          const normalizedEvent = normalizeAnalysisProgressEvent(event);
          progressCallback(normalizedEvent);

          const isUsageUpdate = Boolean(
            normalizedEvent.usage
            && typeof normalizedEvent.usage === 'object'
            && normalizedEvent.message == null
            && normalizedEvent.data == null
          );
          if (isUsageUpdate) {
            try {
              await analysisStore.updateAnalysisRunUsage({
                analysisId: runId,
                usage: normalizedEvent.usage,
              });
            } catch (err) {
              logger.agent.error('[Analysis Runs] Failed to persist token usage:', err.message);
            }
            return;
          }

          try {
            await analysisStore.appendAnalysisEvent({
              analysisId: runId,
              eventType: normalizedEvent.step || 'progress',
              message: normalizedEvent.message || null,
              metadata: {
                progress: normalizedEvent.progress || null,
                hasData: Boolean(normalizedEvent.data),
                ...(normalizedEvent.metadata || {}),
              },
            });
          } catch (err) {
            logger.agent.error('[Analysis Events] Failed to persist event:', err.message);
          }
        };

        await safeProgress({
          step: 'queued',
          progress: 1,
          message: 'Zahtjev je zaprimljen.',
          analysisId: runId,
        });
        await safeProgress({ step: 'starting', progress: 5, message: 'Vaš zahtjev je započeo s obradom...' });

        const finalResult = await runCourtAnalysis(
          parsedRequest.query.value,
          {
            query: parsedRequest.query,
            scanDepth: parsedRequest.options.scanDepth,
            runId,
          },
          safeProgress
        );

        const finalPayload = buildCourtAnalysisPayload(finalResult);
        await analysisStore.completeAnalysisRun({
          analysisId: runId,
          resultText: finalPayload.comparativeAnalysis,
          resultJson: finalPayload,
        });
        await safeProgress({
          step: 'complete',
          progress: 100,
          message: 'Analiza je završena!',
          data: finalPayload,
        });
      } catch (error) {
        logger.agent.error('[Court Analysis Queue] Pipeline error:', error);
        if (analysisRun?.id) {
          const partialPayload = error?.partialResult
            ? buildCourtAnalysisPayload(error.partialResult)
            : null;
          const errorMessage = friendlyAnalysisErrorMessage(error, {
            stage: error?.stage || null,
            hasPartial: Boolean(partialPayload),
          });

          await analysisStore.appendAnalysisEvent({
            analysisId: analysisRun.id,
            eventType: 'error',
            message: errorMessage,
            metadata: {
              partialPayload: Boolean(partialPayload),
              ...(error?.stage ? { failedStage: error.stage } : {}),
            },
          }).catch((err) => {
            logger.agent.error('[Analysis Events] Failed to persist error event:', err.message);
          });
          await analysisStore.failAnalysisRun({
            analysisId: analysisRun.id,
            errorMessage,
            resultJson: partialPayload,
            resultText: partialPayload?.comparativeAnalysis || null,
          }).catch((err) => {
            logger.agent.error('[Analysis Runs] Failed to mark error:', err.message);
          });
          progressCallback({
            step: 'error',
            progress: 100,
            message: errorMessage,
            data: partialPayload || undefined,
          });
        } else {
          const errorMessage = friendlyAnalysisErrorMessage(error, { hasPartial: false });
          progressCallback({ step: 'error', progress: 100, message: errorMessage });
        }
      } finally {
        if (!res.writableEnded) {
          res.end();
        }
        logger.agent.log(`[Court Analysis Queue] Stream closed for search term: ${parsedRequest.query.value}`);
      }
    });

    req.on('close', () => {
      logger.agent.log(`[Court Analysis Queue] Client disconnected while waiting or processing term: ${parsedRequest.query.value}`);
    });
  });

  return router;
}

module.exports = { createCourtAnalysisRouter };
