const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 1500;
const MAX_DELAY_MS = 15000;

// Fail-fast guard against the Google GenAI free-tier 429 hang:
// @langchain/google-genai `invoke` can pend forever on a rate-limit response
// instead of rejecting, which stalls `withGeminiRetry` (it only reacts to thrown
// errors) and therefore the whole single-concurrency analysis queue. Each request
// is capped with a timer-driven AbortSignal so quota spikes reject promptly and
// the pipeline can surface a transparent error + persist partial results.
const GEMINI_REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS) || 30000;

async function withGeminiTimeout(callable, { timeoutMs = GEMINI_REQUEST_TIMEOUT_MS } = {}) {
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
    withGeminiTimeout,
    parseRetryAfterMs,
    GEMINI_REQUEST_TIMEOUT_MS,
};
