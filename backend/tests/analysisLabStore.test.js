const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createAnalysisLabStore } = require('../services/analysisLabStore');
const { createSqliteStore } = require('../services/sqliteStore');
const { snapshotProfile } = require('../court-analysis/reasoning/analysisLab/profiles');

function persistedRecordPath(dataDir) {
    const [fileName] = fs.readdirSync(path.join(dataDir, 'experiments'));
    return path.join(dataDir, 'experiments', fileName);
}
function makeStores() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lab-store-'));
    return {
        lab: createAnalysisLabStore({ dataDir }),
        runs: createSqliteStore({ dataDir }),
        dataDir,
    };
}

function experimentInput() {
    return {
        evidencePackageRef: 'kerum-lab',
        evidencePackageHash: 'e4e6ae8cfad31398ac21e10f9b10c4000efcfeb13a3c0df917c80bf1e788c921',
        inputSummary: { caseNumber: 'St-2/2013', documents: 3 },
        executionSnapshot: { followUpVerification: 'off' },
        sharedUpstream: { retrievalHash: 'aaa' },
    };
}

function variantPayload(profileId) {
    return {
        profileId,
        profileSnapshot: snapshotProfile(profileId, { codeRevision: 'test-rev' }),
        report: { findings: [{ text: `finding for ${profileId}` }] },
        trace: { selectedFacts: 4 },
        usage: { calls: 1, totalTokens: 100 },
        deterministicScorecard: { findingsWithValidCitations: 12 },
    };
}

function legacyExperiment(id = 'legacy-experiment') {
    return {
        ...experimentInput(),
        id,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        profiles: ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1'],
        sharedUsage: null,
        variants: {},
        status: 'running',
    };
}

describe('analysisLabStore.createExperiment', () => {
    test('persists an immutable running record with the three built-in profiles', async () => {
        const { lab } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());

        expect(experiment).toMatchObject({
            evidencePackageRef: 'kerum-lab',
            status: 'running',
            profiles: ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1'],
        });
        expect(experiment.id).toBeDefined();
        expect(experiment.createdAt).toBeDefined();
        expect(experiment.variants).toEqual({});
        expect(experiment.sharedUpstream).toMatchObject({ retrievalHash: 'aaa' });
    });

    test('rejects unknown, partial, or duplicate profile sets', async () => {
        const { lab } = makeStores();
        await expect(lab.createExperiment({ ...experimentInput(), profiles: ['baseline-flat-v1'] }))
            .rejects.toThrow(/all three built-in profiles/);
        await expect(lab.createExperiment({ ...experimentInput(), profiles: ['baseline-flat-v1', 'nope-v1', 'context-tree-v1'] }))
            .rejects.toThrow(/Unknown analysis-lab profile/);
        await expect(lab.createExperiment({ ...experimentInput(), evidencePackageHash: '' }))
            .rejects.toThrow(/evidencePackageHash is required/);
        await expect(lab.createExperiment({ ...experimentInput(), evidencePackageRef: '' }))
            .rejects.toThrow(/evidencePackageRef is required/);
    });

    test('throws for unknown experiment', async () => {
        const { lab } = makeStores();
        await expect(lab.getExperiment({ id: 'missing' })).rejects.toThrow('Analysis Lab experiment not found.');
    });
});

