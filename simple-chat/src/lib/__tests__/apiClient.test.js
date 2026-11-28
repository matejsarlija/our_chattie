const envMock = vi.hoisted(() => ({ apiUrl: '/api' }));

vi.mock('../env', () => ({
  env: envMock,
}));

import {
  apiFetch,
  ApiClientError,
  resolveApiUrl,
  getSettings,
  updateSettings,
  getRunFacts,
  searchRunChunks,
  getRunChunk,
  listRunTraces,
  getRunTrace,
  cancelAnalysisRun,
  retryAnalysisReport,
  getChangeDetectionHistory,
  runChangeDetectionCheck,
} from '../apiClient';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.apiUrl = '/api';
  });

  test('includes retry-after header in thrown ApiClientError', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: {
        get: vi.fn((name) => (name === 'retry-after' ? '5' : null)),
      },
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'Too many requests' })),
    });

    await expect(apiFetch('/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      retryAfter: '5',
      message: 'Too many requests',
    });
  });

  test('uses fallback error message for non-json responses', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      headers: {
        get: vi.fn(() => null),
      },
      text: vi.fn().mockResolvedValue('upstream exploded'),
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => null) },
      text: vi.fn().mockResolvedValue(JSON.stringify({ settings: { defaultScanDepth: 'full' } })),
    });

    const data = await getSettings();
    expect(data).toEqual({ settings: { defaultScanDepth: 'full' } });
    expect(global.fetch).toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'GET' }));
  });

  test('updateSettings PUTs a preference patch to the settings endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => null) },
      text: vi.fn().mockResolvedValue(JSON.stringify({ settings: { defaultScanDepth: 'standard' } })),
    });

    const data = await updateSettings({ defaultScanDepth: 'standard' });
    expect(data).toEqual({ settings: { defaultScanDepth: 'standard' } });

    const [, options] = global.fetch.mock.calls[0];
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ defaultScanDepth: 'standard' });
  });
});

describe('Section 4.10 run & change-detection helpers', () => {
  const mockOk = (payload = {}) => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn(() => null) },
      text: vi.fn().mockResolvedValue(JSON.stringify(payload)),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    envMock.apiUrl = '/api';
  });

  test('getRunFacts encodes query parameters and omits undefined values', async () => {
    mockOk({ facts: [], total: 0 });
    await getRunFacts('run/1', { kind: 'amount', partyId: 'p 1', grounded: false, limit: 25, offset: 0 });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/analysis/runs/run%2F1/facts?kind=amount&partyId=p+1&grounded=false&limit=25&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('searchRunChunks & getRunChunk hit expected endpoints', async () => {
    mockOk({ chunks: [], total: 0 });
    await searchRunChunks('r1', { q: 'stečaj', limit: 20, offset: 0 });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/analysis/runs/r1/chunks?q=ste%C4%8Daj&limit=20&offset=0',
      expect.objectContaining({ method: 'GET' }),
    );

    mockOk({ id: 'c1', text: 'izvadak' });
    await getRunChunk('r1', 'chunk/1');
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/analysis/runs/r1/chunks/chunk%2F1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('listRunTraces & getRunTrace hit expected endpoints', async () => {
    mockOk({ traces: [], total: 0 });
    await listRunTraces('r1', { limit: 10, offset: 5 });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/analysis/runs/r1/traces?limit=10&offset=5',
      expect.objectContaining({ method: 'GET' }),
    );

    mockOk({ id: 't1' });
    await getRunTrace('r1', 't1');
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/analysis/runs/r1/traces/t1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('cancelAnalysisRun & retryAnalysisReport send POST requests', async () => {
    mockOk({ analysisId: 'r1', status: 'canceled' });
    await cancelAnalysisRun('r1');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/analysis/runs/r1/cancel',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );

    mockOk({ ok: true });
    await retryAnalysisReport('r1');
    expect(global.fetch).toHaveBeenLastCalledWith(
      '/api/analysis/runs/r1/report',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  test('getChangeDetectionHistory & runChangeDetectionCheck encode queryValue and body', async () => {
    mockOk({ checks: [] });
    await getChangeDetectionHistory('St-2/2013');
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/change-detection/history?queryValue=St-2%2F2013',
      expect.objectContaining({ method: 'GET' }),
    );

    mockOk({ ok: true });
    await runChangeDetectionCheck({ type: 'oib', value: '66124057408' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('/api/change-detection/check');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ query: { type: 'oib', value: '66124057408' } });
  });

  test('propagates ApiClientError on upstream failures', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      headers: { get: vi.fn(() => null) },
      text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'Analysis run is not active.' })),
    });

    await expect(cancelAnalysisRun('r1')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'Analysis run is not active.',
    });
  });
});
