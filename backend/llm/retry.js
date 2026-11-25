const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;

// Fail-fast guard against hung OpenRouter requests: `invoke` can pend without
// ever settling, which stalls the retry loop. Each request is capped with a
// timer-driven AbortSignal so stuck calls reject promptly and partial results
// can be persisted. Override with OPENROUTER_REQUEST_TIMEOUT_MS.
const OPENROUTER_REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS) || 30000;

// Transient bursts hang until the timeout guard fires, so AbortError timeouts
// are retried with backoff by default. Set to "0" to restore fail-fast behavior.
const OPENROUTER_RETRY_TIMEOUTS = process.env.OPENROUTER_RETRY_TIMEOUTS !== '0';

const { isDailyQuotaExhaustion, extractProviderError } = require('../http/friendlyAnalysisError');

async function withGeminiTimeout(callable, { timeoutMs = OPENROUTER_REQUEST_TIMEOUT_MS } = {}) {
    if (!timeoutMs || timeoutMs <= 0) {
        return Promise.resolve().then(() => callable(undefined));
    }

    const controller = new AbortController();
    let rejectOnAbort;
    const aborted = new Promise((_, reject) => {
        rejectOnAbort = () => {
            const error = new Error(`Gemini request timed out after ${timeoutMs}ms`);
            error.name = 'AbortError';
            reject(error);
        };
        controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });

    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await Promise.race([
            Promise.resolve().then(() => callable(controller.signal)),
            aborted
        ]);
    } finally {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', rejectOnAbort);
    }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(error) {
  const header = error?.response?.headers?.['retry-after'] ||
    error?.response?.headers?.['Retry-After'] ||
    error?.response?.headers?.['x-retry-after-ms'] ||
    error?.response?.headers?.['X-Retry-After-Ms'];

  const headerNumber = Number(header);
  if (header && Number.isFinite(headerNumber) && headerNumber > 0) {
    // retry-after can be seconds
    return headerNumber < 1000 ? headerNumber * 1000 : headerNumber;
  }

  const extracted = (error && typeof error === 'object') ? extractProviderError(error) : null;
  if (extracted && Number.isFinite(extracted.retryDelayMs) && extracted.retryDelayMs > 0) {
    return Math.min(extracted.retryDelayMs, MAX_DELAY_MS);
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

function shouldRetry(error, options = {}) {
  // Explicit daily-quota exhaustion is terminal — retrying burns the remaining
  // budget. Anything less specific retries: bursts recover with backoff.
  if (isDailyQuotaExhaustion(error && typeof error === 'object' ? error : `${error?.message || ''}`)) return false;

  const status = error?.status || error?.response?.status;
  const message = `${error?.message || ''}`.toLowerCase();

  // Server-side transient errors (5xx) are retryable regardless of plan.
  if (status === 503 || status === 500) return true;

  const isRateLimit =
    status === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests');
  const isTimeout = error?.name === 'AbortError';

  if (isRateLimit || isTimeout) {
    // A rate-limit/timeout is a transient burst that recovers with backoff,
    // so it is retried. Only an explicit daily-quota signal (checked above)
    // stops retries.
    if (isTimeout) return options.retryTimeouts !== false && OPENROUTER_RETRY_TIMEOUTS;
    return true;
  }

  // "overloaded" is a server-side transient condition, not a quota signal.
  if (message.includes('overloaded')) return true;

  return false;
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
      if (!shouldRetry(error, options) || attempt >= maxRetries) {
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
    withGeminiTimeout,
    parseRetryAfterMs,
    shouldRetry,
    OPENROUTER_REQUEST_TIMEOUT_MS,
    OPENROUTER_RETRY_TIMEOUTS,
};
