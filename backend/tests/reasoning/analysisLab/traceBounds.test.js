// backend/tests/reasoning/analysisLab/traceBounds.test.js
//
// LQ-2 — trace-size, redaction, and failure-mode guards (unit lane).
//
// Persisted records stay complete; only API responses are bounded. Every
// cut records a truncation reason, failure text stays capped, and no stack
// or provider payload travels in a partial/error record.

const {
    TRACE_BOUNDS,
    boundTrace,
    boundExperimentForResponse,
} = require('../../../court-analysis/reasoning/analysisLab/traceBounds');

function oversizedTrace() {
    return {
        profileId: 'context-tree-summarized-v1',
        strategy: 'case-context',
        baseline: false,
        rootId: 'cn-root',
        selection: {
            selected: Array.from({ length: 300 }, (_, index) => ({
                nodeId: `cn-node-${index}`,
                kind: index % 3 === 0 ? 'unresolved' : 'claim-thread',
                factIds: Array.from({ length: 80 }, (_, fact) => `fact-${index}-${fact}`),
            })),
            omitted: Array.from({ length: 150 }, (_, index) => ({
                nodeId: `cn-omitted-${index}`,
                reason: 'context-node-budget-exhausted',
                detail: 'x'.repeat(2000),
            })),
        },
        summaries: {
            enabled: true,
            stats: { eligible: 300, attempted: 4, completed: 3, partial: 1, calls: 4 },
            outcomes: Array.from({ length: 120 }, (_, index) => ({
                nodeId: `cn-node-${index}`,
                status: index === 0 ? 'partial' : 'complete',
                reason: 'call-failed',
                detail: 'y'.repeat(1500),
                accepted: 0,
                rejected: 0,
                calls: 1,
            })),
            omitted: [],
            droppedDerived: [],
        },
        dag: {
            selections: Array.from({ length: 150 }, (_, index) => ({ nodeId: `cn-node-${index}`, reason: 'rule' })),
            links: Array.from({ length: 500 }, (_, index) => ({ factIds: [`a-${index}`, `b-${index}`], basis: 'x', united: true })),
            stats: { facts: 500, sources: 60, periods: 3, threads: 300, unresolved: 100 },
        },
        claims: { flat: 9, branch: 300, derived: 5 },
    };
}

describe('boundTrace (LQ-2)', () => {
    test('oversized trace is bounded with a recorded truncation reason', () => {
        const { trace, truncated, reasons } = boundTrace(oversizedTrace());

        expect(truncated).toBe(true);
        expect(reasons.length).toBeGreaterThan(0);
        expect(trace.selection.selected).toHaveLength(TRACE_BOUNDS.maxSelectedNodes);
        expect(trace.selection.selected[0].factIds).toHaveLength(TRACE_BOUNDS.maxIdsPerNode);
        expect(trace.selection.omitted).toHaveLength(TRACE_BOUNDS.maxOmittedEntries);
        expect(trace.summaries.outcomes).toHaveLength(TRACE_BOUNDS.maxSummaryOutcomes);
        expect(trace.dag.selections).toHaveLength(TRACE_BOUNDS.maxDagSelections);
        expect(trace.dag.links).toHaveLength(TRACE_BOUNDS.maxDagLinks);
        // Long text fields are cut, counts are not.
        expect(trace.selection.omitted[0].detail.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxReasonChars + 1);
        expect(trace.summaries.outcomes[0].detail.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxReasonChars + 1);
        expect(trace.claims).toMatchObject({ flat: 9, branch: 300, derived: 5 });
        expect(trace.responseBounds).toMatchObject({ truncated: true });
        expect(trace.responseBounds.reasons.length).toBeGreaterThan(0);
    });

    test('small traces pass through untouched with truncated=false', () => {
        const small = {
            profileId: 'baseline-flat-v1',
            strategy: 'flat',
            baseline: true,
            claims: { flat: 9, branch: 0, derived: 0 },
        };
        const { trace, truncated, reasons } = boundTrace(small);

        expect(truncated).toBe(false);
        expect(reasons).toEqual([]);
        expect(trace.claims).toMatchObject({ flat: 9, branch: 0, derived: 0 });
        expect(trace.responseBounds).toMatchObject({ truncated: false, reasons: [] });
    });

    test('bounding never mutates the input trace', () => {
        const original = oversizedTrace();
        const selectedBefore = original.selection.selected.length;
        boundTrace(original);
        expect(original.selection.selected).toHaveLength(selectedBefore);
        expect(original.selection.omitted[0].detail).toHaveLength(2000);
    });
});

describe('boundExperimentForResponse (LQ-2)', () => {
    test('failure text is capped and stack carriers are dropped', () => {
        const experiment = {
            id: 'e1',
            status: 'partial',
            variants: {
                'baseline-flat-v1': { status: 'complete', report: { findings: [] }, trace: { profileId: 'baseline-flat-v1' }, usage: {} },
                'context-tree-v1': {
                    status: 'error',
                    errorCode: 'variant-error',
                    errorMessage: `boom ${'x'.repeat(5000)}\n    at providerInternal (/sdk/model.js:10:5)\n    at run (/sdk/client.js:2:1)`,
                    stack: 'Error: boom\n    at providerInternal (/sdk/model.js:10:5)',
                    stackTrace: ['providerInternal (/sdk/model.js:10:5)'],
                },
            },
        };

        const bounded = boundExperimentForResponse(experiment);

        const failed = bounded.variants['context-tree-v1'];
        expect(failed.errorMessage.length).toBeLessThanOrEqual(TRACE_BOUNDS.maxErrorChars + 1);
        expect(failed).not.toHaveProperty('stack');
        expect(failed).not.toHaveProperty('stackTrace');
        expect(JSON.stringify(failed)).not.toMatch(/providerInternal/);
        // The successful variant and its report travel intact.
        expect(bounded.variants['baseline-flat-v1'].report).toEqual({ findings: [] });
        // The persisted-side input is untouched.
        expect(experiment.variants['context-tree-v1'].errorMessage).toContain('providerInternal');
    });

    test('reports, scorecards, and snapshots are never truncated', () => {
        const experiment = {
            id: 'e1',
            status: 'complete',
            variants: {
                'baseline-flat-v1': {
                    status: 'complete',
                    report: { findings: Array.from({ length: 50 }, (_, i) => ({ text: `finding ${i}` })) },
                    trace: oversizedTrace(),
                    usage: { calls: 3 },
                    deterministicScorecard: { version: 1 },
                    profileSnapshot: { id: 'baseline-flat-v1' },
                },
            },
        };

        const bounded = boundExperimentForResponse(experiment);
        const variant = bounded.variants['baseline-flat-v1'];
        expect(variant.report.findings).toHaveLength(50);
        expect(variant.deterministicScorecard).toEqual({ version: 1 });
        expect(variant.profileSnapshot).toEqual({ id: 'baseline-flat-v1' });
        expect(variant.trace.selection.selected).toHaveLength(TRACE_BOUNDS.maxSelectedNodes);
    });
});
