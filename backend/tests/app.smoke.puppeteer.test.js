const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

jest.setTimeout(60000);

const describeIfSmoke = process.env.RUN_PUPPETEER_SMOKE === '1' ? describe : describe.skip;

const FRONTEND_URL = process.env.SMOKE_FRONTEND_URL || 'http://127.0.0.1:5173';
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
});