describe('analysisLabStore variant completion (immutability)', () => {
    test('records a variant as an individual immutable file', async () => {
        const { lab, dataDir } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());

        const updated = await lab.completeExperimentVariant({
            experimentId: experiment.id,
            ...variantPayload('baseline-flat-v1'),
        });
        expect(fs.existsSync(persistedRecordPath(dataDir))).toBe(true);
        expect(updated.variants['baseline-flat-v1']).toMatchObject({
            status: 'complete',
            report: { findings: [{ text: 'finding for baseline-flat-v1' }] },
        });
    });
    test('records a variant and rejects a duplicate completion without overwriting', async () => {
        const { lab } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());

        const updated = await lab.completeExperimentVariant({
            experimentId: experiment.id,
            ...variantPayload('baseline-flat-v1'),
        });
        expect(updated.variants['baseline-flat-v1']).toMatchObject({
            status: 'complete',
            report: { findings: [{ text: 'finding for baseline-flat-v1' }] },
        });

        await expect(lab.completeExperimentVariant({
            experimentId: experiment.id,
            ...variantPayload('baseline-flat-v1'),
            report: { findings: [{ text: 'sneaky overwrite' }] },
        })).rejects.toThrow(/already recorded/);

        const reloaded = await lab.getExperiment({ id: experiment.id });
        expect(reloaded.variants['baseline-flat-v1'].report).toEqual({
            findings: [{ text: 'finding for baseline-flat-v1' }],
        });
    });

    test('candidate failure is stored while the successful baseline remains readable', async () => {
        const { lab } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());

        await lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload('baseline-flat-v1') });
        await lab.failExperimentVariant({
            experimentId: experiment.id,
            profileId: 'context-tree-summarized-v1',
            errorCode: 'node-summary-timeout',
            errorMessage: 'Node summary timed out; raw node retained.',
        });

        const reloaded = await lab.getExperiment({ id: experiment.id });
        expect(reloaded.variants['baseline-flat-v1'].status).toBe('complete');
        expect(reloaded.variants['baseline-flat-v1'].report.findings).toHaveLength(1);
        expect(reloaded.variants['context-tree-summarized-v1']).toMatchObject({
            status: 'error',
            errorCode: 'node-summary-timeout',
        });

        const finalized = await lab.completeExperiment({ experimentId: experiment.id });
        expect(finalized.status).toBe('partial');
    });

    test('finalized experiments reject further variant writes', async () => {
        const { lab } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            await lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload(profileId) });
        }
        const finalized = await lab.completeExperiment({ experimentId: experiment.id });
        expect(finalized.status).toBe('complete');

        await expect(lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload('baseline-flat-v1') }))
            .rejects.toThrow(/already complete/);
    });

    test('experiment with no successful variants finalizes as error', async () => {
        const { lab } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());
        await lab.failExperimentVariant({ experimentId: experiment.id, profileId: 'baseline-flat-v1' });
        const finalized = await lab.completeExperiment({ experimentId: experiment.id });
        expect(finalized.status).toBe('error');
    });

    test('never persists credentials passed inside variant payloads', async () => {
        const { lab, dataDir } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());
        await lab.completeExperimentVariant({
            experimentId: experiment.id,
            ...variantPayload('baseline-flat-v1'),
            usage: { calls: 1, apiKey: 'super-secret' },
        });
        const raw = fs.readFileSync(persistedRecordPath(dataDir), 'utf8');
        expect(raw).not.toContain('super-secret');
    });
});

