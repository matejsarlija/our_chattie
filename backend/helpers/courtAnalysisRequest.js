const { classifyQueryType } = require('../court-analysis/utils/queryClassifier');

const ALLOWED_QUERY_TYPES = new Set(['oib', 'case_number', 'text']);
const DEFAULT_CASE_LIMIT = 5;
const MIN_CASE_LIMIT = 1;
const MAX_CASE_LIMIT = 10;
const DEFAULT_CLUSTER_EXPANSION_PASSES = 2;
const MIN_CLUSTER_EXPANSION_PASSES = 0;
const MAX_CLUSTER_EXPANSION_PASSES = 2;
const SCAN_DEPTHS = ['standard', 'balanced', 'full'];
const DEFAULT_SCAN_DEPTH = 'balanced';

function createBadRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function coerceCaseLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_CASE_LIMIT;
  }

  const numeric = Number.parseInt(String(value), 10);
  if (Number.isNaN(numeric)) {
    throw createBadRequest('Invalid options.caseLimit. Expected an integer.');
  }
  if (numeric < MIN_CASE_LIMIT) return MIN_CASE_LIMIT;
  if (numeric > MAX_CASE_LIMIT) return MAX_CASE_LIMIT;
  return numeric;
}

// Threads the optional cluster-expansion depth through the API route (3a).
// Accepts either an explicit object `{ maxPasses }`, a boolean (true = default
// passes), or null/absent (let the pipeline's deterministic heuristics decide).
function coerceClusterExpansion(value) {
  if (value === undefined || value === null || value === '' || value === false) {
    return null;
  }

  if (value === true) {
    return { maxPasses: DEFAULT_CLUSTER_EXPANSION_PASSES };
  }

  if (typeof value === 'object') {
    const raw = value.maxPasses;
    if (raw === undefined || raw === null || raw === '') {
      return { maxPasses: DEFAULT_CLUSTER_EXPANSION_PASSES };
    }
    const numeric = Number.parseInt(String(raw), 10);
    if (Number.isNaN(numeric)) {
      throw createBadRequest('Invalid options.clusterExpansion.maxPasses. Expected an integer.');
    }
    const clamped = Math.max(MIN_CLUSTER_EXPANSION_PASSES, Math.min(MAX_CLUSTER_EXPANSION_PASSES, numeric));
    return { maxPasses: clamped };
  }

  const numeric = Number.parseInt(String(value), 10);
  if (Number.isNaN(numeric)) {
    throw createBadRequest('Invalid options.clusterExpansion. Expected a boolean, integer, or { maxPasses }.');
  }
  const clamped = Math.max(MIN_CLUSTER_EXPANSION_PASSES, Math.min(MAX_CLUSTER_EXPANSION_PASSES, numeric));
  return { maxPasses: clamped };
}

// Threads the search scan-depth knob (dial) through the API route. One of
// `standard` (default window only), `balanced` (default window + oldest-10 tail,
// the default), or `full` (scan every available page).
function coerceScanDepth(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_SCAN_DEPTH;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!SCAN_DEPTHS.includes(normalized)) {
    throw createBadRequest(`Invalid options.scanDepth. Allowed values: ${SCAN_DEPTHS.join(', ')}.`);
  }
  return normalized;
}

function parseCourtAnalysisRequest(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const queryPayload = payload.query && typeof payload.query === 'object' ? payload.query : null;
  const optionsPayload = payload.options && typeof payload.options === 'object' ? payload.options : {};

  let queryType = '';
  let queryValue = '';

  if (queryPayload) {
    queryType = String(queryPayload.type || '').trim().toLowerCase();
    queryValue = String(queryPayload.value || '').trim();

    if (queryType && !ALLOWED_QUERY_TYPES.has(queryType)) {
      throw createBadRequest('Invalid query.type. Allowed values: oib, case_number, text.');
    }
    if (queryType && !queryValue) {
      throw createBadRequest('query.value is required when query.type is provided.');
    }
  }

  if (!queryValue) {
    queryValue = String(payload.searchTerm || '').trim();
    if (!queryValue) {
      throw createBadRequest('Search term is required.');
    }
    queryType = queryType || classifyQueryType(queryValue);
  }

  if (!queryType) {
    queryType = classifyQueryType(queryValue);
  }

  return {
    query: {
      type: queryType,
      value: queryValue,
    },
    searchTerm: queryValue,
    options: {
      caseLimit: coerceCaseLimit(optionsPayload.caseLimit),
      clusterExpansion: coerceClusterExpansion(optionsPayload.clusterExpansion),
      scanDepth: coerceScanDepth(optionsPayload.scanDepth),
    },
  };
}

module.exports = {
  parseCourtAnalysisRequest,
  DEFAULT_CASE_LIMIT,
  MIN_CASE_LIMIT,
  MAX_CASE_LIMIT,
  DEFAULT_CLUSTER_EXPANSION_PASSES,
  MIN_CLUSTER_EXPANSION_PASSES,
  MAX_CLUSTER_EXPANSION_PASSES,
  SCAN_DEPTHS,
  DEFAULT_SCAN_DEPTH,
  ALLOWED_QUERY_TYPES,
};
