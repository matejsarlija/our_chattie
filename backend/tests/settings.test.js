const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');
const { createLocalStore } = require('../services/localStore');

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

describe('settings store + API', () => {
  let dataDir;
  let store;
  let app;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-settings-'));
    store = createLocalStore({ dataDir });
    app = makeApp(store);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('defaults the reasoning switches', () => {
    expect(store.getSettings()).toEqual({ reasoningRerankMode: 'auto', reasoningPlanner: 'on', reasoningFollowUp: 'on' });
  });

  test('persists an updated reasoning switch', async () => {
    await store.updateSettings({ reasoningRerankMode: 'force' });
    expect(store.getSettings()).toEqual({ reasoningRerankMode: 'force', reasoningPlanner: 'on', reasoningFollowUp: 'on' });
  });

  test('rejects an invalid reasoning switch value', async () => {
    await expect(store.updateSettings({ reasoningRerankMode: 'premium' })).rejects.toThrow('Invalid reasoningRerankMode');
  });

  test('GET returns the current settings', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ reasoningRerankMode: 'auto', reasoningPlanner: 'on', reasoningFollowUp: 'on' });
  });

  test('PUT updates a reasoning switch and persists it', async () => {
    const res = await request(app).put('/api/settings').send({ reasoningPlanner: 'off' });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ reasoningRerankMode: 'auto', reasoningPlanner: 'off', reasoningFollowUp: 'on' });
    expect(store.getSettings()).toEqual({ reasoningRerankMode: 'auto', reasoningPlanner: 'off', reasoningFollowUp: 'on' });
  });

  test('PUT rejects an invalid reasoning switch with 400', async () => {
    const res = await request(app).put('/api/settings').send({ reasoningRerankMode: 'gold' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid reasoningRerankMode');
  });
});
