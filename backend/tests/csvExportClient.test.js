const path = require('path');
const fs = require('fs');
const {
    CsvExportClient,
    CsvExportError,
    computeCourtEntryCap,
    applyBounding,
    applyPrimaryBalancedSelection
} = require('../scraper/csvExportClient');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'csv-export');

function fixtureText(name) {
    return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

function makeClient(fixtureName) {
    return new CsvExportClient({ fetcher: async () => fixtureText(fixtureName) });
}

const CSV_COLUMNS = [
    'Oznaka spisa',
    'Naslov',
    'Sud',
    'Oglas (link)',
    'Dokumenti (link)',
    'Početni dan objave',
    'OIB stečajnog dužnika',
    'Sudionici'
];

function makeCsv(rows) {
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [CSV_COLUMNS.map(quote).join(',')];
    for (const row of rows) {
        lines.push(CSV_COLUMNS.map((column) => quote(row[column])).join(','));
    }
    return `${lines.join('\n')}\n`;
}

function makeCourtEntryRow(index, overrides = {}) {
    const link = `https://example.invalid/objave/entry-${index}`;
    return {
        'Oznaka spisa': `St-${index}/2026`,
        'Naslov': `Entry ${index}`,
        'Sud': 'Sud',
        'Oglas (link)': link,
        'Dokumenti (link)': overrides.document === false ? '' : `${link}/dokumenti/preuzimanje`,
        'Dokumenti (datoteke)': overrides.document === false ? '' : `Document-${index}.pdf P1P`,
        'Početni dan objave': '01.01.2026. 08:00:00',
        'OIB stečajnog dužnika': overrides.debtorOib ?? '66124057408',
        Sudionici: ''
    };
}

function makeCourtEntryCsv(count, rowOverrides = {}) {
    return makeCsv(Array.from({ length: count }, (_, index) => (
        makeCourtEntryRow(index + 1, typeof rowOverrides === 'function' ? rowOverrides(index + 1) : rowOverrides)
    )));
}

describe('computeCourtEntryCap', () => {
    test('a finite court-entry limit controls the total outright', () => {
        expect(computeCourtEntryCap(3, null, false)).toBe(3);
        expect(computeCourtEntryCap(0, null, false)).toBe(0);
        expect(computeCourtEntryCap(400, Infinity, false)).toBe(400);
    });

    test('null limit falls back to the standard entry count, expanded for a requested tail', () => {
        expect(computeCourtEntryCap(null, null, false)).toBe(30);
        expect(computeCourtEntryCap(null, null, true)).toBe(40);
    });

    test('explicit page budgets stay denominated by ten court entries per page', () => {
        expect(computeCourtEntryCap(null, 2, false)).toBe(20);
        expect(computeCourtEntryCap(null, 3, true)).toBe(40);
    });

    test('null limit plus an explicit full scan uses the defensive 400-entry ceiling', () => {
        expect(computeCourtEntryCap(null, Infinity, false)).toBe(400);
    });
});

describe('applyBounding', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({ n: i }));

    test('returns everything when the entry budget exceeds the list', () => {
        expect(applyBounding(entries.slice(0, 5), null, Infinity, false)).toHaveLength(5);
    });

    test('truncates to the standard court-entry budget when capped', () => {
        const result = applyBounding(entries, null, null, false);
        expect(result).toHaveLength(30);
        expect(result[0].n).toBe(0);
        expect(result[29].n).toBe(29);
    });

    test('reserves the oldest entries inside the balanced budget when tailSample is set', () => {
        const result = applyBounding(entries, null, null, true);
        expect(result).toHaveLength(40);
        expect(result[0].n).toBe(0); // newest first
        expect(result[29].n).toBe(29);
        expect(result[39].n).toBe(99); // oldest last
        expect(result[30].acquisition.sampling).toBe('tail');
    });

    test('does not add tail when tailSample is off', () => {
        const result = applyBounding(entries, 2, null, false);
        expect(result).toHaveLength(2);
    });

    test('keeps an unusually small budget on the newest entries', () => {
        const result = applyBounding(entries, 7, null, true);
        expect(result).toHaveLength(7);
        expect(result[0].n).toBe(0);
        expect(result[6].n).toBe(6);
        expect(result.every((entry) => entry.acquisition === undefined)).toBe(true);
    });
});

