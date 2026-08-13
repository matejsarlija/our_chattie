const { buildSseData, buildSseEvent } = require('../helpers/sse');

describe('buildSseData', () => {
  test('wraps payload as SSE data line', () => {
    const result = buildSseData({ content: 'Hello' });
    expect(result).toBe('data: {"content":"Hello"}\n\n');
  });

  test('supports progress payloads', () => {
    const result = buildSseData({ step: 'starting', progress: 5 });
    expect(result).toBe('data: {"step":"starting","progress":5}\n\n');
  });

  test('supports error payloads', () => {
    const result = buildSseData({ error: 'Streaming failed' });
    expect(result).toBe('data: {"error":"Streaming failed"}\n\n');
  });

  test('supports named SSE events', () => {
    const result = buildSseEvent('snapshot', { run: { id: 'r1' } });
    expect(result).toBe('event: snapshot\ndata: {"run":{"id":"r1"}}\n\n');
  });
});
