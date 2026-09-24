// backend/tests/analysisLabGuards.test.js
//
// LQ-2 — API-level guards: operator error codes, bounded full responses,
// summary-sized lists, secret-free persistence, inspectable partials.
//
// Mounts the Lab router directly (LE-3 convention). Offline throughout.

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');

const { createAnalysisLabRouter } = require('../court-analysis/reasoning/analysisLab/api');
const { createAnalysisLabStore } = require('../services/analysisLabStore');
const { createLocalStore } = require('../services/localStore');
const { TRACE_BOUNDS } = require('../court-analysis/reasoning/analysisLab/traceBounds');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'replays', 'analysis-lab');

function makeApp({ runExperimentFn = null } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lab-guards-'));
    const labStore = createAnalysisLabStore({ dataDir });
    const analysisStore = createLocalStore({ dataDir });
    const router = createAnalysisLabRouter({
        labStore,
        analysisStore,
        fixturesDir: FIXTURES_DIR,
        ...(runExperimentFn ? { runExperimentFn } : {}),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/analysis-lab', router);
    return { app, labStore, analysisStore, dataDir };
}

function hugeTrace() {
    return {
        profileId: 'context-tree-summarized-v1',
        strategy: 'case-context',
        baseline: false,
        rootId: 'cn-root',
        selection: {
            selected: Array.from({ length: 250 }, (_, index) => ({
                nodeId: `cn-node-${index}`,
                kind: 'claim-thread',
                factIds: Array.from({ length: 60 }, (_, fact) => `fact-${index}-${fact}`),
            })),
            omitted: [],
        },
        summaries: { enabled: false, stats: {}, outcomes: [], omitted: [], droppedDerived: [] },
        claims: { flat: 9, branch: 250, derived: 0 },
    };
}

describe('analysis lab operator error codes (LQ-2)', () => {
    test('unknown refs, invalid bodies, and missing experiments carry codes', async () => {
        const { app } = makeApp();

        const unknownRef = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'no-such-package' });
        expect(unknownRef.status).toBe(400);
        expect(unknownRef.body.code).toBe('unknown-package-ref');

        const invalidBody = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab', modelRoles: { synthesis: 'x' } });
        expect(invalidBody.status).toBe(400);
        expect(invalidBody.body.code).toBe('invalid-lab-request');

        const missing = await request(app).get('/api/analysis-lab/experiments/missing');
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe('experiment-not-found');
    });
});

describe('analysis lab response bounds (LQ-2)', () => {
    test('full experiment bounds an oversized trace with a recorded reason', async () => {
        const runExperimentFn = jest.fn(async ({ store, evidencePackageRef, evidencePackageHash }) => {
            const created = await store.createExperiment({
                evidencePackageRef,
                evidencePackageHash: evidencePackageHash || 'abc',
                inputSummary: { caseNumber: 'St-2/2013', documents: 3 },
            });
            await store.completeExperimentVariant({
                experimentId: created.id,
                profileId: 'context-tree-summarized-v1',
                profileSnapshot: { id: 'context-tree-summarized-v1' },
                report: { findings: [{ text: 'ok', citations: [{ sourceId: 'lab-doc-01' }] }] },
                trace: hugeTrace(),
                usage: { calls: 5, totalTokens: 2000 },
                deterministicScorecard: { version: 1 },
            });
            for (const profileId of ['baseline-flat-v1', 'context-tree-v1']) {
                await store.failExperimentVariant({ experimentId: created.id, profileId });
            }
            await store.completeExperiment({ experimentId: created.id });
            return store.getExperiment({ id: created.id });
        });
        const { app } = makeApp({ runExperimentFn });

        const created = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab' });
        expect(created.status).toBe(201);

        const full = await request(app).get(`/api/analysis-lab/experiments/${created.body.experiment.id}`);
        expect(full.status).toBe(200);
        const trace = full.body.experiment.variants['context-tree-summarized-v1'].trace;
        expect(trace.selection.selected).toHaveLength(TRACE_BOUNDS.maxSelectedNodes);
        expect(trace.selection.selected[0].factIds).toHaveLength(TRACE_BOUNDS.maxIdsPerNode);
        expect(trace.responseBounds.truncated).toBe(true);
        expect(trace.responseBounds.reasons.length).toBeGreaterThan(0);
        // Reports are not truncated by response bounding.
        expect(full.body.experiment.variants['context-tree-summarized-v1'].report.findings).toHaveLength(1);
    });

    test('list responses stay summary-sized without reports or traces', async () => {
        const { app, labStore } = makeApp();
        const created = await labStore.createExperiment({
            evidencePackageRef: 'kerum-lab',
            evidencePackageHash: 'abc',
            inputSummary: { caseNumber: 'St-2/2013' },
        });
        await labStore.completeExperimentVariant({
            experimentId: created.id,
            profileId: 'baseline-flat-v1',
            report: { findings: Array.from({ length: 100 }, (_, i) => ({ text: `finding ${i}` })) },
            trace: hugeTrace(),
            usage: { calls: 1 },
        });
        await labStore.completeExperiment({ experimentId: created.id });

        const res = await request(app).get('/api/analysis-lab/experiments?limit=10&offset=0');
        expect(res.status).toBe(200);
        const summary = res.body.experiments[0];
        expect(summary).not.toHaveProperty('variants');
        expect(JSON.stringify(summary).length).toBeLessThan(5000);
    });
});

