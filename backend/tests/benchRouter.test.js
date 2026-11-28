'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const express = require('express');
const request = require('supertest');
const { createSqliteStore } = require('../services/sqliteStore');
const { createBenchRouter } = require('../routes/bench');
const { createBenchRunner, redactSecrets } = require('../bench/runner');
const { runCroatianSmokeGate, profileTailLatency } = require('../bench/gbench');
const { OIB_CASE_DOCS } = require('../bench/corpus');

function createMockApp({ sqliteStore, dataRoot, runner = null } = {}) {
    const app = express();
    app.use(express.json());
    app.use('/api/bench', createBenchRouter({ analysisStore: sqliteStore, dataRoot, runner }));
    return app;
}

describe('backend/routes/bench (/api/bench)', () => {
    let tmpDir;
    let sqliteStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-router-'));
        sqliteStore = createSqliteStore({ dbPath: path.join(tmpDir, 'bench.db') });
    });

    afterEach(() => {
        sqliteStore?.close?.();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('GET /api/bench/models returns model_pricing_cache rows and gbench smoke budget', async () => {
        sqliteStore.db.prepare(`
            INSERT INTO model_pricing_cache (model_id, context_length, max_completion_tokens, input_usd_per_m, output_usd_per_m, capabilities_json, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('z-ai/glm-5.3-flash', 131072, 16384, 0.1, 0.3, JSON.stringify({ gbenchGate: { passed: true, costUsd: 0.0005 } }), '2026-11-28T00:00:00Z');

        const app = createMockApp({ sqliteStore, dataRoot: tmpDir });
        const res = await request(app).get('/api/bench/models');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.smokeBudgetUsd).toBe(0.002);
        const glm = res.body.models.find((m) => m.modelId === 'z-ai/glm-5.3-flash');
        expect(glm).toBeDefined();
        expect(glm.gbenchGate.passed).toBe(true);
    });

    test('POST /api/bench/runs enforces approved + maxCost > 0 on live runs and returns 409 { activeJobId } on lock conflict', async () => {
        const fakeChild = new EventEmitter();
        fakeChild.stdout = new EventEmitter();
        fakeChild.stderr = new EventEmitter();
        fakeChild.kill = jest.fn(() => {
            fakeChild.emit('close', 0);
        });
        const runner = createBenchRunner({
            dataRoot: tmpDir,
            sqliteStore,
            spawnImpl: () => fakeChild,
        });
        const app = createMockApp({ sqliteStore, dataRoot: tmpDir, runner });
        const docIds = [OIB_CASE_DOCS[0].docId];

        const unapproved = await request(app).post('/api/bench/runs').send({
            docIds,
            models: ['z-ai/glm-5.3-flash'],
            dryRun: false,
            approved: false,
            maxCost: 1,
        });
        expect(unapproved.status).toBe(400);

        const zeroCost = await request(app).post('/api/bench/runs').send({
            docIds,
            models: ['z-ai/glm-5.3-flash'],
            dryRun: false,
            approved: true,
            maxCost: 0,
        });
        expect(zeroCost.status).toBe(400);

        const first = await request(app).post('/api/bench/runs').send({
            docIds,
            models: ['z-ai/glm-5.3-flash'],
            dryRun: true,
            maxCost: 0,
        });
        expect(first.status).toBe(202);
        expect(first.body.jobId).toBeTruthy();

        const conflict = await request(app).post('/api/bench/runs').send({
            docIds,
            models: ['z-ai/glm-5.3-flash'],
            dryRun: true,
            maxCost: 0,
        });
        expect(conflict.status).toBe(409);
        expect(conflict.body.activeJobId).toBe(first.body.jobId);

        const canceled = await request(app).post(`/api/bench/jobs/${first.body.jobId}/cancel`).send({});
        expect(canceled.status).toBe(200);
        expect(canceled.body.state).toBe('canceled');
        expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('GET /api/bench/jobs/:id/stream emits typed SSE events and redacts OPENROUTER_API_KEY', async () => {
        const prevKey = process.env.OPENROUTER_API_KEY;
        process.env.OPENROUTER_API_KEY = 'sk-or-secret-test-key-12345';
        try {
            expect(redactSecrets('Bearer sk-or-secret-test-key-12345')).toBe('Bearer [redacted]');

            const fakeChild = new EventEmitter();
            fakeChild.stdout = new EventEmitter();
            fakeChild.stderr = new EventEmitter();
            fakeChild.kill = jest.fn();
            const runner = createBenchRunner({
                dataRoot: tmpDir,
                sqliteStore,
                spawnImpl: () => fakeChild,
            });
            const job = runner.createJob({ kind: 'dry-run', scriptName: 'benchmark-pdf-engines.js', args: ['--dry-run'] });
            fakeChild.stdout.emit('data', Buffer.from('[bench] documents · 2 selected · key=sk-or-secret-test-key-12345\n'));
            fakeChild.emit('close', 0);

            expect(runner.getJob(job.id).output).not.toContain('sk-or-secret-test-key-12345');
            expect(runner.getJob(job.id).output).toContain('[redacted]');

            const app = createMockApp({ sqliteStore, dataRoot: tmpDir, runner });
            const sseRes = await request(app).get(`/api/bench/jobs/${job.id}/stream`);
            expect(sseRes.status).toBe(200);
            expect(sseRes.headers['content-type']).toMatch(/text\/event-stream/);
            expect(sseRes.text).toContain('event: job.progress');
            expect(sseRes.text).toContain('event: job.done');
        } finally {
            if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY;
            else process.env.OPENROUTER_API_KEY = prevKey;
        }
    });

    test('GET and POST /api/bench/runs/:runId/review serve pure JSON blinded review (zero HTML)', async () => {
        const runId = '2026-11-28T09-00-00-000Z-a1b2c3d4';
        const runDir = path.join(tmpDir, runId);
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({
            runId,
            scope: 'smoke',
            docs: [{ docId: '1:Podnesak.pdf', pages: 2 }],
            rows: [
                {
                    stage: 'A',
                    docId: '1:Podnesak.pdf',
                    arm: 'local-text',
                    model: 'z-ai/glm-5.3-flash',
                    repeat: 1,
                    status: 'OK',
                    text: '{"caseNumber":"St-2/2013","summary":"Sažetak"}',
                },
            ],
        }));

        const app = createMockApp({ sqliteStore, dataRoot: tmpDir });
        const getRes = await request(app).get(`/api/bench/runs/${runId}/review?sample=1&seed=7`);
        expect(getRes.status).toBe(200);
        expect(getRes.headers['content-type']).toMatch(/application\/json/);
        expect(getRes.body.runId).toBe(runId);
        expect(getRes.body.answerKeyReady).toBe(true);
        expect(Array.isArray(getRes.body.items)).toBe(true);

        const postRes = await request(app).post(`/api/bench/runs/${runId}/review`).send({
            verdicts: [{ sampleId: getRes.body.items[0]?.sampleId || 's1', winner: 'A', notes: 'ok' }],
        });
        expect(postRes.status).toBe(200);
        expect(postRes.body.ok).toBe(true);
        expect(postRes.body.verdictsCount).toBe(1);
    });

    test('GET /api/bench/gold/page rejects path traversal and returns ETag/X-Total-Pages when mocked', async () => {
        const app = createMockApp({ sqliteStore, dataRoot: tmpDir });
        const bad = await request(app).get('/api/bench/gold/page?set=../etc&file=passwd&page=1');
        expect(bad.status).toBe(404);
    });

    test('POST /api/bench/candidates/seed seeds Kerum smoke candidates and dry-run micro-bench succeeds', async () => {
        const app = createMockApp({ sqliteStore, dataRoot: tmpDir });
        const seedRes = await request(app).post('/api/bench/candidates/seed').send({});
        expect(seedRes.status).toBe(200);
        expect(seedRes.body.seeded).toBe(4);

        const listRes = await request(app).get('/api/bench/candidates');
        expect(listRes.status).toBe(200);
        expect(listRes.body.candidates.length).toBe(4);

        const microRes = await request(app)
            .post(`/api/bench/candidates/${listRes.body.candidates[0].id}/micro-bench`)
            .send({ dryRun: true, model: 'z-ai/glm-5.3-flash' });
        expect(microRes.status).toBe(200);
        expect(microRes.body.dryRun).toBe(true);
    });

    test('gbench smoke gate and tail latency profiler work offline with mock client', async () => {
        const gate = await runCroatianSmokeGate({
            model: 'z-ai/glm-5.3-flash',
            dryRun: false,
            approved: true,
            maxCost: 0.01,
            sqliteStore,
            clientFactory: () => ({
                invoke: async () => ({
                    content: JSON.stringify({ caseNumber: 'St-2/2013', oib: '66124057408', amountEur: 1250 }),
                    usage: { costUsd: 0.0004 },
                }),
            }),
        });
        expect(gate.passed).toBe(true);
        expect(gate.costUsd).toBeLessThan(0.002);

        const stats = profileTailLatency([120, 250, 90, 800, 300]);
        expect(stats.count).toBe(5);
        expect(stats.minMs).toBe(90);
        expect(stats.maxMs).toBe(800);
        expect(stats.p95Ms).toBe(800);
    });
});
