// Run-list summary projection (Phase 4, screen 1).
//
// Why this exists: the dashboard list is per-run, and the user needs to spot
// (a) WHICH case a row is, (b) whether to trust it, (c) how recent, (d) how
// big — at a glance. (b) and (d) live inside the run's `result_json`, which the
// list endpoint was shipping in full: ~120KB per run, ~2.75MB for a 10-row
// page. This module projects the four listable facts into a small summary that
// is stored once at completion, so the list response stays small.
//
// Fixture manifest:
// - The real Lab package fixture (kerum-lab.json) is the CANONICAL full shape:
//   identity.participantNames, coverage{analyzed,total,groundedClaims,...},
//   moneyFlow.entries[] with amountEur/amountEurSource/dualCurrency.
// - A real production run (e7139609) is the LEGACY shape: caseResult{caseNumber,
//   court, participants[]}, NO pkg.moneyFlow, NO analysis.coverage. Expected:
//   identity resolved, coverage/amounts null, no crash.
// - Empty/absent resultJson must never throw — "never fail a run" applies to
//   the summary path too, since a projection crash would fail a finished run.
// - coverage.failedFiles exists as OBJECTS in the current producer but as bare
//   STRINGS in the frozen replay fixture. A summary that dereferences
//   file.fileName must render `undefined` for the old shape; this asserts we
//   normalise instead.

const { buildRunSummary } = require('../court-analysis/utils/runSummary');

const LAB_PKG = require('./fixtures/replays/analysis-lab/kerum-lab.json');

// ── real production run shape (e7139609-dd9f-42a6-b3b6-b9e29fb9c92d) ────────
const LEGACY_RESULT = {
    processedCases: [{
        caseResult: {
            title: 'Podnesak od 17.06.2026.',
            caseNumber: 'ST-2/2013',
            court: 'Trgovački sud u Splitu',
            participants: [
                { name: 'KERUM d.o.o. u stečaju', oib: '66124057408', role: 'DUŽNIK' },
            ],
        },
        analysis: { individualAnalyses: [] },
        groupMetadata: {
            clusterId: 'ST-2/2013',
            primaryCaseNumber: 'ST-2/2013',
            entryCount: 10,
        },
    }],
    clusterEvidencePackage: { primaryCaseNumber: 'ST-2/2013' },
    report: { meta: {} },
};

describe('buildRunSummary — canonical full package', () => {
    // kerum-lab.json IS a ClusterEvidencePackage; a parsed result carries it
    // under `clusterEvidencePackage`, so wrap it the way a real run does.
    const summary = buildRunSummary({
        run: { id: 'lab', query_type: 'oib', query_value: '11111111111' },
        resultJson: { clusterEvidencePackage: LAB_PKG },
    });

    test('resolves the case number from the package', () => {
        expect(summary.caseNumber).toBe('St-2/2013');
    });

    test('resolves participant names and OIBs from package identity', () => {
        expect(summary.participantNames).toEqual(['PROKURATOR d.o.o.', 'COAST d.o.o.', 'CRO-GO d.o.o.']);
        expect(summary.participantOibs).toEqual(['11111111111', '22222222222', '33333333333']);
    });

    test('projects coverage counts and the grounding ratio', () => {
        expect(summary.coverage).toMatchObject({
            analyzed: 3,
            total: 4,
            failed: 1,
            groundedClaims: 5,
            totalClaims: 6,
        });
    });

    test('picks the largest EUR claim, not a sum of claims plus payments', () => {
        // The fixture entry is amount:1.200.000,00 EUR with NO amountEur — the
        // EUR-stated fallback must pick it up without any conversion.
        expect(summary.amounts.largestClaimEur).toBe(1200000);
        expect(summary.amounts.entryCount).toBe(1);
        // EUR-stated, so there is no separate source figure to disclose.
        expect(summary.amounts.largestClaimSource).toBeNull();
    });
});

describe('buildRunSummary — legacy run shape without coverage or moneyFlow', () => {
    const summary = buildRunSummary({
        run: { id: 'legacy', query_type: 'oib', query_value: '66124057408' },
        resultJson: LEGACY_RESULT,
    });

    test('still resolves case number, court and participants', () => {
        expect(summary.caseNumber).toBe('ST-2/2013');
        expect(summary.court).toBe('Trgovački sud u Splitu');
        expect(summary.participantNames).toEqual(['KERUM d.o.o. u stečaju']);
        expect(summary.participantOibs).toEqual(['66124057408']);
    });

    test('reports null coverage and null amounts rather than throwing', () => {
        expect(summary.coverage).toBeNull();
        expect(summary.amounts).toBeNull();
    });
});

describe('buildRunSummary — degraded and absent inputs', () => {
    test('missing resultJson does not throw', () => {
        const summary = buildRunSummary({ run: { id: 'x', query_type: 'oib', query_value: '66124057408' } });
        expect(summary.coverage).toBeNull();
        expect(summary.amounts).toBeNull();
    });

    test('null resultJson does not throw', () => {
        expect(() => buildRunSummary({ run: { id: 'x' }, resultJson: null })).not.toThrow();
    });

    test('falls back to query_value when it is a case number', () => {
        const summary = buildRunSummary({
            run: { id: 'x', query_type: 'case_number', query_value: 'Stč-2150/2022' },
        });
        expect(summary.caseNumber).toBe('Stč-2150/2022');
    });

    test('does not present a bare OIB as a case number', () => {
        const summary = buildRunSummary({
            run: { id: 'x', query_type: 'oib', query_value: '66124057408' },
        });
        expect(summary.caseNumber).toBeNull();
    });
});

