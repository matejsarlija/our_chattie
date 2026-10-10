// backend/tests/replays/analysisLabKerumReplay.test.js
//
// LQ-1 — Kerum Lab replay acceptance suite (spec §9).
//
// Runs all three profiles from the LA-0 sanitized fixture with
// deterministic/mocked model seams: retrieval passes run offline, node
// summaries use an injected stub, report synthesis is bypassed at the
// adapter boundary (LC-3) and mocked at the orchestrator boundary (LE-1).
// No scraper/download/OCR call, no Gemini call.
//
// Assertions stay on source ids, raw values/currencies, linkage classes,
// and coverage gaps — never on historical free-prose wording.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildProfileReportInput } = require('../../court-analysis/reasoning/contextReportAdapter');
const { buildSynthesisInput } = require('../../court-analysis/reasoning/synthesisInputBuilder');
const { collectContextFacts } = require('../../court-analysis/reasoning/caseContextBuilder');
const {
    runExperiment,
} = require('../../court-analysis/reasoning/analysisLab/runExperiment');
const {
    stableStringify,
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../court-analysis/reasoning/analysisLab/evidenceIdentity');
const { createAnalysisLabStore } = require('../../services/analysisLabStore');

const LAB_FIXTURE = require('../fixtures/replays/analysis-lab/kerum-lab.json');

const OFFLINE_SHARED_SEAMS = {
    runJudge: async () => [],
    runRank: async () => null,
};

const frozenDigest = () => evidencePackageDigest(LAB_FIXTURE);

// Resolving stub: cites only ids from the packet allow-list, so every
// statement validates as a reference (membership, not grounding proof).
const resolvingSummaryLlm = jest.fn(async ({ packet }) => JSON.stringify({
    statements: [{
        text: 'Sažetak grane iz dopuštenih izvora.',
        sourceDocumentIds: packet.availableIds.sourceDocumentIds.slice(0, 1),
        factIds: packet.availableIds.factIds.slice(0, 1),
        citationIds: [],
    }],
}));

const failingSummaryLlm = jest.fn(async () => {
    throw new Error('provider down');
});

function selectedNodeIds(trace) {
    return (trace?.selection?.selected || []).map((node) => node.nodeId);
}

describe('Kerum Lab replay: adapter lane (LC-3 boundary)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('all three profiles run from one identical evidence-package hash', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const before = evidencePackageDigest(pkg);

        const traces = {};
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            const { trace } = await buildProfileReportInput({
                evidencePackage: cloneEvidencePackage(pkg),
                retrieval: null,
                rerankedRetrieval: null,
                profileId,
                summarizeLlm: profileId === 'context-tree-summarized-v1' ? resolvingSummaryLlm : null,
            });
            traces[profileId] = trace;
        }

        expect(evidencePackageDigest(pkg)).toBe(before);
        expect(before).toBe(frozenDigest());
        expect(traces['baseline-flat-v1'].baseline).toBe(true);
        expect(traces['context-tree-v1'].baseline).toBe(false);
        expect(traces['context-tree-summarized-v1'].baseline).toBe(false);
    });

    test('baseline uses the flat path unchanged (replay parity)', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'baseline-flat-v1',
        });
        const flat = buildSynthesisInput(cloneEvidencePackage(LAB_FIXTURE), null, null);

        expect(input.claims).toEqual(flat.claims);
        expect(input.claims.some((claim) => String(claim.id).startsWith('context-node-'))).toBe(false);
        expect(trace.claims).toMatchObject({ branch: 0, derived: 0 });
        expect(input.meta.context).toBeUndefined();
    });

    test('both context lanes construct the identical deterministic DAG', async () => {
        const first = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-v1',
        });
        const second = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-v1',
        });
        const summarized = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: failingSummaryLlm,
        });

        expect(first.trace.rootId).toBe(second.trace.rootId);
        expect(selectedNodeIds(first.trace)).toEqual(selectedNodeIds(second.trace));
        // Same DAG with summaries on or off: selection is deterministic.
        expect(selectedNodeIds(summarized.trace)).toEqual(selectedNodeIds(first.trace));
        expect(first.trace.dag.stats).toMatchObject({ threads: 3, unresolved: 1 });
    });

    test('DAG-only makes zero summary calls; summaries-on stays within budget', async () => {
        const dagOnly = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-v1',
        });
        expect(dagOnly.trace.summaries.enabled).toBe(false);
        expect(dagOnly.trace.summaries.stats.calls).toBe(0);
        expect(resolvingSummaryLlm).not.toHaveBeenCalled();

        const summarized = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: resolvingSummaryLlm,
        });
        const { stats } = summarized.trace.summaries;
        expect(stats.calls).toBeGreaterThan(0);
        expect(stats.calls).toBeLessThanOrEqual(4);
        expect(summarized.trace.claims.derived).toBeGreaterThan(0);
    });

    test('source-grounding counts are identical because they are measured from the canonical package', async () => {
        const countGrounded = (pkg) => collectContextFacts(pkg).filter((fact) => fact.grounded === true).length;
        const counts = [];
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            await buildProfileReportInput({
                evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
                retrieval: null,
                rerankedRetrieval: null,
                profileId,
                summarizeLlm: resolvingSummaryLlm,
            });
            counts.push(countGrounded(LAB_FIXTURE));
        }
        expect(counts).toEqual([4, 4, 4]);
        expect(LAB_FIXTURE.coverage.groundedClaims).toBe(5);
        expect(LAB_FIXTURE.coverage.totalClaims).toBe(6);
    });

    test('stable lifecycle transfer becomes a cited thread; ambiguous relation stays unresolved', async () => {
        const { trace } = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-v1',
        });
        const factsById = new Map(collectContextFacts(LAB_FIXTURE).map((fact) => [fact.factId, fact]));

        // Registry-98 pair: two amount facts sharing one registry number and
        // one filing reference form a single cited thread.
        const thread = trace.selection.selected.find(
            (node) => node.factIds.includes('ledger-3') && node.factIds.includes('ledger-4')
        );
        expect(thread).toBeDefined();
        expect(thread.kind === 'claim-thread' || thread.kind === 'property-thread').toBe(true);
        const memberFacts = thread.factIds.map((id) => factsById.get(id));
        expect(new Set(memberFacts.map((fact) => fact?.claimRegistryNumber))).toEqual(new Set(['98']));
        expect(new Set(memberFacts.map((fact) => fact?.filingReference))).toEqual(new Set(['St-2/2013-1201']));
        // The 2025 transfer filing is its own property thread, not merged
        // into the 2026 pair despite the shared registry number.
        const transfer = trace.selection.selected.find((node) => node.factIds.includes('ledger-2'));
        expect(transfer?.kind).toBe('property-thread');
        expect(transfer?.nodeId).not.toBe(thread.nodeId);

        // The identifier-less fact is never merged into a thread.
        const unresolved = trace.selection.selected.filter((node) => node.kind === 'unresolved');
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].factIds).toEqual(['lab-doc-02#property-1']);
        const lifecycleQuestions = LAB_FIXTURE.reconciliation.openQuestions.filter((q) => q.kind === 'lifecycle');
        expect(lifecycleQuestions).toHaveLength(1);
    });

    test('frozen scope/reconciliation inputs stay byte-equivalent; raw currencies preserved', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const scopeBefore = stableStringify(pkg.scope);
        const reconBefore = stableStringify(pkg.reconciliation);

        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            await buildProfileReportInput({
                evidencePackage: pkg,
                retrieval: null,
                rerankedRetrieval: null,
                profileId,
                summarizeLlm: resolvingSummaryLlm,
            });
        }

        expect(stableStringify(pkg.scope)).toBe(scopeBefore);
        expect(stableStringify(pkg.reconciliation)).toBe(reconBefore);
        // Source-stated values survive with both currencies, never averaged.
        const [conflict] = pkg.reconciliation.conflicts;
        const byCurrency = new Map(conflict.amounts.map((amount) => [amount.currency, amount.value]));
        expect(byCurrency.get('HRK')).toBe(9084692.55);
        expect(byCurrency.get('EUR')).toBe(1205850.44);
        expect(pkg.scope.blockedConclusions).toHaveLength(1);
    });

    test('report-time derived metadata never leaks back into the frozen package', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const { input } = await buildProfileReportInput({
            evidencePackage: pkg,
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: resolvingSummaryLlm,
        });

        // Derived context rides in the report input, not the package.
        expect(input.meta.context.profileId).toBe('context-tree-summarized-v1');
        expect(pkg.meta).toBeUndefined();
        expect(pkg.reconciliation.claimLinks).toBeUndefined();
        expect(pkg.reconciliation.significanceRanking).toBeUndefined();
    });

    test('failed summary calls stay inspectable as partial without hiding source evidence', async () => {
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            retrieval: null,
            rerankedRetrieval: null,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: failingSummaryLlm,
        });

        expect(trace.summaries.stats.calls).toBeGreaterThan(0);
        expect(trace.summaries.outcomes.length).toBeGreaterThan(0);
        expect(trace.summaries.outcomes.every((outcome) => outcome.status === 'partial')).toBe(true);
        expect(trace.claims.derived).toBe(0);
        // Raw branch evidence is retained: branch claims still reach synthesis.
        expect(trace.claims.branch).toBeGreaterThan(0);
        expect(input.claims.some((claim) => String(claim.id).startsWith('context-node-'))).toBe(true);
    });
});

