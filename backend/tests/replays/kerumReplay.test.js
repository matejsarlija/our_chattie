const replay = require('../fixtures/replays/kerum-66124057408.json');
const { collectFlows } = require('../../court-analysis/reasoning/flow');
const { reconcileFlows } = require('../../court-analysis/reasoning/reconciliation');

describe('Kerum production replay: report-quality acceptance criteria', () => {
    test('retains incomplete corpus and degraded-retrieval signals from the observed run', () => {
        expect(replay.coverage).toEqual(expect.objectContaining({
            analyzed: 57,
            failed: 6,
            total: 63,
            complete: false,
        }));
        expect(replay.retrieval).toEqual(expect.objectContaining({ rerankStatus: 'fallback' }));
        expect(replay.expectations.criticalFailedFiles.every((fileName) =>
            replay.coverage.failedFiles.includes(fileName)
        )).toBe(true);
    });

    test('describes a cross-currency contradiction with both source-stated amounts', () => {
        const result = reconcileFlows(collectFlows(replay.analyses));
        const [conflict] = result.conflicts;

        expect(result.conflicts).toHaveLength(1);
        expect(conflict).toEqual(expect.objectContaining({ kind: 'arithmetic' }));
        // A EUR-normalized comparison is useful, but reporting both values as
        // EUR hides the actual evidence and makes manual review impossible.
        expect(conflict.finding).toContain('355,134,652.87 HRK');
        expect(conflict.finding).toContain('≈ 47,134,468.49 EUR');
        expect(conflict.finding).toContain('355,134,652 EUR');
    });

    test('TR-1: no same-document totals leak into the user-facing question list', () => {
        const result = reconcileFlows(collectFlows(replay.analyses));
        expect(result.openQuestions.some((q) => String(q?.text || '').includes('Navodni ukupni iznos'))).toBe(false);
    });

    test('TD-3: the surviving question list holds no duplicate pairs', () => {
        const result = reconcileFlows(collectFlows(replay.analyses));
        const keys = result.openQuestions.map((q) => `${q?.kind || ''}::${String(q?.text || '')}`);
        expect(new Set(keys).size).toBe(keys.length);
    });
});
