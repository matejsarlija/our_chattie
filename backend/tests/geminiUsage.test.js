const {
  createUsageTracker,
  extractUsageFromResponse,
  trackGeminiInvoke,
} = require('../helpers/geminiUsage');

describe('createUsageTracker', () => {
  test('accumulates input/output/total tokens across records', () => {
    const tracker = createUsageTracker();

    tracker.record({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    tracker.record({ inputTokens: 20, outputTokens: 3, totalTokens: 23 });

    expect(tracker.snapshot()).toEqual({
      inputTokens: 30,
      outputTokens: 8,
      totalTokens: 38,
      calls: 2,
    });
  });

  test('accepts snake_case usage_metadata fields', () => {
    const tracker = createUsageTracker();
    tracker.record({ input_tokens: 7, output_tokens: 4, total_tokens: 11 });

    expect(tracker.snapshot()).toEqual({
      inputTokens: 7,
      outputTokens: 4,
      totalTokens: 11,
      calls: 1,
    });
  });

  test('falls back to input+output when total is missing', () => {
    const tracker = createUsageTracker();
    tracker.record({ inputTokens: 6, outputTokens: 4 });

    expect(tracker.snapshot().totalTokens).toBe(10);
  });

  test('counts calls even when token fields are absent', () => {
    const tracker = createUsageTracker();
    tracker.record({});
    tracker.record(null);

    expect(tracker.snapshot()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 1,
    });
  });

  test('ignores non-numeric token values', () => {
    const tracker = createUsageTracker();
    tracker.record({ inputTokens: 'nope', outputTokens: -5, totalTokens: '12.7' });

    expect(tracker.snapshot()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 13,
      calls: 1,
    });
  });

  test('reset clears accumulated totals', () => {
    const tracker = createUsageTracker();
    tracker.record({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    tracker.reset();

    expect(tracker.snapshot()).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      calls: 0,
    });
  });
});

describe('extractUsageFromResponse', () => {
  test('reads usage_metadata from a LangChain AIMessage', () => {
    const response = {
      content: 'hello',
      usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };

    expect(extractUsageFromResponse(response)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
    });
  });

  test('returns null when usage_metadata is absent', () => {
    expect(extractUsageFromResponse({ content: 'hello' })).toBeNull();
    expect(extractUsageFromResponse(null)).toBeNull();
    expect(extractUsageFromResponse({})).toBeNull();
  });

  test('returns null when usage_metadata carries no token fields', () => {
    expect(extractUsageFromResponse({ usage_metadata: {} })).toBeNull();
  });
});

describe('trackGeminiInvoke', () => {
  test('records usage and fires onUsage with the cumulative snapshot', async () => {
    const tracker = createUsageTracker();
    const onUsage = jest.fn();
    const gemini = {
      invoke: jest.fn().mockResolvedValue({
        content: 'result',
        usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }),
    };

    const response = await trackGeminiInvoke(gemini, 'prompt', { signal: undefined, tracker, onUsage });

    expect(gemini.invoke).toHaveBeenCalledWith('prompt', {});
    expect(response.content).toBe('result');
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5, totalTokens: 15, calls: 1 });
    expect(tracker.snapshot().calls).toBe(1);
  });

  test('passes the signal through to invoke when provided', async () => {
    const signal = { aborted: false };
    const gemini = {
      invoke: jest.fn().mockResolvedValue({ content: 'x', usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
    };

    await trackGeminiInvoke(gemini, 'prompt', { signal, tracker: createUsageTracker() });

    expect(gemini.invoke).toHaveBeenCalledWith('prompt', { signal });
  });

  test('skips recording when response carries no usage_metadata', async () => {
    const tracker = createUsageTracker();
    const onUsage = jest.fn();
    const gemini = { invoke: jest.fn().mockResolvedValue({ content: 'x' }) };

    const response = await trackGeminiInvoke(gemini, 'prompt', { tracker, onUsage });

    expect(response.content).toBe('x');
    expect(onUsage).not.toHaveBeenCalled();
    expect(tracker.snapshot().calls).toBe(0);
  });
});
