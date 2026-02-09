const { buildSseData } = require('../helpers/sse');

describe('buildSseData', () => {
  test('wraps payload as SSE data line', () => {
    const result = buildSseData({ content: 'Hello' });
    expect(result).toBe('data: {"content":"Hello"}\n\n');
  });

  test('supports done event payloads', () => {
    const result = buildSseData({ done: true, mode: 'preview' });
    expect(result).toBe('data: {"done":true,"mode":"preview"}\n\n');
  });

  test('supports error payloads', () => {
    const result = buildSseData({ error: 'Streaming failed' });
    expect(result).toBe('data: {"error":"Streaming failed"}\n\n');
  });
});
