const { classifyQueryType } = require('../court-analysis/utils/queryClassifier');

const ALLOWED_QUERY_TYPES = new Set(['oib', 'case_number', 'text']);
const SCAN_DEPTHS = ['balanced', 'full'];
const DEFAULT_SCAN_DEPTH = 'balanced';

function createBadRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}


// Keeps request parsing aligned with the only supported acquisition budgets.
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
      scanDepth: coerceScanDepth(optionsPayload.scanDepth),
    },
  };
}

module.exports = {
  parseCourtAnalysisRequest,
  SCAN_DEPTHS,
  DEFAULT_SCAN_DEPTH,
  ALLOWED_QUERY_TYPES,
};
