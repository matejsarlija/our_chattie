// backend/tests/reasoning/analysisLab/runExperiment.test.js
//
// LE-1 — comparison orchestrator tests (spec §§4–5, 8).
//
// Fixture-backed and offline: no scraper/download/OCR/native-PDF calls, no
// Gemini model calls. Report generation is mocked per variant; shared-pass
// model seams are stubbed (judge/rank), while retrieval/rerank run for real
// in their deterministic offline mode (no `llmRerank` seam → skipped).

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    runExperiment,
    prepareSharedReportArtifacts,
} = require('../../../court-analysis/reasoning/analysisLab/runExperiment');
const {
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../../court-analysis/reasoning/analysisLab/evidenceIdentity');
const { snapshotExecutionSettings } = require('../../../court-analysis/reasoning/analysisLab/profiles');
const { createAnalysisLabStore } = require('../../../services/analysisLabStore');

const LAB_FIXTURE = require('../../fixtures/replays/analysis-lab/kerum-lab.json');

const OFFLINE_SHARED_SEAMS = {
    runJudge: async () => [],
    runRank: async () => null,
};

function makeStore() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lab-run-'));
    return { lab: createAnalysisLabStore({ dataDir }), dataDir };
}

function mockVariantReports({ failProfile = null, tokensByProfile = null } = {}) {
    const seen = [];
    const generateVariantReport = jest.fn(async ({
        evidenceClone,
        profileId,
        sharedUpstream,
        sharedHashes,
        evidencePackageHash,
        tracker,
    }) => {
        seen.push({
            profileId,
            evidencePackageHash,
            sharedHashes: { ...sharedHashes },
            retrieval: sharedUpstream.retrieval,
            rerankedRetrieval: sharedUpstream.rerankedRetrieval,
            claimLinks: sharedUpstream.claimLinks,
            cloneDigest: evidencePackageDigest(evidenceClone),
        });
        if (profileId === failProfile) {
            throw new Error('Simulated candidate failure.');
        }
        const tokens = tokensByProfile?.[profileId] ?? 100;
        tracker.record({ inputTokens: tokens, outputTokens: tokens / 2, totalTokens: tokens * 1.5 });
        return {
            report: { findings: [{ text: `finding for ${profileId}` }], meta: {} },
            trace: { profileId, claims: { flat: 3, branch: 1, derived: 0 } },
        };
    });
    return { generateVariantReport, seen };
}

