require('dotenv').config();
const { assertOpenRouterConfig } = require('./llm/openrouterConfig');
const logger = require('./services/logger');

try {
  assertOpenRouterConfig();
} catch (error) {
  logger.agent.error('[Startup] ' + error.message);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const rateLimiter = require('./http/rateLimiter');
const { createSqliteStore } = require('./services/sqliteStore');
const { createAnalysisLabStore } = require('./services/analysisLabStore');
const { createAnalysisLabRouter } = require('./court-analysis/reasoning/analysisLab/api');
const { createChangeCheckService } = require('./change-detection/service');
const { createCourtAnalysisRouter } = require('./routes/courtAnalysis');
const { createAnalysisRunsRouter } = require('./routes/analysisRuns');
const { createChangeDetectionRouter } = require('./routes/changeDetection');
const { createBenchRouter } = require('./routes/bench');
const path = require('node:path');
const { createRunAbortRegistry } = require('./http/runAbortRegistry');
const { recoverServerState, installShutdownHandlers } = require('./http/serverLifecycle');
const { createRunBus } = require('./http/runBus');
async function startServer() {
  const { default: PQueue } = await import('p-queue');
  logger.agent.log('p-queue module loaded successfully.');

  const app = express();
  app.set('trust proxy', 1);
  const port = Number(process.env.PORT) || 3001;
  const host = '0.0.0.0';
  const courtAnalysisQueue = new PQueue({ concurrency: 2 });
  const analysisStore = createSqliteStore();
  const runBus = createRunBus({ analysisStore });
  const runAbortRegistry = createRunAbortRegistry();
  const recovery = recoverServerState({
    analysisStore,
    uploadsDir: path.join(__dirname, 'uploads'),
  });
  logger.agent.log(`[Startup] Interrupted ${recovery.interruptedRuns} stale run(s); removed ${recovery.removedUploadEntries} upload item(s).`);
  const analysisLabStore = createAnalysisLabStore();
  const changeCheckService = createChangeCheckService({ store: analysisStore });

  app.use(helmet());
  app.use('/api/court-analysis', rateLimiter);

  const analysisWriteIpLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu.' });
  const analysisReadIpLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, message: 'Previše zahtjeva. Molimo pokušajte ponovno za 1 minutu.' });

  let allowedOrigins = ['https://our-chattie-front.onrender.com', 'https://alimentacija.info', 'https://www.alimentacija.info'];
  if (process.env.NODE_ENV !== 'production') allowedOrigins.push('http://localhost:3000');
  if (process.env.CORS_ORIGIN) {
    const envOrigins = process.env.CORS_ORIGIN.split(',').map((item) => item.trim());
    allowedOrigins = [...new Set([...allowedOrigins, ...envOrigins])];
  }
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());
  app.use('/api/court-analysis', createCourtAnalysisRouter({
    analysisStore, courtAnalysisQueue, writeLimiter: analysisWriteIpLimiter, runAbortRegistry, runBus,
  }));
  app.use('/api/analysis', createAnalysisRunsRouter({
    analysisStore, readLimiter: analysisReadIpLimiter, writeLimiter: analysisWriteIpLimiter, runAbortRegistry, runBus,
  }));
  app.use('/api/analysis-lab', createAnalysisLabRouter({ labStore: analysisLabStore, analysisStore, readLimiter: analysisReadIpLimiter, writeLimiter: analysisWriteIpLimiter }));
  app.use('/api/bench', createBenchRouter({
    analysisStore,
    readLimiter: analysisReadIpLimiter,
    writeLimiter: analysisWriteIpLimiter,
  }));


  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });
  app.get('/api/settings', analysisReadIpLimiter, async (req, res) => {
    try {
      res.json({ settings: analysisStore.getSettings() });
    } catch (error) {
      logger.agent.error('[Settings] get failed:', error.message);
      res.status(500).json({ error: 'Failed to load settings.' });
    }
  });
  app.put('/api/settings', analysisWriteIpLimiter, async (req, res) => {
    try {
      const settings = await analysisStore.updateSettings(req.body);
      res.json({ settings });
    } catch (error) {
      logger.agent.error('[Settings] update failed:', error.message);
      res.status(error.statusCode === 400 ? 400 : 500).json({ error: error.message });
    }
  });
  app.use('/api/change-detection', createChangeDetectionRouter({
    service: changeCheckService,
    writeLimiter: analysisWriteIpLimiter,
    readLimiter: analysisReadIpLimiter,
  }));

  app.use((err, req, res, next) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    next();
  });

  const server = app.listen(port, host, () => {
    logger.agent.log(`Court analysis server running on ${host}:${port}`);
  });
  installShutdownHandlers({
    server,
    queue: courtAnalysisQueue,
    runAbortRegistry,
    analysisStore,
    runBus,
    onError: (error) => logger.agent.error('[Shutdown] Failed:', error),
  });
  server.on('error', (error) => {
    logger.agent.error('[Startup] Server listen failed:', error);
    process.exit(1);
  });
}


startServer().catch(error => {
  logger.agent.error("Failed to start server:", error);
  process.exit(1);
});
