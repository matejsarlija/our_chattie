// Keep all your original CommonJS require() statements at the top
require('dotenv').config();
const { assertGeminiConfig, GEMINI_MODEL } = require('./helpers/geminiConfig');

// Fail loudly at startup instead of surfacing a confusing mid-run 500 (or an
// opaque constructor error from the SDK) when GOOGLE_API_KEY is missing. This
// must run BEFORE anything that constructs a ChatGoogleGenerativeAI client.
// Local users copy backend/.env.example to backend/.env and set their own key.
try {
  assertGeminiConfig();
} catch (error) {
  console.error('[Startup] ' + error.message);
  process.exit(1);
}
console.log(`Gemini model configured: ${GEMINI_MODEL}`);

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { buildSseEvent } = require('./helpers/sse');
const { createAnalysisRunStreamHandler } = require('./helpers/analysisStreamHandler');
const { buildCourtAnalysisPayload } = require('./helpers/courtAnalysisPayload');
const { friendlyAnalysisErrorMessage } = require('./helpers/friendlyAnalysisError');
const { parsePagination } = require('./helpers/pagination');
const { parseCourtAnalysisRequest } = require('./helpers/courtAnalysisRequest');
const { normalizeAnalysisProgressEvent } = require('./helpers/analysisStage');
const {
  isTerminalStatus,
  buildCursor,
  didRunChange,
  getNewEvents,
  shouldStartStreamTimers,
} = require('./helpers/analysisStream');
const rateLimiter = require('./court-analysis/utils/rateLimiter');
const { runCourtAnalysis } = require('./court-analysis/pipeline');
const { createLocalStore } = require('./services/localStore');

