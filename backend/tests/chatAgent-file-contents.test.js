const { buildGeminiContents } = require('../chatAgent');

describe('buildGeminiContents', () => {
  test('adds system instruction to first user parts and attaches file to last user message', () => {
    const messages = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Second question' },
    ];

    const fileInfo = {
      fileUri: 'https://example.com/file/abc',
      mimeType: 'application/pdf',
    };

    const systemText = 'SYSTEM';

    const contents = buildGeminiContents(messages, fileInfo, systemText);

    expect(contents).toHaveLength(3);
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].text).toBe(systemText);
    expect(contents[0].parts.map((p) => p.text).join('')).toContain('First question');

    const lastUser = contents[2];
    expect(lastUser.role).toBe('user');
    expect(lastUser.parts.some((p) => p.fileData)).toBe(true);
    const filePart = lastUser.parts.find((p) => p.fileData);
    expect(filePart.fileData.fileUri).toBe(fileInfo.fileUri);
  });

  test('merges consecutive same-role messages into one content item', () => {
    const messages = [
      { role: 'user', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'assistant', content: 'C' },
      { role: 'assistant', content: 'D' },
    ];

    const contents = buildGeminiContents(messages, null, 'SYSTEM');

    expect(contents).toHaveLength(2);
    expect(contents[0].role).toBe('user');
    const userText = contents[0].parts.map((p) => p.text).join(' ');
    expect(userText).toContain('A');
    expect(userText).toContain('B');
    expect(contents[1].role).toBe('model');
  });
});
