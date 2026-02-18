import { SseEventParser } from '../sseEventParser';

describe('SseEventParser', () => {
  test('parses named SSE event payloads', () => {
    const parser = new SseEventParser();
    const messages = parser.parseChunk('event: snapshot\ndata: {"run":{"id":"r1"}}\n\n');

    expect(messages).toEqual([
      { event: 'snapshot', data: { run: { id: 'r1' } } },
    ]);
  });

  test('parses chunked frames across reads', () => {
    const parser = new SseEventParser();
    const first = parser.parseChunk('event: event.created\ndata: {"event":{"id":"e1"');
    const second = parser.parseChunk('}}\n\n');

    expect(first).toEqual([]);
    expect(second).toEqual([
      { event: 'event.created', data: { event: { id: 'e1' } } },
    ]);
  });

  test('returns raw payload when JSON parsing fails', () => {
    const parser = new SseEventParser();
    const messages = parser.parseChunk('event: heartbeat\ndata: not-json\n\n');

    expect(messages).toEqual([
      { event: 'heartbeat', data: { raw: 'not-json' } },
    ]);
  });
});
