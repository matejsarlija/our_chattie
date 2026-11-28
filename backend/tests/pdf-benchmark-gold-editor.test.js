'use strict';

const path = require('path');
const fs = require('fs');
const { normalizeGoldFacts, summarizeGold, factCount, resolveGoldTarget } = require('../scripts/lib/gold-editor');
const { createGoldSetId, extractDraftGoldFactsFromText, loadExistingGoldByDocId } = require('../scripts/build-gold-template');
const { selectCsvEntriesByRowNumbers } = require('../scripts/fetch-real-document-fixtures');

const valid = {
    amounts: [
        { rawValue: ' 1.234,56 ', currency: 'eur' },
        { rawValue: '99,00', currency: 'kn' },
        { rawValue: '', currency: '' },
    ],
    oibs: [
        { value: ' 12345678901 ', role: ' vjerovnik ' },
        { value: '98765432109', role: '' },
    ],
    dates: ['12.03.2024.', { value: ' 01.01.2025. ' }, ''],
    filingNumbers: ['St-2/2013', ' P-2/2020 '],
    decisionOutcome: ' odbija se ',
    tables: [{ description: ' troškovnik ', rowCount: '14' }],
};

test('gold facts are trimmed, canonicalized, and blank rows dropped', () => {
    const { facts, errors } = normalizeGoldFacts(valid);
    expect(errors).toEqual([]);
    expect(facts.amounts).toEqual([
        { rawValue: '1.234,56', currency: 'EUR' },
        { rawValue: '99,00', currency: 'HRK' },
    ]);
    expect(facts.oibs).toEqual([
        { value: '12345678901', role: 'vjerovnik' },
        { value: '98765432109' },
    ]);
    expect(facts.dates).toEqual(['12.03.2024.', '01.01.2025.']);
    expect(facts.filingNumbers).toEqual(['St-2/2013', 'P-2/2020']);
    expect(facts.decisionOutcome).toBe('odbija se');
    expect(facts.tables).toEqual([{ description: 'troškovnik', rowCount: 14 }]);
});

test('half-filled rows are reported instead of silently saved', () => {
    const { errors } = normalizeGoldFacts({
        amounts: [{ rawValue: '', currency: 'EUR' }, { rawValue: 'abc', currency: 'EUR' }, { rawValue: '10', currency: 'USD' }],
        oibs: [{ value: '123', role: 'dužnik' }],
        tables: [{ description: '', rowCount: 3 }, { description: 'popis', rowCount: '2,5' }],
    });
    expect(errors).toEqual([
        'Amount 2: the value needs at least one digit.',
        'Amount 3: currency must be EUR or HRK.',
        'OIB 1: needs exactly 11 digits.',
        'Table 1: describe which table this is.',
        'Table 2: row count must be a whole number.',
    ]);
    expect(normalizeGoldFacts({ tables: [{ description: 'troškovnik', rowCount: '' }] }).errors).toContain('Table 1: row count is required.');
});

test('all fact categories, including empty ones, must be reviewed before completion', () => {
    const { facts } = normalizeGoldFacts(valid);
    const categories = ['amounts', 'oibs', 'dates', 'filingNumbers', 'decisionOutcome', 'tables'];
    const draft = summarizeGold({ facts, factsComplete: false });
    const unreviewed = summarizeGold({ facts, factsComplete: true });
    const summary = summarizeGold({ facts, reviewedCategories: categories, factsComplete: true });
    expect(draft.complete).toBe(false);
    expect(unreviewed).toMatchObject({ complete: false, reviewedCount: 0, missingReviews: categories });
    expect(summary).toMatchObject({ complete: true, amounts: 2, oibs: 2, dates: 2, filingNumbers: 2, tables: 1, tableRows: 14, decisionOutcome: true });
    expect(factCount(summary)).toBe(10);
    expect(summarizeGold({ facts, reviewedCategories: categories, factsComplete: true }).complete).toBe(true);
    expect(factCount(summarizeGold({ facts: {} }))).toBe(0);
});

test('gold paths are confined to the benchmark data folder', () => {
    const root = path.resolve('/tmp/pdf-bench-data');
    const target = resolveGoldTarget(root, '2026-10-20T17-05-58-490Z-84a089b2', 'abcdef0123456789.json');
    expect(target.filePath).toBe(path.join(root, '2026-10-20T17-05-58-490Z-84a089b2', 'gold', 'abcdef0123456789.json'));
    expect(() => resolveGoldTarget(root, '../etc', 'abcdef0123456789.json')).toThrow(/gold set/i);
    expect(() => resolveGoldTarget(root, '2026-10-20T17-05-58-490Z-84a089b2', '../../etc/passwd')).toThrow(/template file/i);
    expect(() => resolveGoldTarget(root, '2026-10-20T17-05-58-490Z-84a089b2', 'notahash.json')).toThrow(/template file/i);
});

test('gold template builder creates a goldSetId-shaped identifier', () => {
    expect(createGoldSetId()).toMatch(/^[0-9TZ-]+-[a-f0-9]{8}$/);
});

test('extractDraftGoldFactsFromText extracts normalized draft amounts, OIBs, dates, and filing numbers', () => {
    const sampleText = [
        'TRGOVAČKI SUD U SPLITU Poslovni broj: 4 Stpn-7/2017-16 i Pž-7788/2016.',
        'Stečajni dužnik KERUM d.o.o. OIB: 66124057408, vjerovnik OIB 89406825003.',
        'Dana 14.10.2025. i 22. travnja 2022. utvrđena je tražbina od 1.327.228,08 EUR (10.000.000,00 kn).',
    ].join('\n');
    const draft = extractDraftGoldFactsFromText(sampleText);
    expect(draft.amounts).toEqual([
        { rawValue: '1.327.228,08', currency: 'EUR' },
        { rawValue: '10.000.000,00', currency: 'HRK' },
    ]);
    expect(draft.oibs).toEqual([
        { value: '66124057408' },
        { value: '89406825003' },
    ]);
    expect(draft.dates).toEqual(expect.arrayContaining(['14.10.2025.', '22. travnja 2022.']));
    expect(draft.filingNumbers).toEqual(expect.arrayContaining(['4 Stpn-7/2017-16', 'Pž-7788/2016']));
});

test('selectCsvEntriesByRowNumbers maps 1-based data rows from oib-66124057408.csv', () => {
    const csvPath = path.resolve(__dirname, 'fixtures/csv-export/oib-66124057408.csv');
    const csvText = fs.readFileSync(csvPath, 'utf8');
    const rows = selectCsvEntriesByRowNumbers(csvText, [1, 19, 372, 379]);
    expect(rows.map((r) => r.index)).toEqual([1, 19, 372, 379]);
    expect(rows[0].caseNumber).toBe('St-2/2013');
    expect(rows[2].caseNumber).toBe('St-357/2013');
    expect(rows[3].caseNumber).toBe('Stpn-7/2017');
    expect(rows[3].documentDownloadLink).toContain('8f9e6070-21e4-4cff-ac63-ed012e89112c');
});