// ========= WRAP THE ENTIRE SERVER LOGIC IN AN ASYNC FUNCTION =========
async function startServer() {

  // ========= CHANGE 3: DYNAMICALLY IMPORT P-QUEUE HERE =========
  // We use await to pause execution until the module is loaded.
  // We use { default: PQueue } because p-queue uses a default export.
  const { default: PQueue } = await import('p-queue');
  console.log('p-queue module loaded successfully.');

  const app = express();
  app.set('trust proxy', 1); // Trust the first proxy (e.g., React dev server or production LB)
  const port = Number(process.env.PORT) || 3001;
  const host = '0.0.0.0';
  const courtAnalysisQueue = new PQueue({ concurrency: 1 }); // This should work now

  // Local, single-tenant analysis persistence store.
  const analysisStore = createLocalStore();

  // Middleware
  app.use(helmet());

  // Rate limiters
  app.use('/api/court-analysis', rateLimiter);

  const analysisWriteIpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu.',
  });

  const analysisReadIpLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: 'Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu.',
  });

  // Define default allowed origins based on environment
  let allowedOrigins = [
    'https://our-chattie-front.onrender.com',
    'https://alimentacija.info',
    'https://www.alimentacija.info'
  ];

  // Only allow localhost in development or if explicitly requested
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000');
  }

  // If environment variable exists, merge it in to allow for additional flexibility
  if (process.env.CORS_ORIGIN) {
    const envOrigins = process.env.CORS_ORIGIN.split(',').map(item => item.trim());
    // Create a unique set of origins to avoid duplicates
    allowedOrigins = [...new Set([...allowedOrigins, ...envOrigins])];
  }

  const corsOrigin = allowedOrigins;

  app.use(cors({
    origin: corsOrigin,
    credentials: true
  }));

  app.use(express.json());

  app.post('/api/court-analysis', analysisWriteIpLimiter, async (req, res) => {
    let parsedRequest;
    try {
      parsedRequest = parseCourtAnalysisRequest(req.body);
    } catch (err) {
      if (err.statusCode === 400) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    // --- Step 1: Immediately set up the streaming connection for the user ---
    // This tells the browser to keep the connection open and wait for events.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Send these headers now to establish the connection.

    // --- Step 2: Add the heavy task to the queue to protect the server ---
    // The code inside add() will only run when it's this request's turn.
    courtAnalysisQueue.add(async () => {
      let analysisRun = null;

      // Define the progress callback INSIDE the queued job.
      // This is crucial because it gives the job access to this specific user's `res` object.
      const progressCallback = (data) => {
        // Safety check: Don't try to write to a connection that the user has already closed.
        if (!res.writableEnded) {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        }
      };

      try {
        analysisRun = await analysisStore.createAnalysisRun({
          oib: parsedRequest.query.value,
          queryType: parsedRequest.query.type,
          queryValue: parsedRequest.query.value,
          status: 'running',
        });

        const runId = analysisRun.id;

        const safeProgress = async (event) => {
          const normalizedEvent = normalizeAnalysisProgressEvent(event);
          progressCallback(normalizedEvent);
          try {
            await analysisStore.appendAnalysisEvent({
              analysisId: runId,
              eventType: normalizedEvent.step || 'progress',
              message: normalizedEvent.message || null,
              metadata: {
                progress: normalizedEvent.progress || null,
                hasData: Boolean(normalizedEvent.data),
                ...(normalizedEvent.metadata?.originalStep ? { originalStep: normalizedEvent.metadata.originalStep } : {}),
              },
            });
          } catch (err) {
            console.error('[Analysis Events] Failed to persist event:', err.message);
          }
        };

        // Emit run id immediately so the client can start polling events.
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
            caseLimit: parsedRequest.options.caseLimit,
            query: parsedRequest.query,
            clusterExpansion: parsedRequest.options.clusterExpansion,
          },
          safeProgress
        );

        const finalPayload = buildCourtAnalysisPayload(finalResult);
        const sanitizedResult = finalPayload.comparativeAnalysis;
        await analysisStore.completeAnalysisRun({
          analysisId: runId,
          resultText: sanitizedResult,
          resultJson: finalPayload,
        });

        await safeProgress({
          step: 'complete',
          progress: 100,
          message: 'Analiza je završena!',
          data: finalPayload // Send the new payload structure.
        });

      } catch (error) {
        console.error('[Court Analysis Queue] Pipeline error:', error);
        // If the pipeline fails, persist whatever partial results were accumulated
        // (discovery metadata, partially processed cases, partial narrative/report)
        // alongside a transparent user-facing error message.
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
            console.error('[Analysis Events] Failed to persist error event:', err.message);
          });

          await analysisStore.failAnalysisRun({
            analysisId: analysisRun.id,
            errorMessage,
            resultJson: partialPayload,
            resultText: partialPayload?.comparativeAnalysis || null,
          }).catch((err) => {
            console.error('[Analysis Runs] Failed to mark error:', err.message);
          });

          progressCallback({
            step: 'error',
            progress: 100,
            message: errorMessage,
            data: partialPayload || undefined
          });
        } else {
          const errorMessage = friendlyAnalysisErrorMessage(error, { hasPartial: false });
          progressCallback({
            step: 'error',
            progress: 100,
            message: errorMessage
          });
        }
      } finally {
        // --- Step 4: Close the connection for this user ---
        // This runs whether the job succeeded or failed, ensuring the connection is always closed.
        if (!res.writableEnded) {
          res.end();
        }
        console.log(`[Court Analysis Queue] Stream closed for search term: ${parsedRequest.query.value}`);
      }
    });

    // --- Optional but Recommended: Handle user disconnection ---
    // If the user closes their browser tab while their request is waiting in the queue,
    // this will log it. The `writableEnded` check above prevents errors.
    req.on('close', () => {
      console.log(`[Court Analysis Queue] Client disconnected while waiting or processing term: ${parsedRequest.query.value}`);
    });
  });

  app.get('/api/analysis/runs', analysisReadIpLimiter, async (req, res) => {
    try {
      const { limit, offset } = parsePagination(req.query);
      const result = await analysisStore.listAnalysisRuns({ limit, offset });
      res.json({ runs: result.data, count: result.count, limit, offset });
    } catch (error) {
      console.error('[Analysis Runs] list failed:', error.message);
      res.status(500).json({ error: 'Failed to load analysis runs.' });
    }
  });

  app.get('/api/analysis/runs/:id', analysisReadIpLimiter, async (req, res) => {
    try {
      const run = await analysisStore.getAnalysisRun({ id: req.params.id });
      res.json({ run });
    } catch (error) {
      console.error('[Analysis Runs] get failed:', error.message);
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  app.get('/api/analysis/runs/:id/full', analysisReadIpLimiter, async (req, res) => {
    try {
      const result = await analysisStore.getAnalysisRunFull({ id: req.params.id });
      res.json({
        run: result.run,
        events: result.events,
        server_time: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[Analysis Runs] get full failed:', error.message);
      res.status(404).json({ error: 'Analysis run not found.' });
    }
  });

  app.get('/api/analysis/runs/:id/events', analysisReadIpLimiter, async (req, res) => {
    try {
      const events = await analysisStore.getAnalysisEvents({ analysisId: req.params.id });
      res.json({ events });
    } catch (error) {
      console.error('[Analysis Events] get failed:', error.message);
      res.status(404).json({ error: 'Analysis events not found.' });
    }
  });

  const analysisRunStreamHandler = createAnalysisRunStreamHandler({
    getAnalysisRunFull: analysisStore.getAnalysisRunFull,
    buildSseEvent,
    isTerminalStatus,
    buildCursor,
    didRunChange,
    getNewEvents,
    shouldStartStreamTimers,
    streamPollMs: 1500,
    heartbeatMs: 25000,
  });
  app.get('/api/analysis/runs/:id/stream', analysisReadIpLimiter, analysisRunStreamHandler);

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use((err, req, res, next) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });

  const server = app.listen(port, host, () => {
    console.log(`Gemini server running on ${host}:${port}`);
  });
  server.on('error', (error) => {
    console.error('[Startup] Server listen failed:', error);
    process.exit(1);
  });

} // End of the async startServer function


// ========= CALL THE FUNCTION TO START THE SERVER =========
// It's good practice to catch any errors during startup.
startServer().catch(error => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
