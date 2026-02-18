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

const buildHeaders = ({ token, headers = {}, isJson = true }) => {
  const out = { ...headers };

  if (isJson && !out['Content-Type']) {
    out['Content-Type'] = 'application/json';
  }

  if (token) {
    out.Authorization = `Bearer ${token}`;
  }

  return out;
};

export const apiFetch = async (url, { method = 'GET', body, token, headers, isJson = true, signal } = {}) => {
  const response = await fetch(url, {
    method,
    headers: buildHeaders({ token, headers, isJson }),
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

export const ApiClientError = ApiError;
