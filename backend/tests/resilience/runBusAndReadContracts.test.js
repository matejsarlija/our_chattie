'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createSqliteStore } = require('../../services/sqliteStore');
const { createRunBus } = require('../../http/runBus');
const { createRunAbortRegistry } = require('../../http/runAbortRegistry');
const { createAnalysisRunsRouter } = require('../../routes/analysisRuns');
const { buildCourtAnalysisPayload } = require('../../http/courtAnalysisPayload');

describe('Resilience: RunBus SSE Replay, <500KB Artifact Gate, Read APIs & Cancel', () => {
    let tmpDir;
    let store;
    let runBus;
    let registry;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runbus-contract-'));
        store = createSqliteStore({ dbPath: path.join(tmpDir, 'runs.db') });
        runBus = createRunBus({ analysisStore: store });
        registry = createRunAbortRegistry();
    });

    afterEach(async () => {
        await new Promise((r) => setTimeout(r, 30));
        runBus?.close?.();
        store?.close?.();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('serves paginated /facts, FTS5 /chunks, /traces, ?afterSeq=100 SSE replay (<2KB frames), and POST /cancel', async () => {
        const run = await store.createAnalysisRun({
            id: 'run-contract-1',
            queryType: 'oib',
            queryValue: '66124057408',
            scanDepth: 'balanced',
        });
        store.insertRunFacts({ runId: run.id, facts: [{ id: `${run.id}:f1`, kind: 'amount', description: 'Tražbina', value: 500, currency: 'EUR' }] });
        store.insertRunChunks({ runId: run.id, chunks: [{ id: 'c1', docId: 'd1', fileName: 'Podnesak.pdf', text: 'Iznos 98 EUR u prilogu', startIndex: 0, endIndex: 22 }] });
        store.insertLlmTrace({ runId: run.id, taskType: 'ExtractTableChunk', promptHash: 'v5', requestedModel: 'z-ai/glm-5.3-flash', actualModel: 'z-ai/glm-5.3-flash', latencyMs: 120 });

        for (let seq = 1; seq <= 120; seq += 1) {
            await runBus.publish({
                runId: run.id,
                eventType: 'stage.progress',
                metadata: { stage: 'extract', done: seq, total: 120 },
            });
        }
        const replayed = await store.getAnalysisEventsAfterSeq({ analysisId: run.id, afterSeq: 100 });
        expect(replayed).toHaveLength(20);
        for (const ev of replayed) {
            expect(Buffer.byteLength(JSON.stringify(ev), 'utf8')).toBeLessThan(2048);
        }

        const app = express();
        app.use(express.json());
        const pass = (_req, _res, next) => next();
        app.use('/api/analysis', createAnalysisRunsRouter({
            analysisStore: store,
            readLimiter: pass,
            writeLimiter: pass,
            runAbortRegistry: registry,
            runBus,
        }));

        const factsRes = await request(app).get(`/api/analysis/runs/${run.id}/facts?kind=amount`);
        expect(factsRes.status).toBe(200);
        expect(factsRes.body.facts).toHaveLength(1);

        const chunksRes = await request(app).get(`/api/analysis/runs/${run.id}/chunks?q=98`);
        expect(chunksRes.status).toBe(200);
        expect(chunksRes.body.chunks).toHaveLength(1);

        const tracesRes = await request(app).get(`/api/analysis/runs/${run.id}/traces`);
        expect(tracesRes.status).toBe(200);
        expect(tracesRes.body.traces).toHaveLength(1);

        registry.register(run.id);
        const cancelRes = await request(app).post(`/api/analysis/runs/${run.id}/cancel`).send({});
        expect([200, 202]).toContain(cancelRes.status);
        expect(cancelRes.body.status).toBe('canceled');
    });

    test('keeps 100-entry / 4,600-flow / 382-conflict run_artifacts.result_json strictly < 500 KB (512,000 bytes)', () => {
        const payload = buildCourtAnalysisPayload({
            processedCases: [{
                caseResult: { title: 'Kerum d.o.o.', caseNumber: 'ST-2/2013', court: 'Split', date: '2025-02-10' },
                files: [],
                analysis: {
                    individualAnalyses: Array.from({ length: 163 }, (_, i) => ({
                        text: `Podnesak-${i}.pdf`,
                        docId: `doc-${i}`,
                        aiResult: { huge: 'x'.repeat(2000) },
                    })),
                },
            }],
            clusterEvidencePackage: {
                caseNumber: 'ST-2/2013',
                analyses: Array.from({ length: 163 }, (_, i) => ({ id: `doc-${i}`, docId: `doc-${i}`, fileName: `Podnesak-${i}.pdf`, summary: 'Sažetak '.repeat(40) })),
                flows: {
                    count: 4600,
                    entries: Array.from({ length: 4600 }, (_, i) => ({ id: `flow-${i}`, description: `Tražbina ${i}`, value: i + 1, currency: 'EUR' })),
                },
                reconciliation: {
                    conflicts: Array.from({ length: 382 }, (_, i) => ({ finding: `Razlika ${i}`, reason: 'Odstupanje', sources: ['a.pdf', 'b.pdf'] })),
                },
            },
            report: {
                narrative: 'Sažetak',
                findings: Array.from({ length: 12 }, (_, i) => ({ id: `f-${i}`, text: `Nalaz ${i}`, citations: [] })),
                meta: {
                    retrieval: {
                        queries: Array.from({ length: 20 }, (_, i) => ({ id: `q-${i}`, text: 'x'.repeat(5000) })),
                        results: [],
                    },
                },
            },
        });
        const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        expect(bytes).toBeLessThan(512000);
    });
});
