import { env } from './env';

class ApiError extends Error {
  constructor(message, { status, code, data, retryAfter } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    this.retryAfter = retryAfter;
  }
}

const ABSOLUTE_URL_RE = /^https?:\/\//i;

export const resolveApiUrl = (url) => {
  if (typeof url !== 'string' || !url) return url;
  if (ABSOLUTE_URL_RE.test(url)) return url;
  if (!url.startsWith('/api/')) return url;

  const configuredApiUrl = env.apiUrl;
  if (!configuredApiUrl || typeof configuredApiUrl !== 'string') {
    return url;
  }

  if (ABSOLUTE_URL_RE.test(configuredApiUrl)) {
    try {
      const parsed = new URL(configuredApiUrl);
      const apiPathIndex = parsed.pathname.indexOf('/api');
      const apiPrefix = apiPathIndex >= 0
        ? parsed.pathname.slice(0, apiPathIndex + 4)
        : '/api';
      return `${parsed.origin}${apiPrefix}${url.slice(4)}`;
    } catch {
      return url;
    }
  }

  const apiPathIndex = configuredApiUrl.indexOf('/api');
  if (apiPathIndex < 0) {
    return url;
  }
  const apiPrefix = configuredApiUrl.slice(0, apiPathIndex + 4);
  return `${apiPrefix}${url.slice(4)}`;
};

const buildHeaders = ({ headers = {}, isJson = true }) => {
  const out = { ...headers };

  if (isJson && !out['Content-Type']) {
    out['Content-Type'] = 'application/json';
  }

  return out;
};

export const apiFetch = async (url, { method = 'GET', body, headers, isJson = true, signal } = {}) => {
  const response = await fetch(resolveApiUrl(url), {
    method,
    headers: buildHeaders({ headers, isJson }),
    body: body === undefined ? undefined : isJson ? JSON.stringify(body) : body,
    signal,
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message = payload?.error || `Request failed with status ${response.status}`;
    const retryAfter = response.headers.get('retry-after');
    throw new ApiError(message, {
      status: response.status,
      code: payload?.code,
      data: payload,
      retryAfter,
    });
  }

  return payload;
};

export const getSettings = () => apiFetch('/api/settings');

export const updateSettings = (patch) => apiFetch('/api/settings', {
  method: 'PUT',
  body: patch,
});

export const ApiClientError = ApiError;

// Analysis Lab (LE-3): replay-first comparison runs over frozen evidence.
export const listLabPackages = () => apiFetch('/api/analysis-lab/packages');

export const createLabExperiment = (body) => apiFetch('/api/analysis-lab/experiments', {
  method: 'POST',
  body,
});

export const listLabExperiments = ({ limit = 50, offset = 0 } = {}) => apiFetch(
  `/api/analysis-lab/experiments?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`
);

export const getLabExperiment = (id) => apiFetch(
  `/api/analysis-lab/experiments/${encodeURIComponent(id)}`
);

// Programmatic Bench (/api/bench)
export const listBenchDocuments = (model) => apiFetch(
  `/api/bench/documents${model ? `?model=${encodeURIComponent(model)}` : ''}`
);
export const listBenchModels = () => apiFetch('/api/bench/models');
export const syncBenchModels = () => apiFetch('/api/bench/models/sync', {
  method: 'POST',
  body: { approved: true },
});
export const runGbenchGate = (body) => apiFetch('/api/bench/gbench/gate', {
  method: 'POST',
  body,
});
export const listBenchCandidates = (limit = 50) => apiFetch(`/api/bench/candidates?limit=${encodeURIComponent(limit)}`);
export const seedBenchCandidates = () => apiFetch('/api/bench/candidates/seed', { method: 'POST', body: {} });
export const runCandidateMicroBench = (id, body) => apiFetch(
  `/api/bench/candidates/${encodeURIComponent(id)}/micro-bench`,
  { method: 'POST', body }
);
export const listBenchRuns = () => apiFetch('/api/bench/runs');
export const launchBenchRun = (body) => apiFetch('/api/bench/runs', { method: 'POST', body });
export const getBenchJob = (id) => apiFetch(`/api/bench/jobs/${encodeURIComponent(id)}`);
export const cancelBenchJob = (id) => apiFetch(`/api/bench/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
export const getBenchRunReport = (runId) => apiFetch(`/api/bench/runs/${encodeURIComponent(runId)}/report`);
export const getBenchRunTraces = (runId) => apiFetch(`/api/bench/runs/${encodeURIComponent(runId)}/traces`);
export const getBenchReview = (runId, { sample = 3, seed = 7 } = {}) => apiFetch(
  `/api/bench/runs/${encodeURIComponent(runId)}/review?sample=${encodeURIComponent(sample)}&seed=${encodeURIComponent(seed)}`
);
export const submitBenchReview = (runId, verdicts) => apiFetch(
  `/api/bench/runs/${encodeURIComponent(runId)}/review`,
  { method: 'POST', body: { verdicts } }
);
export const listBenchGoldSets = () => apiFetch('/api/bench/gold/sets');
export const getBenchGoldTemplate = (set, file) => apiFetch(
  `/api/bench/gold/template?set=${encodeURIComponent(set)}&file=${encodeURIComponent(file)}`
);
export const saveBenchGoldTemplate = (body) => apiFetch('/api/bench/gold/save', { method: 'POST', body });
export const suggestBenchGold = (body) => apiFetch('/api/bench/gold/suggest', { method: 'POST', body });
export const getBenchGoldPageUrl = (set, file, page) => resolveApiUrl(
  `/api/bench/gold/page?set=${encodeURIComponent(set)}&file=${encodeURIComponent(file)}&page=${encodeURIComponent(page)}`
);
