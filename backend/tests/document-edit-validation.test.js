const { validateDocumentEditPayload } = require('../helpers/documentEditValidation');

describe('validateDocumentEditPayload', () => {
  test('rejects missing payload', () => {
    const result = validateDocumentEditPayload();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Invalid request payload.');
  });

  test('rejects empty content', () => {
    const result = validateDocumentEditPayload({ content: '', instruction: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Content is required.');
  });

  test('rejects empty instruction', () => {
    const result = validateDocumentEditPayload({ content: 'Test', instruction: '' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Instruction is required.');
  });

  test('rejects oversized content', () => {
    const result = validateDocumentEditPayload({
      content: 'a'.repeat(20001),
      instruction: 'Test',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Content is too long');
  });

  test('rejects oversized instruction', () => {
    const result = validateDocumentEditPayload({
      content: 'Test',
      instruction: 'a'.repeat(1001),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Instruction is too long');
  });

  test('rejects invalid selectionRange', () => {
    const result = validateDocumentEditPayload({
      content: 'Test',
      instruction: 'Test',
      selectionRange: { from: 10, to: 5 },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('selectionRange');
  });

  test('accepts valid payload', () => {
    const result = validateDocumentEditPayload({
      content: 'Test content',
      instruction: 'Make formal',
      selectionRange: { from: 0, to: 4 },
    });
    expect(result.ok).toBe(true);
  });
});

