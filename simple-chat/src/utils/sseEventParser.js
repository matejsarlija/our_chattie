export class SseEventParser {
  constructor() {
    this.buffer = '';
  }

  parseChunk(chunk) {
    if (!chunk) return [];

    this.buffer += chunk;
    const messages = [];
    let boundary = this.buffer.indexOf('\n\n');

    while (boundary >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const parsed = this.parseFrame(frame);
      if (parsed) {
        messages.push(parsed);
      }
      boundary = this.buffer.indexOf('\n\n');
    }

    return messages;
  }

  flush() {
    const frame = this.buffer.trim();
    this.buffer = '';
    if (!frame) return null;
    return this.parseFrame(frame);
  }

  parseFrame(frame) {
    if (!frame || !frame.trim()) return null;

    const lines = frame.split(/\r?\n/);
    let event = 'message';
    const dataLines = [];

    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
        continue;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
      }
    }

    if (dataLines.length === 0) {
      return null;
    }

    const payloadText = dataLines.join('\n');
    try {
      return { event, data: JSON.parse(payloadText) };
    } catch {
      return { event, data: { raw: payloadText } };
    }
  }
}
