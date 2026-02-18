import {
  first,
  readBool,
  requireEnv,
} from '../envUtils';

describe('envUtils', () => {
  test('first returns first non-empty value', () => {
    expect(first(undefined, '', 'ok', 'later')).toBe('ok');
    expect(first(undefined, '')).toBe('');
  });

  test('readBool parses truthy values and falls back correctly', () => {
    expect(readBool('true')).toBe(true);
    expect(readBool('YES')).toBe(true);
    expect(readBool('0')).toBe(false);
    expect(readBool('', true)).toBe(true);
  });

  test('requireEnv enforces required values', () => {
    expect(() => requireEnv('', 'API_KEY')).toThrow('Missing required environment variable: API_KEY');
    expect(requireEnv('value', 'API_KEY')).toBe('value');
  });
});
