const fs = require('fs');
const path = require('path');
const { CsvExportClient } = require('../scraper/csvExportClient');
const { stratifyClusterEntries } = require('../court-analysis/utils/stratify');
const { classifyDocRole } = require('../court-analysis/utils/docRoles');

function fixtureText() {
    return fs.readFileSync(path.join(__dirname, 'fixtures', 'csv-export', 'oib-66124057408.csv'), 'utf8');
}

describe('TS-2 Kerum stratification (real export fixture)', () => {
    let pool;
    let result;

    beforeAll(async () => {
        const client = new CsvExportClient({ fetcher: async () => fixtureText() });
        const discovered = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408', 40, 3, true, '66124057408', { type: 'oib', value: '66124057408' }
        );
        pool = discovered.casesToProcess;
        result = stratifyClusterEntries(pool, { budget: 40 });
    });

    test('the whole selected case is discovered, 40 are allocated', () => {
        expect(pool.length).toBeGreaterThan(40);
        expect(new Set(pool.map((e) => e.caseInfo.caseNumber))).toEqual(new Set(['ST-2/2013']));
        expect(result.entries).toHaveLength(40);
        expect(result.capped).toBe(true);
        const identities = result.entries.map((e) => e.caseInfo.detailLink);
        expect(new Set(identities).size).toBe(40);
    });

    test('origin holds the oldest filings, recent the newest', () => {
        const byDate = [...pool].sort((a, b) => (a.caseInfo.date < b.caseInfo.date ? -1 : 1));
        const oldest = byDate[0].caseInfo.date;
        const newest = byDate[byDate.length - 1].caseInfo.date;
        const origins = result.entries.filter((e) => e.acquisition.stratum === 'origin');
        const recents = result.entries.filter((e) => e.acquisition.stratum === 'recent');

        expect(origins.length).toBeGreaterThan(0);
        expect(origins.map((e) => e.caseInfo.date)).toContain(oldest);
        expect(recents.map((e) => e.caseInfo.date)).toContain(newest);
        expect(origins.every((e) => e.acquisition.sampling === 'tail')).toBe(true);
        expect(recents.every((e) => e.acquisition.sampling === 'forward')).toBe(true);
    });

    test('at least one middle-year decision or transfer witnesses the chain years', () => {
        const poolDates = pool.map((e) => e.caseInfo.date).filter(Boolean).sort();
        const firstYear = Number(poolDates[0].slice(0, 4));
        const lastYear = Number(poolDates[poolDates.length - 1].slice(0, 4));
        const middles = result.entries.filter((e) => e.acquisition.stratum === 'middle');

        expect(middles.length).toBeGreaterThanOrEqual(1);
        for (const entry of middles) {
            const year = Number(String(entry.caseInfo.date).slice(0, 4));
            const role = classifyDocRole({ caseInfo: { title: entry.caseInfo.title }, documentLinks: entry.documentLinks });
            expect(year).toBeGreaterThan(firstYear);
            expect(year).toBeLessThan(lastYear);
            expect(['decision', 'transfer']).toContain(role);
        }
    });

    test('ledger documents are all included, never dropped', () => {
        const ledgerPool = pool.filter((e) => classifyDocRole({
            caseInfo: { title: e.caseInfo.title },
            documentLinks: e.documentLinks
        }) === 'ledger');
        expect(ledgerPool.length).toBeGreaterThan(0);
        const picked = new Set(result.entries.map((e) => e.caseInfo.detailLink));
        for (const entry of ledgerPool) {
            expect(picked.has(entry.caseInfo.detailLink)).toBe(true);
        }
        expect(result.ledger.perRole.ledger).toEqual(expect.objectContaining({
            available: ledgerPool.length,
            selected: ledgerPool.length
        }));
    });

    test('coverage ledger accounts for the whole pool', () => {
        expect(result.ledger).toEqual(expect.objectContaining({
            budget: 40,
            available: pool.length,
            selected: 40,
            insufficient: false
        }));
        const roleTotals = Object.values(result.ledger.perRole)
            .reduce((sum, r) => sum + r.available, 0);
        expect(roleTotals).toBe(pool.length);
        expect(result.ledger.chainCandidates.transferEntries).toBeGreaterThan(0);
    });
});
