const { classifyQueryType } = require('../court-analysis/utils/queryClassifier');

const ALLOWED_QUERY_TYPES = new Set(['oib', 'case_number', 'text']);
const DEFAULT_CASE_LIMIT = 5;
const MIN_CASE_LIMIT = 1;
const MAX_CASE_LIMIT = 10;

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
    },
  };
}

module.exports = {
  parseCourtAnalysisRequest,
  DEFAULT_CASE_LIMIT,
  MIN_CASE_LIMIT,
  MAX_CASE_LIMIT,
  ALLOWED_QUERY_TYPES,
};