describe('analysisLabStore listing and isolation', () => {
    test('lists newest first with count and pagination', async () => {
        const { lab } = makeStores();
        const first = await lab.createExperiment(experimentInput());
        const second = await lab.createExperiment(experimentInput());

        const page = await lab.listExperiments({ limit: 10, offset: 0 });
        expect(page.count).toBe(2);
        expect(page.data.map((e) => e.id)).toEqual([second.id, first.id]);

        const tail = await lab.listExperiments({ limit: 10, offset: 1 });
        expect(tail.data.map((e) => e.id)).toEqual([first.id]);
    });

    test('persists newest-first ordering for tied timestamps across restarts and directory order', async () => {
        const { lab, dataDir } = makeStores();
        jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
        let directorySpy;
        try {
            const first = await lab.createExperiment(experimentInput());
            const second = await lab.createExperiment(experimentInput());
            const restarted = createAnalysisLabStore({ dataDir });
            const third = await restarted.createExperiment(experimentInput());
            await restarted.completeExperimentVariant({
                experimentId: first.id,
                ...variantPayload('baseline-flat-v1'),
            });

            const newestFirst = [third, second, first];
            expect(new Set(newestFirst.map((record) => record.createdAt)).size).toBe(1);
            const filenames = newestFirst.map((record) =>
                `${crypto.createHash('sha256').update(record.id).digest('hex')}.json`
            );
            const readDirectory = fs.readdirSync.bind(fs);
            directorySpy = jest.spyOn(fs, 'readdirSync').mockImplementation((...args) =>
                readDirectory(...args).sort((a, b) => filenames.indexOf(a.name) - filenames.indexOf(b.name))
            );

            const reopened = createAnalysisLabStore({ dataDir });
            const listed = await reopened.listExperiments();
            expect(listed.data.map((record) => record.id)).toEqual(newestFirst.map((record) => record.id));
            const page = await reopened.listExperiments({ limit: 1, offset: 1 });
            expect(page.data.map((record) => record.id)).toEqual([second.id]);
        } finally {
            directorySpy?.mockRestore();
            jest.useRealTimers();
        }
    });

    test('new tied records sort ahead of existing legacy and per-record data without a discriminator', async () => {
        const { lab, dataDir } = makeStores();
        const legacy = [legacyExperiment('oldest'), legacyExperiment('later-legacy')];
        fs.writeFileSync(path.join(dataDir, 'experiments.json'), JSON.stringify(legacy), 'utf8');
        const recordsDir = path.join(dataDir, 'experiments');
        fs.mkdirSync(recordsDir);
        const standalone = legacyExperiment('old-standalone');
        fs.writeFileSync(path.join(recordsDir, 'old-standalone.json'), JSON.stringify(standalone), 'utf8');

        jest.useFakeTimers({ now: new Date(legacy[0].createdAt) });
        try {
            const created = await lab.createExperiment(experimentInput());
            const restarted = createAnalysisLabStore({ dataDir });
            const listed = await restarted.listExperiments();
            expect(listed.data.map((record) => record.id)).toEqual([
                created.id, standalone.id, legacy[1].id, legacy[0].id,
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('experiment writes leave the source analysis-run record byte-equivalent', async () => {
        const { lab, runs, dataDir } = makeStores();
        const run = await runs.createAnalysisRun({ oib: 'St-2/2013', queryType: 'case_number', queryValue: 'St-2/2013' });
        await runs.completeAnalysisRun({ analysisId: run.id, resultText: 'original', resultJson: { report: { findings: [1] } } });

        const runBefore = await runs.getAnalysisRun({ id: run.id });
        const experiment = await lab.createExperiment(experimentInput());
        await lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload('baseline-flat-v1') });
        await lab.failExperimentVariant({ experimentId: experiment.id, profileId: 'context-tree-v1' });
        await lab.completeExperiment({ experimentId: experiment.id });

        expect(await runs.getAnalysisRun({ id: run.id })).toEqual(runBefore);
        expect(fs.existsSync(persistedRecordPath(dataDir))).toBe(true);

        const reloaded = await runs.getAnalysisRun({ id: run.id });
        expect(reloaded.result_text).toBe('original');
    });

    test('experiments survive a local-store restart', async () => {
        const { lab, dataDir } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());
        await lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload('baseline-flat-v1') });

        const restarted = createAnalysisLabStore({ dataDir });
        const reloaded = await restarted.getExperiment({ id: experiment.id });
        expect(reloaded.variants['baseline-flat-v1'].status).toBe('complete');

        const listed = await restarted.listExperiments({ limit: 10, offset: 0 });
        expect(listed.count).toBe(1);
    });

    test('queued writes serialize so concurrent creations are never lost', async () => {
        const { lab } = makeStores();
        const created = await Promise.all(
            Array.from({ length: 10 }, () => lab.createExperiment(experimentInput()))
        );
        expect(new Set(created.map((e) => e.id)).size).toBe(10);

        const listed = await lab.listExperiments({ limit: 20, offset: 0 });
        expect(listed.count).toBe(10);
    });

    test('concurrent variant completions all land', async () => {
        const { lab } = makeStores();
        const experiment = await lab.createExperiment(experimentInput());
        await Promise.all(
            ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1'].map((profileId) =>
                lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload(profileId) })
            )
        );
        const reloaded = await lab.getExperiment({ id: experiment.id });
        expect(Object.keys(reloaded.variants)).toHaveLength(3);
    });

    test('reads legacy array records and writes updates without rewriting the legacy file', async () => {
        const { lab, dataDir } = makeStores();
        const legacy = legacyExperiment();
        const legacyPath = path.join(dataDir, 'experiments.json');
        fs.writeFileSync(legacyPath, JSON.stringify([legacy]), 'utf8');

        expect((await lab.getExperiment({ id: legacy.id })).id).toBe(legacy.id);
        await lab.failExperimentVariant({
            experimentId: legacy.id,
            profileId: 'baseline-flat-v1',
            errorMessage: 'offline failure',
        });

        expect(fs.readFileSync(legacyPath, 'utf8')).toBe(JSON.stringify([legacy]));
        const reloaded = await lab.getExperiment({ id: legacy.id });
        expect(reloaded.variants['baseline-flat-v1']).toMatchObject({ status: 'error', errorMessage: 'offline failure' });
    });

    test.each([
        ['successful variant', (lab, id) => lab.completeExperimentVariant({
            experimentId: id,
            ...variantPayload('baseline-flat-v1'),
        }), { variants: { 'baseline-flat-v1': { status: 'complete' } } }],
        ['failed variant', (lab, id) => lab.failExperimentVariant({
            experimentId: id,
            profileId: 'baseline-flat-v1',
        }), { variants: { 'baseline-flat-v1': { status: 'error' } } }],
        ['finalization', (lab, id) => lab.completeExperiment({ experimentId: id }), { status: 'error' }],
    ])('failed migration of %s leaves cached legacy data unchanged and can be retried', async (_, mutate, expected) => {
        const { lab, dataDir } = makeStores();
        const legacy = legacyExperiment();
        const legacyPath = path.join(dataDir, 'experiments.json');
        const original = JSON.stringify([legacy]);
        fs.writeFileSync(legacyPath, original, 'utf8');
        await lab.getExperiment({ id: legacy.id });

        const renameSpy = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
            throw Object.assign(new Error('simulated migration write failure'), { code: 'EACCES' });
        });
        try {
            await expect(mutate(lab, legacy.id)).rejects.toThrow('simulated migration write failure');
        } finally {
            renameSpy.mockRestore();
        }

        expect(await lab.getExperiment({ id: legacy.id })).toEqual(legacy);
        expect((await lab.listExperiments()).data).toEqual([legacy]);
        expect(fs.readFileSync(legacyPath, 'utf8')).toBe(original);
        expect(await mutate(lab, legacy.id)).toMatchObject(expected);
        const restarted = createAnalysisLabStore({ dataDir });
        expect(await restarted.getExperiment({ id: legacy.id })).toMatchObject(expected);
        expect(fs.readFileSync(legacyPath, 'utf8')).toBe(original);
    });
});