describe('analysis lab persistence hygiene (LQ-2)', () => {
    test('credential-like keys never reach disk, even nested', async () => {
        const { labStore, dataDir } = makeApp();
        const created = await labStore.createExperiment({
            evidencePackageRef: 'kerum-lab',
            evidencePackageHash: 'abc',
        });
        await labStore.completeExperimentVariant({
            experimentId: created.id,
            profileId: 'baseline-flat-v1',
            profileSnapshot: { id: 'baseline-flat-v1', nested: { GOOGLE_API_KEY: 'sk-live-123' } },
            report: { findings: [{ text: 'x', citations: [{ sourceId: 'lab-doc-01' }], secretNote: 'hunter2' }] },
            trace: { profileId: 'baseline-flat-v1', debug: { password: 's3cret', inputTokens: 10 } },
            usage: { calls: 1, inputTokens: 10, totalTokens: 10, apiKey: 'sk-live-456' },
            deterministicScorecard: null,
        });

        const raw = fs.readFileSync(path.join(dataDir, 'experiments.json'), 'utf8');
        expect(raw).not.toContain('sk-live-123');
        expect(raw).not.toContain('sk-live-456');
        expect(raw).not.toContain('hunter2');
        expect(raw).not.toContain('s3cret');
        // Usage telemetry survives redaction.
        const reloaded = await labStore.getExperiment({ id: created.id });
        expect(reloaded.variants['baseline-flat-v1'].usage).toMatchObject({
            calls: 1,
            inputTokens: 10,
            totalTokens: 10,
        });
        expect(reloaded.variants['baseline-flat-v1'].trace.debug).toEqual({ inputTokens: 10 });
    });

    test('partial records stay readable without stacks or provider payloads', async () => {
        const { labStore } = makeApp();
        const created = await labStore.createExperiment({
            evidencePackageRef: 'kerum-lab',
            evidencePackageHash: 'abc',
        });
        await labStore.completeExperimentVariant({
            experimentId: created.id,
            profileId: 'baseline-flat-v1',
            report: { findings: [] },
            trace: { profileId: 'baseline-flat-v1' },
            usage: { calls: 1 },
        });
        // The orchestrator passes only err.message (never err.stack); the
        // store persists exactly that plus fixed keys — nothing is enriched
        // with provider internals on the way through.
        await labStore.failExperimentVariant({
            experimentId: created.id,
            profileId: 'context-tree-v1',
            errorCode: 'variant-error',
            errorMessage: 'Simulated candidate failure.',
        });
        const finalized = await labStore.completeExperiment({ experimentId: created.id });

        expect(finalized.status).toBe('partial');
        const failed = finalized.variants['context-tree-v1'];
        expect(failed).toMatchObject({ status: 'error', errorCode: 'variant-error', errorMessage: 'Simulated candidate failure.' });
        expect(Object.keys(failed).sort()).toEqual(
            ['completedAt', 'deterministicScorecard', 'errorCode', 'errorMessage', 'profileSnapshot', 'report', 'status', 'trace', 'usage'].sort()
        );
        expect(failed).not.toHaveProperty('stack');
        expect(failed).not.toHaveProperty('stackTrace');
        expect(finalized.variants['baseline-flat-v1'].status).toBe('complete');
    });
});