describe('buildRunSummary — money semantics', () => {
    const wrap = (entries, extra = {}) => ({
        run: { id: 'x', query_type: 'oib', query_value: '1' },
        resultJson: { clusterEvidencePackage: { moneyFlow: { count: entries.length, entries, ...extra } } },
    });

    test('prefers a potraživanje over a larger obveza', () => {
        const summary = buildRunSummary(wrap([
            { amount: 5000000, amountEur: 5000000, direction: 'obveza' },
            { amount: 84500, amountEur: 84500, direction: 'potraživanje' },
        ]));
        expect(summary.amounts.largestClaimEur).toBe(84500);
    });

    test('a mixed-direction flow emits NO matter-level total', () => {
        // 5.000.000 obveza + 84.500 potraživanje must never become 5.084.500.
        const summary = buildRunSummary(wrap([
            { amount: 5000000, amountEur: 5000000, direction: 'obveza' },
            { amount: 84500, amountEur: 84500, direction: 'potraživanje' },
        ]));
        expect(summary.amounts.mixedDirections).toBe(true);
        expect(summary.amounts.singleDirection).toBeNull();
    });

    test('a single-direction flow is marked as such and may show a total', () => {
        const summary = buildRunSummary(wrap([
            { amount: 1200, amountEur: 1200, direction: 'potraživanje' },
            { amount: 300, amountEur: 300, direction: 'potraživanje' },
        ], { eurTotal: 1500 }));
        expect(summary.amounts.mixedDirections).toBe(false);
        expect(summary.amounts.singleDirection).toBe('potraživanje');
        expect(summary.amounts.eurTotal).toBe(1500);
    });

    test('records which directions are present, for the UI to explain itself', () => {
        const summary = buildRunSummary(wrap([
            { amount: 1, amountEur: 1, direction: 'obveza' },
            { amount: 2, amountEur: 2, direction: 'rejected' },
            { amount: 3, amountEur: 3, direction: 'netted' },
        ]));
        expect(summary.amounts.directionsPresent.sort()).toEqual(['netted', 'obveza', 'rejected']);
    });

    test('falls back to the largest EUR claim when no direction is set at all', () => {
        const summary = buildRunSummary(wrap([
            { amount: '248,86', amountEur: 248.86, direction: null },
            { amount: '1.200,00', amountEur: 1200, direction: null },
        ]));
        expect(summary.amounts.largestClaimEur).toBeNull();
        expect(summary.amounts.entryCount).toBe(2);
    });

    test('ignores entries with no determinable EUR value (never sums mixed currency)', () => {
        const summary = buildRunSummary(wrap([
            { amount: 177218.01, currency: 'HRK', amountEur: null, direction: 'potraživanje' },
            { amount: 1200, currency: 'EUR', amountEur: 1200, direction: 'potraživanje' },
        ]));
        expect(summary.amounts.largestClaimEur).toBe(1200);
        expect(summary.amounts.singleDirection).toBe('potraživanje');
    });

    test('discloses the source-stated figure when the headline claim was converted', () => {
        const summary = buildRunSummary(wrap([
            {
                amount: 177218.01, currency: 'HRK', amountEur: 23520.87,
                amountEurSource: 'converted', direction: 'potraživanje',
            },
        ]));
        expect(summary.amounts.largestClaimEur).toBe(23520.87);
        expect(summary.amounts.largestClaimSource).toEqual({ amount: 177218.01, currency: 'HRK' });
    });

    test('never reads a non-EUR raw amount — an HRK entry with no EUR value is dropped', () => {
        const summary = buildRunSummary(wrap([
            { amount: '9.084.692,55', currency: 'HRK', amountEur: undefined, direction: 'potraživanje' },
        ]));
        expect(summary.amounts.largestClaimEur).toBeNull();
        expect(summary.amounts.entryCount).toBe(1);
    });

    test('flags a dual-currency mismatch, which is a reconciliation finding', () => {
        const summary = buildRunSummary(wrap([
            {
                amount: 9084692.55, currency: 'HRK', amountEur: 1205850.44, direction: 'potraživanje',
                dualCurrency: { statedEur: 1205850.44, statedHrk: 9084692.55, deviationPct: 0.01 },
                currencyNote: 'dual-mismatch',
            },
        ]));
        expect(summary.amounts.dualCurrencyMismatch).toBe(true);
    });

    test('a dual-currency figure that agrees is not flagged', () => {
        const summary = buildRunSummary(wrap([
            { amount: 248.86, amountEur: 248.86, direction: 'potraživanje', dualCurrency: { deviationPct: 0 } },
        ]));
        expect(summary.amounts.dualCurrencyMismatch).toBe(false);
    });

    test('surfaces the backend eurTotal when it computed one', () => {
        const summary = buildRunSummary(wrap([{ amount: 1200, amountEur: 1200, direction: 'potraživanje' }], {
            eurTotal: 1200,
        }));
        expect(summary.amounts.eurTotal).toBe(1200);
    });
});

describe('buildRunSummary — coverage.failedFiles shape drift', () => {
    test('tolerates bare strings (frozen replay fixture) and objects (current producer)', () => {
        const strings = buildRunSummary({
            run: { id: 'a', query_type: 'oib', query_value: '1' },
            resultJson: { clusterEvidencePackage: { coverage: { analyzed: 57, failed: 2, total: 63, failedFiles: ['a.pdf', 'b.pdf'] } } },
        });
        const objects = buildRunSummary({
            run: { id: 'b', query_type: 'oib', query_value: '1' },
            resultJson: { clusterEvidencePackage: { coverage: { analyzed: 57, failed: 2, total: 63, failedFiles: [{ fileName: 'a.pdf' }, { fileName: 'b.pdf' }] } } },
        });
        expect(strings.coverage.failed).toBe(2);
        expect(objects.coverage.failed).toBe(2);
        expect(strings.coverage).toEqual(objects.coverage);
    });
});