describe('applyPrimaryBalancedSelection', () => {
    function selectedEntries(count, caseNumber, { startDay = 1 } = {}) {
        return Array.from({ length: count }, (_, i) => ({
            caseNumber,
            caseInfo: {
                caseNumber,
                date: `2026-01-${String(startDay + (i % 27)).padStart(2, '0')}`,
                documentDownloadLink: `https://example.invalid/${caseNumber}/${i}`
            },
            documentLinks: [{ url: `https://example.invalid/${caseNumber}/${i}` }],
            acquisition: { mode: 'csv-export', currentPage: 1 }
        }));
    }

    test('splits the budget into forward newest + tail oldest of the selected key', () => {
        const entries = [
            ...selectedEntries(50, 'ST-2/2013'),
            ...selectedEntries(20, 'ST-9/2019')
        ];
        const result = applyPrimaryBalancedSelection(entries, 40, { type: 'oib', value: '66124057408' });

        expect(result.selection.selectedCaseKey).toBe('ST-2/2013');
        expect(result.entries).toHaveLength(40);
        expect(result.capped).toBe(true);
        expect(result.entries.every((entry) => entry.caseNumber === 'ST-2/2013')).toBe(true);
        expect(result.entries.slice(0, 30).every((entry) => entry.acquisition.sampling === 'forward')).toBe(true);
        expect(result.entries.slice(30).every((entry) => entry.acquisition.sampling === 'tail')).toBe(true);
        // Disjoint: no entry object serves both windows.
        const identities = result.entries.map((entry) => entry.caseInfo.documentDownloadLink);
        expect(new Set(identities).size).toBe(40);
    });

    test('tight env-style caps shrink the tail first, then the forward window', () => {
        const entries = [
            ...selectedEntries(50, 'ST-2/2013'),
            ...selectedEntries(20, 'ST-9/2019')
        ];
        const small = applyPrimaryBalancedSelection(entries, 35, null);
        expect(small.entries).toHaveLength(35);
        expect(small.entries.filter((e) => e.acquisition.sampling === 'tail')).toHaveLength(5);

        const tiny = applyPrimaryBalancedSelection(entries, 7, null);
        expect(tiny.entries).toHaveLength(7);
        expect(tiny.entries.every((e) => e.acquisition.sampling === 'forward')).toBe(true);
    });

    test('at-or-under-budget selected cases pass through unchanged with no markers', () => {
        const entries = [
            ...selectedEntries(10, 'ST-2/2013'),
            ...selectedEntries(5, 'ST-9/2019')
        ];
        const result = applyPrimaryBalancedSelection(entries, 40, null);

        expect(result.capped).toBe(false);
        expect(result.entries).toHaveLength(10);
        expect(result.entries.every((entry) => entry.acquisition.sampling === undefined)).toBe(true);
        expect(result.selection.unboundedEntryCount).toBe(15);
        expect(result.selection.primaryEntryCount).toBe(10);
    });

    test('unkeyed entries are counted and left untaken', () => {
        const entries = [
            ...selectedEntries(45, 'ST-2/2013'),
            { caseInfo: { caseNumber: 'N/A', documentDownloadLink: 'https://example.invalid/x' }, documentLinks: [] }
        ];
        const result = applyPrimaryBalancedSelection(entries, 40, null);

        expect(result.selection.unkeyedEntries).toBe(1);
        expect(result.entries.every((entry) => entry.caseNumber === 'ST-2/2013')).toBe(true);
    });
});

