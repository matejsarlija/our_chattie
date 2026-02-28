const { deriveEntryDisplayId } = require('../court-analysis/utils/entryDisplayId');

describe('deriveEntryDisplayId', () => {
  test('extracts last path segment from absolute URL', () => {
    expect(deriveEntryDisplayId('https://e-oglasna.pravosudje.hr/objave/128734')).toBe('128734');
  });

  test('handles trailing slash and query string', () => {
    expect(deriveEntryDisplayId('https://e-oglasna.pravosudje.hr/objave/128734/?foo=bar')).toBe('128734');
  });

  test('handles relative-like path fallback', () => {
    expect(deriveEntryDisplayId('/objave/ABC-42')).toBe('ABC-42');
  });

  test('returns null for missing or malformed links', () => {
    expect(deriveEntryDisplayId('')).toBeNull();
    expect(deriveEntryDisplayId(null)).toBeNull();
    expect(deriveEntryDisplayId('///')).toBeNull();
  });
});
