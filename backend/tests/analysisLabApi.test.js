// backend/tests/analysisLabApi.test.js
//
// LE-3 — Analysis Lab API tests (spec §4).
//
// Mounts the Lab router directly (same convention as analysis-runs-api.test.js
// and change-detection). Offline: comparisons run through the real
// orchestrator with mocked per-variant reports; no scraper/download/OCR or
// Gemini calls.

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');

const { createAnalysisLabRouter } = require('../court-analysis/reasoning/analysisLab/api');
const { createAnalysisLabStore } = require('../services/analysisLabStore');
const { createLocalStore } = require('../services/localStore');
const { runExperiment } = require('../court-analysis/reasoning/analysisLab/runExperiment');
const {
    cloneEvidencePackage,
    evidencePackageDigest,
} = require('../court-analysis/reasoning/analysisLab/evidenceIdentity');

const LAB_FIXTURE = require('./fixtures/replays/analysis-lab/kerum-lab.json');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'replays', 'analysis-lab');

const OFFLINE_SHARED_SEAMS = {
    runJudge: async () => [],
    runRank: async () => null,
};

function mockVariantReports({ failProfile = null } = {}) {
    return jest.fn(async ({ evidenceClone, profileId, tracker }) => {
        if (profileId === failProfile) {
            throw new Error('Simulated candidate failure.');
        }
        tracker.record({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
        return {
            report: {
                narrative: `Narrative for ${profileId}.`,
                findings: [{ text: `Finding for ${profileId}.`, citations: [{ sourceId: 'lab-doc-01' }] }],
                meta: { scope: { analysisStatus: 'partial', blocked: [] } },
            },
            trace: {
                profileId,
                strategy: profileId === 'baseline-flat-v1' ? 'flat' : 'case-context',
                baseline: profileId === 'baseline-flat-v1',
                claims: { flat: 9, branch: 1, derived: 0 },
            },
        };
    });
}

function makeApp({ runExperimentFn = null, limiterMarker = null } = {}) {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lab-api-'));
    const labStore = createAnalysisLabStore({ dataDir });
    const analysisStore = createLocalStore({ dataDir });
    const mark = (name) => (req, res, next) => {
        if (limiterMarker) limiterMarker.calls.push(name);
        next();
    };
    const router = createAnalysisLabRouter({
        labStore,
        analysisStore,
        fixturesDir: FIXTURES_DIR,
        runExperimentFn: runExperimentFn || (async (args) => runExperiment({
            ...args,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport: mockVariantReports() },
        })),
        readLimiter: mark('read'),
        writeLimiter: mark('write'),
    });
    const app = express();
    app.use(express.json());
    app.use('/api/analysis-lab', router);
    return { app, labStore, analysisStore, dataDir, limiterMarker: limiterMarker || { calls: [] } };
}

afterEach(() => {
    jest.clearAllMocks();
});

describe('analysis lab packages (LE-3)', () => {
    test('lists the frozen fixture with hash and input summary', async () => {
        const { app } = makeApp();
        const res = await request(app).get('/api/analysis-lab/packages');

        expect(res.status).toBe(200);
        const fixture = res.body.packages.find((pkg) => pkg.ref === 'kerum-lab');
        expect(fixture).toMatchObject({
            kind: 'fixture',
            caseNumber: 'St-2/2013',
            evidencePackageHash: evidencePackageDigest(LAB_FIXTURE),
        });
        expect(fixture.inputSummary).toMatchObject({ caseNumber: 'St-2/2013', documents: 3 });
    });

    test('completed runs with a persisted evidence package appear as run refs', async () => {
        const { app, analysisStore } = makeApp();
        const run = await analysisStore.createAnalysisRun({ oib: 'St-2/2013', queryType: 'case_number', queryValue: 'St-2/2013' });
        await analysisStore.completeAnalysisRun({
            analysisId: run.id,
            resultText: 'Sažetak',
            resultJson: { comparativeAnalysis: 'Sažetak', clusterEvidencePackage: cloneEvidencePackage(LAB_FIXTURE) },
        });

        const res = await request(app).get('/api/analysis-lab/packages');
        expect(res.status).toBe(200);
        const entry = res.body.packages.find((pkg) => pkg.ref === run.id);
        expect(entry).toMatchObject({ kind: 'analysis-run', caseNumber: 'St-2/2013' });
        expect(entry.evidencePackageHash).toBe(evidencePackageDigest(LAB_FIXTURE));
    });
});

describe('analysis lab experiment creation (LE-3)', () => {
    test('creates a complete comparison from a fixture ref (201, summary + view model)', async () => {
        const { app } = makeApp();
        const res = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab' });

        expect(res.status).toBe(201);
        expect(res.body.experiment).toMatchObject({
            evidencePackageRef: 'kerum-lab',
            status: 'complete',
            profiles: ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1'],
        });
        expect(res.body.experiment.variantStatus).toMatchObject({
            'baseline-flat-v1': 'complete',
            'context-tree-v1': 'complete',
            'context-tree-summarized-v1': 'complete',
        });
        expect(res.body.comparison.flatToDag.from).toBe('baseline-flat-v1');
        expect(res.body.comparison.dagToSummarized.to).toBe('context-tree-summarized-v1');
    });

    test('candidate failure still creates a partial record (201)', async () => {
        const { app } = makeApp({
            runExperimentFn: async (args) => runExperiment({
                ...args,
                deps: {
                    shared: OFFLINE_SHARED_SEAMS,
                    generateVariantReport: mockVariantReports({ failProfile: 'context-tree-v1' }),
                },
            }),
        });
        const res = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab' });

        expect(res.status).toBe(201);
        expect(res.body.experiment.status).toBe('partial');
        expect(res.body.experiment.variantStatus).toMatchObject({
            'baseline-flat-v1': 'complete',
            'context-tree-v1': 'error',
        });
    });

    test('validation rejects missing/unknown refs and arbitrary execution input', async () => {
        const { app } = makeApp();

        await request(app).post('/api/analysis-lab/experiments').send({})
            .expect(400);
        await request(app).post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'no-such-package' })
            .expect(400);
        await request(app).post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab', profiles: ['baseline-flat-v1'] })
            .expect(400);
        await request(app).post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab', profiles: ['baseline-flat-v1', 'context-tree-v1', 'nope-v1'] })
            .expect(400);
        // No arbitrary profile/model/prompt input, no inline packages.
        for (const body of [
            { evidencePackageRef: 'kerum-lab', modelRoles: { synthesis: 'x' } },
            { evidencePackageRef: 'kerum-lab', promptVersions: { synthesis: 'vX' } },
            { evidencePackageRef: 'kerum-lab', budgets: { maxNodeCalls: 99 } },
            { evidencePackageRef: 'kerum-lab', evidencePackage: cloneEvidencePackage(LAB_FIXTURE) },
        ]) {
            const res = await request(app).post('/api/analysis-lab/experiments').send(body);
            expect(res.status).toBe(400);
        }
    });

    test('run without a persisted frozen package is rejected with a clear code', async () => {
        const { app, analysisStore } = makeApp();
        const run = await analysisStore.createAnalysisRun({ oib: 'x', queryType: 'oib', queryValue: 'x' });
        await analysisStore.completeAnalysisRun({
            analysisId: run.id,
            resultText: 'Sažetak',
            resultJson: { comparativeAnalysis: 'Sažetak' },
        });

        const res = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: run.id });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('no-frozen-package');
    });

    test('comparison never mutates the source analysis run', async () => {
        const { app, analysisStore, dataDir } = makeApp();
        const run = await analysisStore.createAnalysisRun({ oib: 'St-2/2013', queryType: 'case_number', queryValue: 'St-2/2013' });
        await analysisStore.completeAnalysisRun({
            analysisId: run.id,
            resultText: 'Sažetak',
            resultJson: { comparativeAnalysis: 'Sažetak', clusterEvidencePackage: cloneEvidencePackage(LAB_FIXTURE) },
        });
        const runsBefore = fs.readFileSync(path.join(dataDir, 'runs.json'), 'utf8');

        const res = await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: run.id });
        expect(res.status).toBe(201);
        expect(fs.readFileSync(path.join(dataDir, 'runs.json'), 'utf8')).toBe(runsBefore);
    });
});

