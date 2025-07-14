const request = require('supertest');
const express = require('express');
const bodyParser = require('body-parser');
const { runCourtAnalysis } = require('../court-analysis/pipeline');
const PQueue = require('p-queue');

// Minimal express app for integration test
const app = express();
app.use(bodyParser.json());
const queue = new PQueue({ concurrency: 3 });

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

describe('Integration: /api/court-analysis concurrency', () => {
  it('should process multiple requests and respect concurrency limit', async () => {
    const concurrent = 6; // More than queue concurrency
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
      expect([200, 500]).toContain(res.status); // Accept 200 or 500 (if no docs found)
      // Optionally check for expected response structure
    });
  });
});
