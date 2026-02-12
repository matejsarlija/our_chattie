const DEFAULT_TRIAL_LIMIT = 3;

function isTrialAllowed({ runsUsed, limit = DEFAULT_TRIAL_LIMIT }) {
  const safeRuns = Number.isFinite(runsUsed) ? Math.max(0, runsUsed) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : DEFAULT_TRIAL_LIMIT;
  return safeRuns < safeLimit;
}

function nextRunsUsed({ runsUsed, limit = DEFAULT_TRIAL_LIMIT }) {
  const safeRuns = Number.isFinite(runsUsed) ? Math.max(0, runsUsed) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : DEFAULT_TRIAL_LIMIT;
  return Math.min(safeRuns + 1, safeLimit);
}

module.exports = {
  DEFAULT_TRIAL_LIMIT,
  isTrialAllowed,
  nextRunsUsed,
};
