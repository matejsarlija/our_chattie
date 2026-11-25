const {
    stratifyClusterEntries,
    computeStratificationQuotas,
    STRAT_BUDGET_DEFAULT
} = require('../court-analysis/utils/stratify');

let nextIndex = 0;
function entry(date, title) {
    const index = nextIndex;
    nextIndex += 1;
    return {
        index,
        caseNumber: 'ST-2/2013',
        caseInfo: { caseNumber: 'ST-2/2013', title, date },
        documentLinks: [{ url: `https://x/${index}`, text: `${title}.pdf` }],
        acquisition: { mode: 'csv-export', currentPage: 1 }
    };
}

beforeEach(() => { nextIndex = 0; });

function datedRange(count, startYear, titleFn, spanYears = 1) {
    return Array.from({ length: count }, (_, i) => {
        const year = startYear + Math.floor((i * spanYears) / count);
        const month = String((i % 12) + 1).padStart(2, '0');
        return entry(`${year}-${month}-15`, titleFn(i));
    });
}

function fixedEntry(index, date, title, links = true) {
    return {
        index,
        caseNumber: 'ST-2/2013',
        caseInfo: { caseNumber: 'ST-2/2013', title, date },
        documentLinks: links ? [{ url: `https://x/fixed-${index}`, text: `${title}.pdf` }] : [],
        acquisition: { mode: 'csv-export', currentPage: 1 }
    };
}

