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

  test('defaults to the free plan', () => {
    expect(store.getSettings()).toEqual({ geminiPlan: 'free' });
  });

  test('persists an updated plan', async () => {
    await store.updateSettings({ geminiPlan: 'paid' });
    expect(store.getSettings()).toEqual({ geminiPlan: 'paid' });
  });

  test('rejects an invalid plan value', async () => {
    await expect(store.updateSettings({ geminiPlan: 'premium' })).rejects.toThrow('Invalid geminiPlan');
  });

  test('GET returns the current settings', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ geminiPlan: 'free' });
  });

  test('PUT updates the plan and persists it', async () => {
    const res = await request(app).put('/api/settings').send({ geminiPlan: 'paid' });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ geminiPlan: 'paid' });
    expect(store.getSettings()).toEqual({ geminiPlan: 'paid' });
  });

  test('PUT rejects an invalid plan with 400', async () => {
    const res = await request(app).put('/api/settings').send({ geminiPlan: 'gold' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid geminiPlan');
  });
});
