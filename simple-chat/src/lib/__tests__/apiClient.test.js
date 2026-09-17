const envMock = { apiUrl: '/api' };

jest.mock('../env', () => ({
  env: envMock,
}));

import { apiFetch, ApiClientError, resolveApiUrl, getSettings, updateSettings } from '../apiClient';

describe('apiFetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    envMock.apiUrl = '/api';
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
    envMock.apiUrl = 'https://pravni-asistent-api.onrender.com/api';
    expect(resolveApiUrl('/api/analysis/runs?limit=10&offset=0')).toBe(
      'https://pravni-asistent-api.onrender.com/api/analysis/runs?limit=10&offset=0',
    );
  });

  test('keeps absolute URLs unchanged', () => {
    envMock.apiUrl = 'https://pravni-asistent-api.onrender.com/api';
    expect(resolveApiUrl('https://alimentacija.info/api/analysis/runs')).toBe(
      'https://alimentacija.info/api/analysis/runs',
    );
  });

  test('getSettings fetches the settings endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn(() => null) },
      text: jest.fn().mockResolvedValue(JSON.stringify({ settings: { reasoningRerankMode: 'force' } })),
    });

    const data = await getSettings();
    expect(data).toEqual({ settings: { reasoningRerankMode: 'force' } });
    expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'GET' }));
  });

  test('updateSettings PUTs the patch to the settings endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: jest.fn(() => null) },
      text: jest.fn().mockResolvedValue(JSON.stringify({ settings: { reasoningPlanner: 'off' } })),
    });

    const data = await updateSettings({ reasoningPlanner: 'off' });
    expect(data).toEqual({ settings: { reasoningPlanner: 'off' } });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ reasoningPlanner: 'off' });
  });
});