describe('runExperiment shared boundary (LE-1)', () => {
    test('all three variants share one evidence hash and identical shared artifacts', async () => {
        const { lab } = makeStore();
        const frozenDigest = evidencePackageDigest(LAB_FIXTURE);
        const { generateVariantReport, seen } = mockVariantReports({
            tokensByProfile: {
                'baseline-flat-v1': 100,
                'context-tree-v1': 200,
                'context-tree-summarized-v1': 400,
            },
        });

        const experiment = await runExperiment({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            evidencePackageRef: 'kerum-lab',
            runtimeMetadata: { codeRevision: 'test-rev' },
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        });

        expect(experiment.status).toBe('complete');
        expect(experiment.evidencePackageHash).toBe(frozenDigest);
        expect(Object.keys(experiment.variants)).toHaveLength(3);
        expect(seen.map((call) => call.profileId)).toEqual([
            'baseline-flat-v1',
            'context-tree-v1',
            'context-tree-summarized-v1',
        ]);

        // Same frozen hash into every variant, matching the stored record.
        for (const call of seen) {
            expect(call.evidencePackageHash).toBe(frozenDigest);
            expect(call.cloneDigest).toBe(frozenDigest);
        }
        // Same shared-artifact hashes recorded on the experiment and seen by
        // every variant; retrieval content identical but independently cloned.
        expect(experiment.sharedUpstream).toMatchObject({
            retrievalHash: expect.any(String),
            rerankHash: expect.any(String),
            advisoryHash: expect.any(String),
        });
        for (const call of seen) {
            expect(call.sharedHashes).toEqual(experiment.sharedUpstream);
        }
        expect(seen[0].retrieval).toEqual(seen[1].retrieval);
        expect(seen[1].retrieval).toEqual(seen[2].retrieval);
        expect(seen[0].retrieval).not.toBe(seen[1].retrieval);
        expect(seen[0].rerankedRetrieval).toEqual(seen[2].rerankedRetrieval);

        // Per-variant isolation: distinct usage totals from their own tracker.
        const usages = ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']
            .map((id) => experiment.variants[id].usage);
        expect(usages.map((usage) => usage.totalTokens)).toEqual([150, 300, 600]);
        for (const usage of usages) {
            expect(usage.elapsedMs).toEqual(expect.any(Number));
        }

        // Snapshots enable setup replay.
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            expect(experiment.variants[profileId].profileSnapshot).toMatchObject({
                id: profileId,
                codeRevision: 'test-rev',
            });
        }

        // LE-2 — every successful variant persists a descriptive scorecard
        // covering all §6 dimensions, without a composite score or winner.
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            const scorecard = experiment.variants[profileId].deterministicScorecard;
            expect(scorecard).toMatchObject({
                version: 1,
                profileId,
                input: { evidencePackageHash: frozenDigest, evidencePackageHashMatches: true },
            });
            for (const dimension of ['sourceSupport', 'coverage', 'reconciliation', 'shape', 'reliability', 'cost']) {
                expect(scorecard).toHaveProperty(dimension);
            }
            expect(JSON.stringify(scorecard).toLowerCase()).not.toMatch(/winner|composite/);
        }
        expect(experiment.variants['baseline-flat-v1'].deterministicScorecard.shape.branchClaims).toBe('n/a');
    });

    test('frozen input is byte-identical before and after the comparison', async () => {
        const { lab } = makeStore();
        const frozen = cloneEvidencePackage(LAB_FIXTURE);
        const digestBefore = evidencePackageDigest(frozen);
        const { generateVariantReport } = mockVariantReports();

        await runExperiment({
            evidencePackage: frozen,
            evidencePackageRef: 'kerum-lab',
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        });

        expect(evidencePackageDigest(frozen)).toBe(digestBefore);
    });

    test('one variant failure is isolated: partial experiment keeps the baseline', async () => {
        const { lab } = makeStore();
        const { generateVariantReport } = mockVariantReports({ failProfile: 'context-tree-v1' });

        const experiment = await runExperiment({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            evidencePackageRef: 'kerum-lab',
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        });

        expect(experiment.status).toBe('partial');
        expect(experiment.variants['baseline-flat-v1'].status).toBe('complete');
        expect(experiment.variants['baseline-flat-v1'].report.findings).toHaveLength(1);
        expect(experiment.variants['context-tree-v1'].status).toBe('error');
        expect(experiment.variants['context-tree-v1'].errorMessage).toMatch(/Simulated candidate failure/);
        expect(experiment.variants['context-tree-summarized-v1'].status).toBe('complete');
    });

    test('invalid or divergent input refuses to compare', async () => {
        const { lab } = makeStore();
        const { generateVariantReport } = mockVariantReports();

        await expect(runExperiment({
            evidencePackage: { packageType: 'NotEvidence', clusterId: 'X' },
            evidencePackageRef: 'kerum-lab',
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        })).rejects.toThrow(/invalid frozen evidence package/);
        expect(generateVariantReport).not.toHaveBeenCalled();

        // A changed source fact yields a different identity — the comparison
        // records exactly the hash it ran from, never a stale one.
        const mutated = cloneEvidencePackage(LAB_FIXTURE);
        mutated.analyses[0] = { ...mutated.analyses[0], summary: 'Tampered summary.' };
        const mutatedDigest = evidencePackageDigest(mutated);
        expect(mutatedDigest).not.toBe(evidencePackageDigest(LAB_FIXTURE));

        const experiment = await runExperiment({
            evidencePackage: mutated,
            evidencePackageRef: 'kerum-lab',
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        });
        expect(experiment.evidencePackageHash).toBe(mutatedDigest);
        expect(generateVariantReport.mock.calls[0][0].evidencePackageHash).toBe(mutatedDigest);
    });

    test('unknown or partial profile sets are rejected before any variant runs', async () => {
        const { lab } = makeStore();
        const { generateVariantReport } = mockVariantReports();

        await expect(runExperiment({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            evidencePackageRef: 'kerum-lab',
            profiles: ['baseline-flat-v1', 'context-tree-v1'],
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        })).rejects.toThrow(/all three built-in profiles/);

        await expect(runExperiment({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            evidencePackageRef: 'kerum-lab',
            profiles: ['baseline-flat-v1', 'context-tree-v1', 'nope-v1'],
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport },
        })).rejects.toThrow(/Unknown analysis-lab profile/);
        expect(generateVariantReport).not.toHaveBeenCalled();
    });

    test('fixture lane never touches scraper/download/OCR modules', async () => {
        // Module references only (comments may name the forbidden modules to
        // document the boundary): no require/import of acquisition modules.
        const moduleRefPattern = /(require\s*\(|from\s+['"]|import\s*\(?['"])[^'"]*(scraper|download|ocr|native-?pdf|puppeteer)/i;
        const sources = [
            fs.readFileSync(
                path.join(__dirname, '../../../court-analysis/reasoning/analysisLab/runExperiment.js'), 'utf8'
            ),
            fs.readFileSync(
                path.join(__dirname, '../../../court-analysis/reasoning/reportService.js'), 'utf8'
            ),
        ];
        for (const source of sources) {
            expect(source).not.toMatch(moduleRefPattern);
        }

        // The shared phase itself runs with no acquisition/model seams.
        const executionSnapshot = snapshotExecutionSettings({ codeRevision: 'test-rev' });
        const shared = await prepareSharedReportArtifacts(
            cloneEvidencePackage(LAB_FIXTURE),
            executionSnapshot,
            OFFLINE_SHARED_SEAMS
        );
        expect(shared.hashes.retrievalHash).toMatch(/^[0-9a-f]{64}$/);
        expect(shared.hashes.rerankHash).toMatch(/^[0-9a-f]{64}$/);
        expect(shared.hashes.advisoryHash).toMatch(/^[0-9a-f]{64}$/);
        expect(shared.retrieval).toBeDefined();
        expect(shared.rerankedRetrieval).toBeDefined();
    });
});