describe('Kerum Lab replay: orchestrator lane (LE-1 record)', () => {
    function makeStore() {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-lab-replay-'));
        return createAnalysisLabStore({ dataDir });
    }

    // Lightweight report seam shaped like the adapter trace so the persisted
    // record exercises scorecard + usage paths without model calls.
    function replayVariantReports() {
        return jest.fn(async ({ evidenceClone, profileId, tracker }) => {
            const { trace } = await buildProfileReportInput({
                evidencePackage: evidenceClone,
                retrieval: null,
                rerankedRetrieval: null,
                profileId,
                summarizeLlm: profileId === 'context-tree-summarized-v1' ? resolvingSummaryLlm : null,
            });
            tracker.record({ inputTokens: 100, outputTokens: 50, totalTokens: 150 });
            return {
                report: {
                    narrative: `Replay narrative (${profileId}).`,
                    findings: [{ text: 'Replay finding.', citations: [{ sourceId: 'lab-doc-01' }] }],
                    openQuestions: [],
                    conflicts: [],
                    meta: { scope: { analysisStatus: 'partial', blocked: [] } },
                },
                trace,
            };
        });
    }

    test('one command yields a complete immutable record with scorecards and usage', async () => {
        const lab = makeStore();
        const experiment = await runExperiment({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            evidencePackageRef: 'kerum-lab',
            runtimeMetadata: { codeRevision: 'replay-rev' },
            store: lab,
            deps: { shared: OFFLINE_SHARED_SEAMS, generateVariantReport: replayVariantReports() },
        });

        expect(experiment.status).toBe('complete');
        expect(experiment.evidencePackageHash).toBe(frozenDigest());
        for (const profileId of ['baseline-flat-v1', 'context-tree-v1', 'context-tree-summarized-v1']) {
            const variant = experiment.variants[profileId];
            expect(variant.status).toBe('complete');
            expect(variant.deterministicScorecard).toMatchObject({
                version: 1,
                profileId,
                input: { evidencePackageHash: frozenDigest(), evidencePackageHashMatches: true },
            });
            // Source-claim counts come from the canonical package in every lane.
            expect(variant.deterministicScorecard.sourceSupport).toMatchObject({
                groundedSourceClaims: 5,
                totalSourceClaims: 6,
            });
            expect(variant.usage).toMatchObject({ calls: 1, totalTokens: 150 });
            expect(variant.usage.elapsedMs).toEqual(expect.any(Number));
            expect(variant.trace.evidencePackageHash).toBe(frozenDigest());
        }
        // DAG-only lane made no summary calls; summaries-on lane stayed bounded.
        expect(experiment.variants['context-tree-v1'].trace.summaries.stats.calls).toBe(0);
        const summarizedCalls = experiment.variants['context-tree-summarized-v1'].trace.summaries.stats.calls;
        expect(summarizedCalls).toBeGreaterThan(0);
        expect(summarizedCalls).toBeLessThanOrEqual(4);
    });
});
