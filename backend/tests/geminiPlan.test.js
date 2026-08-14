const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveGeminiPlan, DEFAULT_GEMINI_PLAN } = require('../helpers/geminiPlan');

describe('resolveGeminiPlan', () => {
  const originalDataDir = process.env.ANALYSIS_DATA_DIR;
  const originalPlan = process.env.GEMINI_PLAN;
  let dataDir;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-plan-'));
    process.env.ANALYSIS_DATA_DIR = dataDir;
    delete process.env.GEMINI_PLAN;
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.ANALYSIS_DATA_DIR;
    else process.env.ANALYSIS_DATA_DIR = originalDataDir;
    if (originalPlan === undefined) delete process.env.GEMINI_PLAN;
    else process.env.GEMINI_PLAN = originalPlan;
  });

  test('defaults to free when nothing is configured', () => {
    expect(resolveGeminiPlan()).toBe('free');
    expect(DEFAULT_GEMINI_PLAN).toBe('free');
  });

  test('reads a valid persisted value', () => {
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ geminiPlan: 'free' }));
    expect(resolveGeminiPlan()).toBe('free');
  });

  test('prefers the persisted setting over the env default', () => {
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ geminiPlan: 'paid' }));
    process.env.GEMINI_PLAN = 'free';
    expect(resolveGeminiPlan()).toBe('paid');
  });

  test('falls back to the env var when no persisted setting exists', () => {
    process.env.GEMINI_PLAN = 'paid';
    expect(resolveGeminiPlan()).toBe('paid');
  });

  test('ignores invalid persisted and env values, falling back to free', () => {
    fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify({ geminiPlan: 'premium' }));
    process.env.GEMINI_PLAN = 'nope';
    expect(resolveGeminiPlan()).toBe('free');
  });
});
