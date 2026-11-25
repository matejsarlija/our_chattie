const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { createSqliteStore } = require('../services/sqliteStore');

function makeApp(store) {
  const app = express();
  app.use(express.json());

  app.get('/api/settings', (req, res) => {
    res.json({ settings: store.getSettings() });
  });

  app.put('/api/settings', async (req, res) => {
    try {
      const settings = await store.updateSettings(req.body);
      res.json({ settings });
    } catch (error) {
      res.status(error.statusCode === 400 ? 400 : 500).json({ error: error.message });
    }
  });

  return app;
}

describe('lawyer settings store + API', () => {
  let dataDir;
  let store;
  let app;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-settings-'));
    store = createSqliteStore({ dataDir });
    app = makeApp(store);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('defaults to no persisted preferences', () => {
    expect(store.getSettings()).toEqual({});
  });

  test('persists default scan depth and UI preferences', async () => {
    await store.updateSettings({ defaultScanDepth: 'full', uiPreferences: { compact: true } });
    expect(store.getSettings()).toEqual({
      defaultScanDepth: 'full',
      uiPreferences: { compact: true },
    });
  });

  test('rejects an unsupported default scan depth', async () => {
    await expect(store.updateSettings({ defaultScanDepth: 'unbounded' }))
      .rejects.toThrow('Invalid defaultScanDepth');
  });

  test('GET returns current preferences', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({});
  });

  test('PUT updates and persists a supported scan-depth preference', async () => {
    const res = await request(app).put('/api/settings').send({ defaultScanDepth: 'balanced' });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ defaultScanDepth: 'balanced' });
    expect(store.getSettings()).toEqual({ defaultScanDepth: 'balanced' });
  });
  test('PUT rejects retired standard scan depth with 400', async () => {
    const res = await request(app).put('/api/settings').send({ defaultScanDepth: 'standard' });
    expect(res.status).toBe(400);
  });


  test('PUT rejects an invalid scan depth with 400', async () => {
    const res = await request(app).put('/api/settings').send({ defaultScanDepth: 'gold' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid defaultScanDepth');
  });
});
