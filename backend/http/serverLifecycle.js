const fs = require('node:fs');
const path = require('node:path');

function sweepOrphanedUploads(uploadsDir) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  let removed = 0;
  for (const name of fs.readdirSync(uploadsDir)) {
    if (name === '.dl-cache') continue;
    fs.rmSync(path.join(uploadsDir, name), { recursive: true, force: true });
    removed += 1;
  }
  return removed;
}

function recoverServerState({ analysisStore, uploadsDir }) {
  const interruptedRuns = analysisStore.markStaleRunsInterrupted();
  const removedUploadEntries = sweepOrphanedUploads(uploadsDir);
  return { interruptedRuns, removedUploadEntries };
}

function installShutdownHandlers({ server, queue, runAbortRegistry, analysisStore, runBus, processRef = process, onError = console.error }) {
  let shutdownPromise = null;

  function shutdown(signal = 'shutdown') {
    if (shutdownPromise) return shutdownPromise;
    const shutdownError = Object.assign(new Error(`Server shutting down (${signal})`), {
      name: 'AbortError',
      code: 'ERR_SERVER_SHUTDOWN',
    });
    const runIds = runAbortRegistry.abortAll(shutdownError);
    runBus?.closeAll();
    const serverClosed = new Promise((resolve, reject) => {
      if (!server?.listening) return resolve();
      server.close((error) => (error ? reject(error) : resolve()));
    });
    const queueDrained = queue?.onIdle ? queue.onIdle() : Promise.resolve();
    shutdownPromise = Promise.all([serverClosed, queueDrained])
      .then(() => analysisStore.markRunsInterrupted(runIds))
      .finally(() => analysisStore.close());
    return shutdownPromise;
  }

  const onSigint = () => { void shutdown('SIGINT').catch(onError); };
  const onSigterm = () => { void shutdown('SIGTERM').catch(onError); };
  processRef.once('SIGINT', onSigint);
  processRef.once('SIGTERM', onSigterm);

  return {
    shutdown,
    removeHandlers() {
      processRef.removeListener('SIGINT', onSigint);
      processRef.removeListener('SIGTERM', onSigterm);
    },
  };
}

module.exports = { sweepOrphanedUploads, recoverServerState, installShutdownHandlers };
