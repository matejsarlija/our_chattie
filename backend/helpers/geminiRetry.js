const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(error) {
  const header = error?.response?.headers?.['retry-after'] ||
    error?.response?.headers?.['Retry-After'] ||
    error?.response?.headers?.['x-retry-after-ms'] ||
    error?.response?.headers?.['X-Retry-After-Ms'];

  if (header) {
    const parsed = Number(header);
    if (Number.isFinite(parsed) && parsed > 0) {
      // retry-after can be seconds
      return parsed < 1000 ? parsed * 1000 : parsed;
    }
  }

  const message = `${error?.message || ''}`.toLowerCase();
  const match = message.match(/retry\s*after\s*(\d+(?:\.\d+)?)/);
  if (match) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.min(seconds * 1000, MAX_DELAY_MS);
    }
  }

  return null;
}

function shouldRetry(error) {
  const status = error?.status || error?.response?.status;
  if (status === 429 || status === 503 || status === 500) return true;
  const message = `${error?.message || ''}`.toLowerCase();
  return message.includes('rate limit') || message.includes('overloaded');
}

async function withGeminiRetry(fn, options = {}) {
  const maxRetries = Number.isFinite(options.maxRetries)
    ? options.maxRetries
    : DEFAULT_MAX_RETRIES;
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : null;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!shouldRetry(error) || attempt >= maxRetries) {
        throw error;
      }

      const retryAfterMs = parseRetryAfterMs(error);
      const exponential = Math.min(BASE_DELAY_MS * (2 ** attempt), MAX_DELAY_MS);
      const jitter = Math.floor(Math.random() * 500);
      const delayMs = Math.min(retryAfterMs || exponential + jitter, MAX_DELAY_MS);

      if (onRetry) {
        onRetry({ attempt: attempt + 1, delayMs, error });
      }

      await sleep(delayMs);
      attempt += 1;
    }
  }
}

module.exports = {
  withGeminiRetry,
  parseRetryAfterMs,
};