describe('stratifyClusterEntries (TS-2 allocator)', () => {
    test('computes proportional quotas and defaults to the balanced 100-entry budget', () => {
        expect(computeStratificationQuotas(100)).toEqual({
            origin: 15,
            recent: 40,
            exploratory: 8,
            adminCap: 8
        });
        expect(computeStratificationQuotas(40)).toEqual({
            origin: 8,
            recent: 22,
            exploratory: 3,
            adminCap: 4
        });
        expect(computeStratificationQuotas(200)).toEqual({
            origin: 30,
            recent: 80,
            exploratory: 16,
            adminCap: 16
        });
        expect(STRAT_BUDGET_DEFAULT).toBe(100);
        const pool = datedRange(120, 2010, (i) => `Rješenje ${i}`, 14);
        const result = stratifyClusterEntries(pool);
        expect(result.entries).toHaveLength(100);
        expect(result.entries.filter((e) => e.acquisition.stratum === 'origin')).toHaveLength(15);
        expect(result.entries.filter((e) => e.acquisition.stratum === 'recent')).toHaveLength(40);
    });

    test('under-budget pools pass through untouched with no tags', () => {
        const pool = datedRange(12, 2020, (i) => `Podnesak ${i}`);
        const result = stratifyClusterEntries(pool, { budget: 40 });

        expect(result.capped).toBe(false);
        expect(result.entries).toHaveLength(12);
        expect(result.entries.every((e) => e.acquisition.stratum === undefined)).toBe(true);
        expect(result.ledger.selected).toBe(12);
        expect(result.ledger.insufficient).toBe(false);
    });

    test('over-budget pools split into origin/recent/middle with disjoint picks', () => {
        const pool = [
            ...datedRange(10, 2013, () => 'Podnesak stari', 2),
            ...datedRange(10, 2018, (i) => (i % 2 === 0 ? `Rješenje ${i}` : `Ugovor o ustupu ${i}`), 2),
            ...datedRange(30, 2024, (i) => `Podnesak novi ${i}`, 2)
        ];
        const result = stratifyClusterEntries(pool, { budget: 40 });

        expect(result.capped).toBe(true);
        expect(result.entries).toHaveLength(40);
        const strata = result.entries.map((e) => e.acquisition.stratum);
        expect(strata.filter((s) => s === 'origin')).toHaveLength(computeStratificationQuotas(40).origin);
        expect(strata.filter((s) => s === 'recent')).toHaveLength(computeStratificationQuotas(40).recent);
        expect(strata).toContain('middle');
        // Disjoint: every picked entry is unique.
        const identities = result.entries.map((e) => e.documentLinks[0].url);
        expect(new Set(identities).size).toBe(40);
        // Sampling vocabulary preserved for provenance consumers.
        expect(result.entries.filter((e) => e.acquisition.sampling === 'tail')).toHaveLength(computeStratificationQuotas(40).origin);
        expect(result.entries.filter((e) => e.acquisition.sampling === 'forward')).toHaveLength(computeStratificationQuotas(40).recent);
    });

    test('ledger documents are never dropped when they fit', () => {
        const pool = [
            fixedEntry(0, '2025-03-01', 'Diobeni popis'),
            fixedEntry(1, '2025-02-01', 'Završni račun'),
            ...datedRange(60, 2015, (i) => `Podnesak ${i + 2}`, 10)
        ];
        const result = stratifyClusterEntries(pool, { budget: 40 });
        const titles = result.entries.map((e) => e.caseInfo.title);

        expect(titles).toContain('Diobeni popis');
        expect(titles).toContain('Završni račun');
        expect(result.ledger.perRole.ledger).toEqual(expect.objectContaining({ available: 2, selected: 2 }));
    });

    test('ledger overflow names every excluded vital document', () => {
        const pool = Array.from({ length: 45 }, (_, i) =>
            fixedEntry(100 + i, `2025-${String((i % 9) + 1).padStart(2, '0')}-01`, `Diobeni popis ${i}`));
        const result = stratifyClusterEntries(pool, { budget: 40 });

        expect(result.entries).toHaveLength(40);
        expect(result.ledger.insufficient).toBe(true);
        expect(result.ledger.excludedVital).toHaveLength(5);
        expect(result.ledger.excludedVital[0]).toEqual(expect.objectContaining({ title: expect.any(String) }));
    });

    test('exploratory floor serves ambiguous titles even when middle years are rich', () => {
        const pool = [
            ...datedRange(50, 2018, (i) => `Rješenje ${i}`, 3),
            fixedEntry(500, '2020-05-05', 'Prilog'),
            fixedEntry(501, '2021-06-06', 'Prilog')
        ];
        const result = stratifyClusterEntries(pool, { budget: 40 });
        const exploratory = result.entries.filter((e) => e.acquisition.stratum === 'exploratory');

        expect(exploratory.length).toBeGreaterThanOrEqual(1);
        expect(exploratory.length).toBeLessThanOrEqual(computeStratificationQuotas(40).exploratory);
    });
    test('samples exploratory entries evenly across the ambiguous pool', () => {
        const pool = [
            ...datedRange(30, 2018, (i) => `Rješenje ${i}`, 3),
            ...Array.from({ length: 40 }, (_, i) =>
                fixedEntry(900 + i, new Date(Date.UTC(2020, 0, i + 1)).toISOString().slice(0, 10), `Prilog ${i}`))
        ];
        const result = stratifyClusterEntries(pool, { budget: 40 });
        const exploratory = result.entries
            .filter((e) => e.acquisition.stratum === 'exploratory')
            .map((e) => Number(e.caseInfo.title.slice('Prilog '.length)));

        expect(exploratory).toHaveLength(3);
        expect(exploratory[0]).toBeGreaterThan(0);
        expect(exploratory[1] - exploratory[0]).toBeGreaterThan(1);
        expect(exploratory[2] - exploratory[1]).toBeGreaterThan(1);
        expect(exploratory[2]).toBeLessThan(39);
    });


    test('admin filings are capped and fill last', () => {
        const pool = [
            ...datedRange(34, 2024, (i) => `Podnesak ${i}`, 2),
            ...Array.from({ length: 10 }, (_, i) => fixedEntry(600 + i, `2024-${String((i % 9) + 1).padStart(2, '0')}-01`, `Punomoć ${i}`))
        ];
        const result = stratifyClusterEntries(pool, { budget: 40 });
        const admins = result.entries.filter((e) => e.caseInfo.title.startsWith('Punomoć'));

        expect(admins.length).toBeLessThanOrEqual(computeStratificationQuotas(40).adminCap);
    });

    test('admin cap applies across origin, recent, spread, and remainder selection', () => {
        const pool = Array.from({ length: 50 }, (_, i) =>
            fixedEntry(800 + i, `2024-${String((i % 9) + 1).padStart(2, '0')}-01`, `Punomoć ${i}`));
        const result = stratifyClusterEntries(pool, { budget: 40 });

        expect(result.entries).toHaveLength(computeStratificationQuotas(40).adminCap);
        expect(result.entries.every((e) => e.caseInfo.title.startsWith('Punomoć'))).toBe(true);
    });

    test('coverage ledger names gap years and undated entries', () => {
        const pool = [
            ...datedRange(30, 2024, (i) => `Podnesak ${i}`),
            fixedEntry(700, '2016-01-01', 'Rješenje staro'),
            { index: 701, caseNumber: 'ST-2/2013', caseInfo: { caseNumber: 'ST-2/2013', title: 'Bez datuma', date: 'N/A' }, documentLinks: [], acquisition: {} }
        ];
        const result = stratifyClusterEntries(pool, { budget: 40 });

        // 32 entries < 40 budget: everything taken, no gaps.
        expect(result.ledger.gaps).toEqual([]);
        const tight = stratifyClusterEntries(pool, { budget: 5 });
        expect(tight.entries).toHaveLength(5);
        expect(tight.ledger.gaps.length).toBeGreaterThan(0);
        expect(tight.ledger.perYear['2024']).toEqual(expect.objectContaining({ available: 30 }));
    });
});
