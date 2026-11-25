function createRunAbortRegistry() {
  const controllers = new Map();

  function register(runId, controller = new AbortController()) {
    if (!runId || typeof runId !== 'string') throw new TypeError('runId must be a non-empty string');
    if (!(controller instanceof AbortController)) throw new TypeError('controller must be an AbortController');
    controllers.set(runId, controller);
    return controller;
  }

  function get(runId) {
    return controllers.get(runId) || null;
  }

  function unregister(runId, controller) {
    if (!controller || controllers.get(runId) === controller) return controllers.delete(runId);
    return false;
  }

  function abort(runId, reason = new Error('Run aborted')) {
    const controller = controllers.get(runId);
    if (!controller) return false;
    if (!controller.signal.aborted) controller.abort(reason);
    return true;
  }

  function abortAll(reason = new Error('Server shutting down')) {
    const runIds = [...controllers.keys()];
    for (const runId of runIds) abort(runId, reason);
    return runIds;
  }

  return { register, get, unregister, abort, abortAll, activeRunIds: () => [...controllers.keys()] };
}

module.exports = { createRunAbortRegistry };
