// backend/tests/reasoning/analysisLab/scorecard.test.js
//
// LE-2 — deterministic scorecard tests (spec §6).
//
// Fixture-backed and offline: counts come from the Kerum Lab fixture plus
// hand-built variant reports/traces shaped like the LC-3 adapter output. No
// model calls, no prose parsing, no composite score or winner anywhere.

const {
    UNKNOWN,
    NOT_APPLICABLE,
    computeVariantScorecard,
    describeVariantDelta,
    buildComparisonViewModel,
} = require('../../../court-analysis/reasoning/analysisLab/scorecard');
const {
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../../court-analysis/reasoning/analysisLab/evidenceIdentity');
const { snapshotProfile } = require('../../../court-analysis/reasoning/analysisLab/profiles');

const LAB_FIXTURE = require('../../fixtures/replays/analysis-lab/kerum-lab.json');

function flatTrace(hash) {
    return {
        profileId: 'baseline-flat-v1',
        strategy: 'flat',
        baseline: true,
        rootId: null,
        claims: { flat: 9, branch: 0, derived: 0 },
        truncated: false,
        evidencePackageHash: hash,
    };
}

function contextTrace(hash, { branch = 2, derived = 0, unresolved = 1, partial = 0 } = {}) {
    const selected = [
        { nodeId: 'cn-claim-thread-1', kind: 'claim-thread', factIds: ['f1'] },
        { nodeId: 'cn-property-thread-1', kind: 'property-thread', factIds: ['f2'] },
    ];
    for (let index = 0; index < unresolved; index += 1) {
        selected.push({ nodeId: `cn-unresolved-${index + 1}`, kind: 'unresolved', factIds: [] });
    }
    const outcomes = [];
    for (let index = 0; index < partial; index += 1) {
        outcomes.push({ nodeId: `cn-claim-thread-${index + 1}`, status: 'partial', reason: 'call-failed', calls: 1 });
    }
    return {
        profileId: 'context-tree-v1',
        strategy: 'case-context',
        baseline: false,
        rootId: 'cn-case-root',
        dag: { nodeCount: selected.length + 1 },
        selection: { selected, omitted: [] },
        summaries: {
            enabled: false,
            stats: { eligible: 2, attempted: 0, completed: 0, partial, calls: partial },
            outcomes,
            omitted: [],
            droppedDerived: [],
        },
        claims: { flat: 9, branch, derived },
        truncated: false,
        evidencePackageHash: hash,
    };
}

function variantReport({ cited = 2, uncited = 1, scopeStatus = 'partial', blocked = 1 } = {}) {
    const findings = [];
    for (let index = 0; index < cited; index += 1) {
        findings.push({
            text: `Cited finding ${index + 1}.`,
            confidence: 'medium',
            citations: [{ sourceId: 'lab-doc-01', fileName: 'Prijava tražbine CRO-GO.pdf' }],
        });
    }
    for (let index = 0; index < uncited; index += 1) {
        findings.push({ text: `Uncited finding ${index + 1}.`, confidence: 'low', citations: [] });
    }
    return {
        narrative: 'Sažetak.',
        findings,
        openQuestions: [],
        conflicts: [],
        meta: {
            scope: { analysisStatus: scopeStatus, blocked: Array.from({ length: blocked }, (_, i) => `blocked-${i + 1}`) },
        },
    };
}

describe('computeVariantScorecard (LE-2)', () => {
    test('counts are deterministic on the Kerum fixture across repeated runs', async () => {
        const hash = evidencePackageDigest(LAB_FIXTURE);
        const args = {
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport(),
            trace: contextTrace(hash, { unresolved: 1 }),
            usage: { calls: 3, inputTokens: 1000, outputTokens: 200, totalTokens: 1200, elapsedMs: 450 },
            profileSnapshot: snapshotProfile('context-tree-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        };
        const first = computeVariantScorecard(args);
        const second = computeVariantScorecard({
            ...args,
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
        });

        expect(second).toEqual(first);
        expect(first.input).toMatchObject({
            evidencePackageHash: hash,
            evidencePackageHashMatches: true,
            documents: 3,
            entries: 3,
        });
        // Source-claim and report-finding denominators keep distinct labels.
        expect(first.sourceSupport).toMatchObject({
            groundedSourceClaims: 5,
            totalSourceClaims: 6,
            reportFindingsTotal: 3,
            reportFindingsWithValidCitations: 2,
            unsupportedOrDegradedFindings: 1,
        });
        expect(first.coverage).toMatchObject({
            scopeStatus: 'partial',
            blockedConclusions: 1,
            criticalFailedDocuments: 1,
            ocrOrNativeTruncations: 0,
            coverageGaps: 1,
        });
        expect(first.reconciliation).toMatchObject({
            conflictsTotal: 1,
            currencyConflicts: 1,
            openQuestionsTotal: 1,
        });
        expect(first.shape).toMatchObject({
            timelineSpanDays: 831,
            flatClaims: 9,
            branchClaims: 2,
            unresolvedNodes: 1,
        });
        expect(first.cost).toMatchObject({
            calls: 3,
            inputTokens: 1000,
            outputTokens: 200,
            totalTokens: 1200,
            elapsedMs: 450,
        });
    });

    test('flat profile marks context fields not-applicable instead of zero', () => {
        const hash = evidencePackageDigest(LAB_FIXTURE);
        const scorecard = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport(),
            trace: flatTrace(hash),
            usage: { calls: 2, inputTokens: 800, outputTokens: 100, totalTokens: 900, elapsedMs: 300 },
            profileSnapshot: snapshotProfile('baseline-flat-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });

        expect(scorecard.shape.branchClaims).toBe(NOT_APPLICABLE);
        expect(scorecard.shape.derivedClaims).toBe(NOT_APPLICABLE);
        expect(scorecard.shape.selectedContextNodes).toBe(NOT_APPLICABLE);
        expect(scorecard.shape.partialNodes).toBe(NOT_APPLICABLE);
        expect(scorecard.shape.unresolvedNodes).toBe(NOT_APPLICABLE);
        expect(scorecard.cost.nodeSummaryCalls).toBe(NOT_APPLICABLE);
        // …while the candidate's ambiguous relationship stays a real count.
        const candidate = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport(),
            trace: contextTrace(hash, { unresolved: 1 }),
            usage: { calls: 2, inputTokens: 800, outputTokens: 100, totalTokens: 900, elapsedMs: 300 },
            profileSnapshot: snapshotProfile('context-tree-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });
        expect(candidate.shape.unresolvedNodes).toBe(1);
    });

    test('partial node count deduplicates node status and summary outcome', () => {
        const hash = evidencePackageDigest(LAB_FIXTURE);
        const trace = contextTrace(hash, { unresolved: 0 });
        trace.selection.selected[0].status = 'partial';
        trace.summaries.enabled = true;
        trace.summaries.outcomes = [
            { nodeId: trace.selection.selected[0].nodeId, status: 'partial', reason: 'call-failed' },
            { nodeId: trace.selection.selected[1].nodeId, status: 'partial', reason: 'node-budget-exhausted' },
        ];

        const scorecard = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport(),
            trace,
            usage: { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, elapsedMs: 50 },
            profileSnapshot: snapshotProfile('context-tree-summarized-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });

        expect(scorecard.shape.partialNodes).toBe(2);
    });

    test('missing verifier/scope/usage data degrades to unknown, never zero', () => {
        const barePackage = cloneEvidencePackage(LAB_FIXTURE);
        delete barePackage.scope;
        delete barePackage.discovery;
        const scorecard = computeVariantScorecard({
            evidencePackage: barePackage,
            report: { findings: [{ text: 'Bare finding.' }] },
            trace: { profileId: 'context-tree-v1' },
            usage: null,
            profileSnapshot: snapshotProfile('context-tree-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: evidencePackageDigest(LAB_FIXTURE),
        });

        expect(scorecard.coverage.scopeStatus).toBe(UNKNOWN);
        expect(scorecard.shape.timelineSpanDays).toBe(UNKNOWN);
        expect(scorecard.shape.flatClaims).toBe(UNKNOWN);
        expect(scorecard.cost.calls).toBe(UNKNOWN);
        expect(scorecard.cost.totalTokens).toBe(UNKNOWN);
        expect(scorecard.cost.elapsedMs).toBe(UNKNOWN);
        expect(scorecard.sourceSupport.unsupportedOrDegradedFindings).toBe(1);

        // Package-level scope remains a legitimate fallback when the report
        // carries no verifier scope of its own.
        const withPackageScope = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: { findings: [{ text: 'Bare finding.' }] },
            trace: { profileId: 'context-tree-v1' },
            usage: null,
            profileSnapshot: snapshotProfile('context-tree-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: evidencePackageDigest(LAB_FIXTURE),
        });
        expect(withPackageScope.coverage.scopeStatus).toBe('partial');
        expect(withPackageScope.coverage.blockedConclusions).toBe(1);
    });

    test('changing variant B never alters variant A scorecard', () => {
        const hash = evidencePackageDigest(LAB_FIXTURE);
        const baseArgs = {
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            trace: flatTrace(hash),
            usage: { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, elapsedMs: 50 },
            profileSnapshot: snapshotProfile('baseline-flat-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        };
        const reportA = variantReport({ cited: 2, uncited: 1 });
        const before = computeVariantScorecard({ ...baseArgs, report: reportA });
        computeVariantScorecard({ ...baseArgs, report: variantReport({ cited: 5, uncited: 0 }) });
        const after = computeVariantScorecard({ ...baseArgs, report: reportA });

        expect(after).toEqual(before);
    });

    test('scorecard never declares a composite score, ranking, or winner', () => {
        const hash = evidencePackageDigest(LAB_FIXTURE);
        const scorecard = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport(),
            trace: contextTrace(hash),
            usage: { calls: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, elapsedMs: 50 },
            profileSnapshot: snapshotProfile('context-tree-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });
        const serialized = JSON.stringify(scorecard).toLowerCase();
        expect(serialized).not.toMatch(/winner|composite|ranking|score":/);
        expect(scorecard).not.toHaveProperty('winner');
        expect(scorecard).not.toHaveProperty('score');
        expect(scorecard).not.toHaveProperty('rank');
    });
});

describe('describeVariantDelta + buildComparisonViewModel (LE-2)', () => {
    function scorecards() {
        const hash = evidencePackageDigest(LAB_FIXTURE);
        const usage = (calls, total) => ({ calls, inputTokens: total, outputTokens: 0, totalTokens: total, elapsedMs: calls * 100 });
        const flat = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport({ cited: 1, uncited: 2 }),
            trace: flatTrace(hash),
            usage: usage(2, 900),
            profileSnapshot: snapshotProfile('baseline-flat-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });
        const dag = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport({ cited: 3, uncited: 1 }),
            trace: contextTrace(hash, { unresolved: 2 }),
            usage: usage(2, 1100),
            profileSnapshot: snapshotProfile('context-tree-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });
        const summarized = computeVariantScorecard({
            evidencePackage: cloneEvidencePackage(LAB_FIXTURE),
            report: variantReport({ cited: 3, uncited: 1 }),
            trace: { ...contextTrace(hash, { unresolved: 2 }), profileId: 'context-tree-summarized-v1' },
            usage: usage(6, 1900),
            profileSnapshot: snapshotProfile('context-tree-summarized-v1', { codeRevision: 'test-rev' }),
            evidencePackageHash: hash,
        });
        return { flat, dag, summarized, hash };
    }

    test('deltas are labeled differences with no winner', () => {
        const { flat, dag } = scorecards();
        const delta = describeVariantDelta(flat, dag);

        expect(delta).toMatchObject({ from: 'baseline-flat-v1', to: 'context-tree-v1' });
        expect(delta.deltas).toContain('2 more report findings with valid citations');
        expect(delta.deltas).toContain('2 unresolved branches');
        expect(delta.deltas).toContain('200 more total tokens');
        expect(JSON.stringify(delta).toLowerCase()).not.toMatch(/winner|wins|better/);
    });

    test('view model separates flat-to-DAG from DAG-to-summaries plus incremental summary cost', () => {
        const { flat, dag, summarized, hash } = scorecards();
        const experiment = {
            evidencePackageHash: hash,
            status: 'complete',
            comparison: { inputHashMatches: true },
            variants: {
                'baseline-flat-v1': { deterministicScorecard: flat },
                'context-tree-v1': { deterministicScorecard: dag },
                'context-tree-summarized-v1': { deterministicScorecard: summarized },
            },
        };
        const viewModel = buildComparisonViewModel(experiment);

        expect(viewModel.flatToDag.from).toBe('baseline-flat-v1');
        expect(viewModel.flatToDag.to).toBe('context-tree-v1');
        expect(viewModel.dagToSummarized.from).toBe('context-tree-v1');
        expect(viewModel.dagToSummarized.to).toBe('context-tree-summarized-v1');
        // DAG→summaries reports are identical here, so the delta is cost-only.
        expect(viewModel.dagToSummarized.deltas).toContain('800 more total tokens');
        expect(viewModel.dagToSummarized.deltas).toContain('4 more model calls');
        expect(viewModel.summaryIncrementalCost).toMatchObject({
            calls: 4,
            totalTokens: 800,
            elapsedMs: 400,
        });
    });
});
