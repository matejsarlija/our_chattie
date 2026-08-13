const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

jest.setTimeout(60000);

const describeIfSmoke = process.env.RUN_PUPPETEER_SMOKE === '1' ? describe : describe.skip;

const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:3000';
const BACKEND_HEALTH_URL = process.env.SMOKE_BACKEND_HEALTH_URL || 'http://127.0.0.1:3001/health';
const ARTIFACT_DIR = process.env.SMOKE_ARTIFACT_DIR || path.join(process.cwd(), 'test-artifacts', 'puppeteer-smoke');

describeIfSmoke('Puppeteer smoke (live)', () => {
  let browser;
  let page;
  let consoleMessages = [];
  let pageErrors = [];
  let requestFailures = [];

  const sanitizeName = (name) => name.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase();

  const writeJson = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  };

  const captureFailureArtifacts = async (testName, error) => {
    const stem = sanitizeName(testName || 'unknown');
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const captureErrors = [];

    if (page) {
      try {
        if (!page.isClosed()) {
          await page.screenshot({
            path: path.join(ARTIFACT_DIR, `${stem}.png`),
            fullPage: true,
          });
        }
      } catch (captureError) {
        captureErrors.push(`screenshot: ${captureError.message}`);
      }

      try {
        if (!page.isClosed()) {
          const html = await page.content();
          fs.writeFileSync(path.join(ARTIFACT_DIR, `${stem}.html`), html, 'utf8');
        }
      } catch (captureError) {
        captureErrors.push(`html: ${captureError.message}`);
      }
    }

    writeJson(path.join(ARTIFACT_DIR, `${stem}.logs.json`), {
      consoleMessages,
      pageErrors,
      requestFailures,
      errorMessage: error?.message || String(error || 'unknown error'),
      artifactCaptureErrors: captureErrors,
      capturedAt: new Date().toISOString(),
      testName,
      frontendUrl: FRONTEND_URL,
      backendHealthUrl: BACKEND_HEALTH_URL,
    });
  };

  const runWithFailureArtifacts = async (testName, runner) => {
    try {
      await runner();
    } catch (error) {
      await captureFailureArtifacts(testName, error);
      throw error;
    }
  };

  beforeAll(async () => {
    fs.rmSync(ARTIFACT_DIR, { recursive: true, force: true });
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });

    page.on('console', (msg) => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
      });
    });
    page.on('pageerror', (err) => {
      pageErrors.push({
        message: err.message,
      });
    });
    page.on('requestfailed', (req) => {
      requestFailures.push({
        url: req.url(),
        method: req.method(),
        failureText: req.failure()?.errorText || 'unknown',
      });
    });
  });

  beforeEach(() => {
    consoleMessages = [];
    pageErrors = [];
    requestFailures = [];
  });

  afterAll(async () => {
    if (page) {
      await page.close();
    }
    if (browser) {
      await browser.close();
    }
  });

  test('backend health endpoint is reachable', async () => {
    await runWithFailureArtifacts('backend health endpoint is reachable', async () => {
      const response = await page.goto(BACKEND_HEALTH_URL, { waitUntil: 'networkidle2' });
      expect(response).toBeTruthy();
      expect(response.status()).toBe(200);

      const body = await page.evaluate(() => document.body.innerText || '');
      expect(body.toLowerCase()).toContain('ok');
    });
  });

  test('frontend app root loads without fatal crash', async () => {
    await runWithFailureArtifacts('frontend app root loads without fatal crash', async () => {
      const response = await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2' });
      expect(response).toBeTruthy();
      expect(response.status()).toBeLessThan(400);

      const hasRoot = await page.$('#root');
      expect(hasRoot).toBeTruthy();

      const body = await page.evaluate(() => document.body.innerText || '');
      expect(body).not.toMatch(/Cannot GET|Internal Server Error|Application error/i);
    });
  });

  test('analysis detail renders the report timeline annex with dates and citations', async () => {
    await runWithFailureArtifacts('analysis detail renders the report timeline annex with dates and citations', async () => {
      // Seed a run directly into the backend's data dir so the detail page has
      // a persisted result_json.report.timeline to render (backend reads files per request).
      const { createLocalStore } = require('../services/localStore');
      const store = createLocalStore();
      const run = await store.createAnalysisRun({
        oib: '12345678901',
        queryType: 'oib',
        queryValue: '12345678901',
        status: 'done',
      });
      await store.completeAnalysisRun({
        analysisId: run.id,
        resultText: '## Testni nalaz\n\n- točka',
        resultJson: {
          processedCases: [],
          report: {
            schemaVersion: '1.0.0',
            narrative: 'Sažetak predmeta.',
            findings: [],
            timeline: [
              {
                date: '10.02.2025.',
                description: 'Rješenje (ST-700/2024)',
                citations: [{ source: 'ST-700/2024:entry-1', text: 'Rješenje od 10.02.2025.' }],
              },
            ],
            conflicts: [],
            openQuestions: [],
            nextSteps: [],
            meta: { generatedAt: new Date().toISOString() },
          },
        },
      });

      try {
        const detailUrl = `${FRONTEND_URL}/dashboard/runs/${run.id}`;
        const response = await page.goto(detailUrl, { waitUntil: 'networkidle2' });
        expect(response).toBeTruthy();
        expect(response.status()).toBeLessThan(400);

        await page.waitForFunction(
          (expected) => document.body.innerText.includes(expected),
          { timeout: 15000 },
          'Vremenska crta'
        );

        const body = await page.evaluate(() => document.body.innerText || '');
        expect(body).toContain('Vremenska crta');
        expect(body).toContain('10.02.2025.');
        expect(body).toContain('Rješenje (ST-700/2024)');
        expect(body).toContain('ST-700/2024:entry-1');
        expect(pageErrors).toEqual([]);
      } finally {
        // Best-effort cleanup so the smoke lane does not leave seeded runs behind.
        const runsFile = path.join(store.dataDir, 'runs.json');
        try {
          const runs = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
          fs.writeFileSync(runsFile, JSON.stringify(runs.filter((item) => item.id !== run.id), null, 2), 'utf8');
        } catch (cleanupError) {
          console.warn('Smoke timeline test cleanup skipped:', cleanupError.message);
        }
      }
    });
  });
});