describe('CsvExportClient', () => {
    test('builds the export URL with desc sort', () => {
        const client = makeClient('oib-66124057408.csv');
        expect(client.buildExportUrl('66124057408')).toBe(
            'https://e-oglasna.pravosudje.hr/objave/izvoz/csv?text=66124057408&sort=datePublished%2Cdesc'
        );
    });

    test('init/close are resolved no-ops', async () => {
        const client = makeClient('oib-66124057408.csv');
        await expect(client.init()).resolves.toBeUndefined();
        await expect(client.close()).resolves.toBeUndefined();
    });

    test('searchAndGetLatestCasesWithDocuments returns the pipeline contract', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', null, null, false);

        expect(result.discoveryMetadata.discoveryMode).toBe('csv-export');
        expect(result.discoveryMetadata.totalResults).toBe(381);
        expect(result.discoveryMetadata.hasNextPage).toBe(false);
        expect(result.discoveryMetadata.acquisitionModes).toEqual(['csv-export']);
        expect(result.discoveryMetadata.csv.rowCount).toBe(381);

        // Standard court-entry budget — bounded, not the full 381.
        expect(result.casesToProcess).toHaveLength(30);
        expect(result.discoveryMetadata.rawParsedEntryCount).toBe(30);
        expect(result.casesToProcess[0].acquisition.mode).toBe('csv-export');
        expect(result.casesToProcess[0].caseInfo.caseNumber).toBe('ST-2/2013');
    });

    test('tailSample appends oldest entries (balanced depth)', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', null, null, true);
        expect(result.casesToProcess).toHaveLength(40);
        expect(result.casesToProcess[30].acquisition.sampling).toBe('tail');
    });

    test('balanced tail belongs to the selected primary case, not global side-cases (T0-1)', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408', 40, 3, true, '66124057408', { type: 'oib', value: '66124057408' }
        );
        const keys = result.casesToProcess.map((entry) => entry.caseInfo.caseNumber);

        // Forward 30 + tail 10, all ST-2/2013: the 2016–2018 side-cases that the
        // old global tail returned are present in the metadata but untaken.
        expect(result.casesToProcess).toHaveLength(40);
        expect(new Set(keys)).toEqual(new Set(['ST-2/2013']));
        expect(result.casesToProcess.slice(0, 30).every((entry) => entry.acquisition.sampling === 'forward')).toBe(true);
        expect(result.casesToProcess.slice(30).every((entry) => entry.acquisition.sampling === 'tail')).toBe(true);
        expect(result.discoveryMetadata.selection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-2/2013',
            rule: 'primary-case-balanced'
        }));
        expect(result.discoveryMetadata.selection.candidates.map((c) => c.key)).toContain('ST-357/2013');
    });

    test('case_number query selects that case even when it is the smaller group (T0-1)', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments(
            'ST-357/2013', null, null, true, null, { type: 'case_number', value: 'ST-357/2013' }
        );

        // ST-357/2013 fits the budget: passes through untaken-secondaries style,
        // with the selection naming the queried key.
        expect(result.discoveryMetadata.selection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-357/2013',
            method: 'case-number-query'
        }));
        expect(result.casesToProcess.length).toBeGreaterThan(0);
        expect(result.casesToProcess.every((entry) => entry.caseInfo.caseNumber === 'ST-357/2013')).toBe(true);
    });

    test('standard path keeps the global window but still discloses the selection (T0-1)', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', null, null, false);

        expect(result.casesToProcess).toHaveLength(30);
        expect(result.discoveryMetadata.selection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-2/2013',
            rule: 'global'
        }));
    });

    test('a finite limit bounds the forward window', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', 2, null, false);
        expect(result.casesToProcess).toHaveLength(2);
    });

    test('filters OIB queries by debtor OIB before document and entry-count handling', async () => {
        const identityCsv = makeCsv([
            makeCourtEntryRow(1, { debtorOib: '66124057408' }),
            makeCourtEntryRow(2, { debtorOib: '12345678901' }),
            makeCourtEntryRow(3, { debtorOib: '66124057408', document: false })
        ]);
        const client = new CsvExportClient({ fetcher: async () => identityCsv });

        const filtered = await client.searchAndGetLatestCases('66124057408', null, Infinity, false, '66124057408');
        expect(filtered.casesToProcess).toHaveLength(2);
        expect(filtered.casesToProcess.map((entry) => entry.caseInfo.debtorOib)).toEqual([
            '66124057408',
            '66124057408'
        ]);

        const documents = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408',
            null,
            Infinity,
            false,
            '66124057408'
        );
        expect(documents.casesToProcess).toHaveLength(1);
        expect(documents.casesToProcess[0].caseInfo.debtorOib).toBe('66124057408');

        const unfiltered = await client.searchAndGetLatestCases('66124057408', null, Infinity, false, null);
        expect(unfiltered.casesToProcess).toHaveLength(3);

        const nonMatching = await client.searchAndGetLatestCases('66124057408', null, Infinity, false, '00000000000');
        expect(nonMatching.casesToProcess).toHaveLength(0);
    });

    test('returns inputs at or under the court-entry budget unchanged, without a separate tail', async () => {
        const thirty = new CsvExportClient({ fetcher: async () => makeCourtEntryCsv(30) });
        const exactThirty = await thirty.searchAndGetLatestCases('query', 30, 3, false, null);
        expect(exactThirty.casesToProcess).toHaveLength(30);
        expect(exactThirty.casesToProcess.every((entry) => entry.acquisition.sampling === undefined)).toBe(true);

        const balanced = new CsvExportClient({ fetcher: async () => makeCourtEntryCsv(40) });
        const exactForty = await balanced.searchAndGetLatestCases('query', 40, 3, true, null);
        expect(exactForty.casesToProcess).toHaveLength(40);
        expect(exactForty.casesToProcess.every((entry) => entry.acquisition.sampling === undefined)).toBe(true);

        const standard = new CsvExportClient({ fetcher: async () => makeCourtEntryCsv(29) });
        const underThirty = await standard.searchAndGetLatestCases('query', 30, 3, false, null);
        expect(underThirty.casesToProcess).toHaveLength(29);

        const smallBalanced = new CsvExportClient({ fetcher: async () => makeCourtEntryCsv(35) });
        const underForty = await smallBalanced.searchAndGetLatestCases('query', 40, 3, true, null);
        expect(underForty.casesToProcess).toHaveLength(35);
        expect(underForty.casesToProcess.every((entry) => entry.acquisition.sampling === undefined)).toBe(true);
    });

    test('truncates a full scan to exactly 400 court entries', async () => {
        const full = new CsvExportClient({ fetcher: async () => makeCourtEntryCsv(401) });
        const result = await full.searchAndGetLatestCases('query', 400, Infinity, false, null);

        expect(result.casesToProcess).toHaveLength(400);
        expect(result.casesToProcess[0].caseInfo.title).toBe('Entry 1');
        expect(result.casesToProcess[399].caseInfo.title).toBe('Entry 400');
        expect(result.discoveryMetadata.rawParsedEntryCount).toBe(400);
    });

    test('full scan (maxPages Infinity) returns the complete set', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCasesWithDocuments('66124057408', null, Infinity, false);
        expect(result.casesToProcess).toHaveLength(381);
    });

    test('searchAndGetLatestCases returns entries without the document filter', async () => {
        const client = makeClient('oib-66124057408.csv');
        const result = await client.searchAndGetLatestCases('66124057408', null, null, false);
        expect(result.casesToProcess).toHaveLength(30);
    });

    test('does not expose cluster-expansion follow-up methods', () => {
        const client = makeClient('oib-66124057408.csv');
        expect(typeof client.searchCaseNumberFollowUp).toBe('undefined');
        expect(typeof client.followDetailLinks).toBe('undefined');
    });

    test('throws CsvExportError(network) when the fetch fails', async () => {
        const client = new CsvExportClient({ fetcher: async () => { throw new Error('boom'); } });
        await expect(client.searchAndGetLatestCases('x')).rejects.toMatchObject({ name: 'CsvExportError', reason: 'network' });
    });

    test('throws CsvExportError(schema-drift) on a non-CSV body', async () => {
        const client = makeClient('broken-not-csv.csv');
        await expect(client.searchAndGetLatestCases('x')).rejects.toMatchObject({ name: 'CsvExportError', reason: 'schema-drift' });
    });

    test('throws CsvExportError(schema-drift) with missing columns detail', async () => {
        const client = makeClient('drift-missing-oib-column.csv');
        await expect(client.searchAndGetLatestCases('x')).rejects.toMatchObject({
            name: 'CsvExportError',
            reason: 'schema-drift',
            detail: { missingColumns: expect.arrayContaining(['OIB stečajnog dužnika']) }
        });
    });

    test('throws CsvExportError(empty) on a blank body', async () => {
        const client = new CsvExportClient({ fetcher: async () => '  ' });
        await expect(client.searchAndGetLatestCases('x')).rejects.toMatchObject({ name: 'CsvExportError', reason: 'empty' });
    });
});
