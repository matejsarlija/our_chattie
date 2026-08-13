const { withGeminiTimeout, GEMINI_REQUEST_TIMEOUT_MS } = require('../helpers/geminiRetry');

describe('withGeminiTimeout', () => {
  test('defaults to a positive, env-overridable timeout', () => {
    expect(GEMINI_REQUEST_TIMEOUT_MS).toBeGreaterThan(0);
  });

  test('returns the callable result when it resolves before the timeout', async () => {
    await expect(withGeminiTimeout(() => Promise.resolve('ok'), { timeoutMs: 1000 })).resolves.toBe('ok');
  });

  test('threads a non-aborted AbortSignal into the callable', async () => {
    let received;
    await withGeminiTimeout((signal) => {
      received = signal;
      return Promise.resolve('ok');
    }, { timeoutMs: 1000 });

    expect(received).toBeInstanceOf(AbortSignal);
    expect(received.aborted).toBe(false);
  });

  test('rejects with a timeout error when the callable ignores the signal and never settles', async () => {
    await expect(
      withGeminiTimeout(() => new Promise(() => {}), { timeoutMs: 25 })
    ).rejects.toMatchObject({
      name: 'AbortError',
      message: expect.stringMatching(/timed out|timeout/i),
    });
  });

  test('signals to a signal-aware callable so it can abort its own request', async () => {
    let signal;
    await expect(
      withGeminiTimeout((s) => {
        signal = s;
        return new Promise((resolve, reject) => {
          s.addEventListener('abort', () => reject(new Error('underlying request aborted')));
        });
      }, { timeoutMs: 25 })
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(signal.aborted).toBe(true);
  });

  test('cancels the timer after a fast success (no stray rejection)', async () => {
    await withGeminiTimeout(() => Promise.resolve('ok'), { timeoutMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  test('rejects fast when the timeout elapses even if the callable would hang', async () => {
    const startedAt = Date.now();
    await expect(
      withGeminiTimeout(() => new Promise(() => {}), { timeoutMs: 30 })
    ).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });

  test('disables the timer when timeoutMs is 0 or negative', async () => {
    await expect(withGeminiTimeout(() => Promise.resolve('no-timeout'), { timeoutMs: 0 })).resolves.toBe('no-timeout');
    await expect(withGeminiTimeout(() => Promise.resolve('no-timeout'), { timeoutMs: -1 })).resolves.toBe('no-timeout');
  });
});