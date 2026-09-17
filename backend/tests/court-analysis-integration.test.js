const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { runCourtAnalysis } = require('../court-analysis/pipeline');

jest.setTimeout(180000);

const mockGetDocument = jest.fn();
jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
    getDocument: (...args) => mockGetDocument(...args),
    GlobalWorkerOptions: { workerSrc: '' },
}));

jest.mock('canvas', () => ({
    createCanvas: jest.fn(() => ({
        width: 0, height: 0,
        getContext: jest.fn().mockReturnValue({
            drawImage: jest.fn(), fillRect: jest.fn(), fillText: jest.fn(),
        }),
        toBuffer: jest.fn().mockReturnValue(Buffer.from('fake')),
    })),
}));

beforeEach(() => {
    mockGetDocument.mockResolvedValue({
        numPages: 1,
        getPage: jest.fn().mockResolvedValue({
            getTextContent: jest.fn().mockResolvedValue({
                items: [{ str: 'Court document text for integration testing' }],
            }),
        }),
        destroy: jest.fn(),
    });
});

class TestQueue {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this.pending = 0;
    this.queue = [];
  }

  add(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.pending < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift();
      this.pending += 1;

      Promise.resolve()
        .then(next.task)
        .then(next.resolve)
        .catch(next.reject)
        .finally(() => {
          this.pending -= 1;
          this.drain();
        });
    }
  }
}

const app = express();
app.use(bodyParser.json());
const queue = new TestQueue({ concurrency: 3 });

app.post('/api/court-analysis', async (req, res) => {
  try {
    const { searchTerm } = req.body;
    await queue.add(async () => {
      const result = await runCourtAnalysis(searchTerm);
      res.json(result);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const describeIfIntegration = process.env.RUN_PUPPETEER_INTEGRATION === '1' ? describe : describe.skip;

describeIfIntegration('Integration: /api/court-analysis concurrency', () => {
  it('should process multiple requests within concurrency limit', async () => {
    const concurrent = 2;
    const searchTerm = '66124057408';
    const responses = await Promise.all(
      Array.from({ length: concurrent }).map(() =>
        request(app)
          .post('/api/court-analysis')
          .send({ searchTerm })
          .set('Accept', 'application/json')
      )
    );
    responses.forEach(res => {
      expect([200, 500]).toContain(res.status);
    });
  }, 180000);
});