describe('analysis lab experiment reads (LE-3)', () => {
    async function seedComplete() {
        const ctx = makeApp();
        const created = await request(ctx.app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab' });
        return { ...ctx, experimentId: created.body.experiment.id };
    }

    test('list is summary-only with pagination shape', async () => {
        const { app, experimentId } = await seedComplete();
        const res = await request(app).get('/api/analysis-lab/experiments?limit=10&offset=0');

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ count: 1, limit: 10, offset: 0 });
        expect(res.body.experiments).toHaveLength(1);
        const summary = res.body.experiments[0];
        expect(summary.id).toBe(experimentId);
        expect(summary).not.toHaveProperty('variants');
        expect(summary).toHaveProperty('variantStatus');
    });

    test('get returns the full record: reports, traces, scorecards, snapshots, comparison', async () => {
        const { app, experimentId } = await seedComplete();
        const res = await request(app).get(`/api/analysis-lab/experiments/${experimentId}`);

        expect(res.status).toBe(200);
        const { experiment, comparison } = res.body;
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            const variant = experiment.variants[profileId];
            expect(variant.report.findings).toHaveLength(1);
            expect(variant.trace.claims).toMatchObject({ flat: 9 });
            expect(variant.usage.totalTokens).toBe(150);
            expect(variant.profileSnapshot).toMatchObject({ id: profileId });
            expect(variant.deterministicScorecard).toMatchObject({ version: 1, profileId });
        }
        expect(comparison.flatToDag).toMatchObject({ from: 'baseline-flat-v1', to: 'context-tree-v1' });
        expect(comparison.summaryIncrementalCost).not.toBe('unknown');
    });

    test('unknown experiment is 404, mirroring analysis run reads', async () => {
        const { app } = makeApp();
        const res = await request(app).get('/api/analysis-lab/experiments/missing');
        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/not found/i);
    });

    test('no authentication required and supplied limiters run on every route', async () => {
        const limiterMarker = { calls: [] };
        const { app } = makeApp({ limiterMarker });

        await request(app).get('/api/analysis-lab/packages').expect(200);
        await request(app).get('/api/analysis-lab/experiments').expect(200);
        await request(app)
            .post('/api/analysis-lab/experiments')
            .send({ evidencePackageRef: 'kerum-lab' })
            .expect(201);

        // Same limiter-injection shape as the analysis endpoints: read routes
        // behind the read limiter, creation behind the write limiter.
        expect(limiterMarker.calls).toEqual(expect.arrayContaining(['read', 'write']));
        expect(limiterMarker.calls.filter((call) => call === 'read').length).toBeGreaterThanOrEqual(2);
        expect(limiterMarker.calls.filter((call) => call === 'write').length).toBe(1);
    });
});
