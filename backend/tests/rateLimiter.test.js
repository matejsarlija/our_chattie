const request = require('supertest');
const express = require('express');
const rateLimiter = require('../court-analysis/utils/rateLimiter');

// Dummy handler for testing
const app = express();
app.use('/api/court-analysis', rateLimiter, (req, res) => res.json({ ok: true }));

describe('Rate Limiter Middleware', () => {
    it('allows requests under the limit', async () => {
        for (let i = 0; i < 5; i++) {
            const res = await request(app).get('/api/court-analysis');
            expect(res.status).toBe(200);
        }
    });

    it('blocks requests over the 5/5s limit', async () => {
        // 5 allowed, 6th should be blocked
        for (let i = 0; i < 5; i++) {
            await request(app).get('/api/court-analysis');
        }
        const res = await request(app).get('/api/court-analysis');
        expect(res.status).toBe(429);
        expect(res.headers['x-rate-limit-retry-after-milliseconds']).toBeDefined();
    });

    it('blocks requests over the 1000/hour limit', async () => {
        // Simulate bucket state
        const ip = '::ffff:127.0.0.1';
        const bucket = require('../court-analysis/utils/rateLimiter').__getBucket?.(ip) || null;
        if (bucket) bucket.hourTokens = 0;
        const res = await request(app).get('/api/court-analysis');
        expect(res.status).toBe(429);
    });
});
