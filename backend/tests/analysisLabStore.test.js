const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAnalysisLabStore } = require('../services/analysisLabStore');
const { createLocalStore } = require('../services/localStore');
const { snapshotProfile } = require('../court-analysis/reasoning/analysisLab/profiles');

function makeStores() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lab-store-'));
    return {
        lab: createAnalysisLabStore({ dataDir }),
        runs: createLocalStore({ dataDir }),
        dataDir,
    };
}

function experimentInput() {
    return {
        evidencePackageRef: 'kerum-lab',
        evidencePackageHash: 'e4e6ae8cfad31398ac21e10f9b10c4000efcfeb13a3c0df917c80bf1e788c921',
        inputSummary: { caseNumber: 'St-2/2013', documents: 3 },
        executionSnapshot: { followUpVerification: 'off' },
        sharedUpstream: { retrievalHash: 'aaa', rerankHash: 'bbb', advisoryHash: 'ccc' },
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
        const raw = fs.readFileSync(path.join(dataDir, 'experiments.json'), 'utf8');
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

    test('experiment writes leave the source analysis-run record byte-equivalent', async () => {
        const { lab, runs, dataDir } = makeStores();
        const run = await runs.createAnalysisRun({ oib: 'St-2/2013', queryType: 'case_number', queryValue: 'St-2/2013' });
        await runs.completeAnalysisRun({ analysisId: run.id, resultText: 'original', resultJson: { report: { findings: [1] } } });

        const runsBefore = fs.readFileSync(path.join(dataDir, 'runs.json'), 'utf8');
        const experiment = await lab.createExperiment(experimentInput());
        await lab.completeExperimentVariant({ experimentId: experiment.id, ...variantPayload('baseline-flat-v1') });
        await lab.failExperimentVariant({ experimentId: experiment.id, profileId: 'context-tree-v1' });
        await lab.completeExperiment({ experimentId: experiment.id });

        expect(fs.readFileSync(path.join(dataDir, 'runs.json'), 'utf8')).toBe(runsBefore);
        expect(fs.existsSync(path.join(dataDir, 'experiments.json'))).toBe(true);

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
});
