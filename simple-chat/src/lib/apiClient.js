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
