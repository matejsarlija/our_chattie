const envMock = { apiUrl: '/api/chat' };

jest.mock('../env', () => ({
  env: envMock,
}));

import { apiFetch, ApiClientError, resolveApiUrl } from '../apiClient';

describe('apiFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envMock.apiUrl = '/api/chat';
  });

  test('includes retry-after header in thrown ApiClientError', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: jest.fn((name) => (name === 'retry-after' ? '5' : null)),
      },
      text: jest.fn().mockResolvedValue(JSON.stringify({ error: 'Too many requests' })),
    });

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      retryAfter: '5',
      message: 'Too many requests',
    });
  });

  test('uses fallback error message for non-json responses', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: {
        get: jest.fn(() => null),
      },
      text: jest.fn().mockResolvedValue('upstream exploded'),
    });

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'Request failed with status 500',
      data: { raw: 'upstream exploded' },
    });
  });

  test('exports ApiClientError alias', () => {
    expect(ApiClientError).toBeDefined();
    expect(typeof ApiClientError).toBe('function');
  });

  test('resolves /api paths to configured backend origin', () => {
    envMock.apiUrl = 'https://pravni-asistent-api.onrender.com/api/chat';
    expect(resolveApiUrl('/api/analysis/runs?limit=10&offset=0')).toBe(
      'https://pravni-asistent-api.onrender.com/api/analysis/runs?limit=10&offset=0',
    );
  });

  test('keeps absolute URLs unchanged', () => {
    envMock.apiUrl = 'https://pravni-asistent-api.onrender.com/api/chat';
    expect(resolveApiUrl('https://alimentacija.info/api/analysis/runs')).toBe(
      'https://alimentacija.info/api/analysis/runs',
    );
  });
});
