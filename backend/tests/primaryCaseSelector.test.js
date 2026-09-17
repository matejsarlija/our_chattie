const {
    selectPrimaryCase,
    entryCaseKey,
    entryHasDocuments
} = require('../court-analysis/utils/primaryCaseSelector');

function makeEntry(caseNumber, { date = '2026-01-01', docs = true } = {}) {
    return {
        caseNumber,
        caseInfo: {
            caseNumber,
            date,
            documentDownloadLink: docs ? `https://example.invalid/${caseNumber}` : ''
        },
        documentLinks: docs ? [{ url: `https://example.invalid/${caseNumber}` }] : []
    };
}

describe('selectPrimaryCase (shared discovery/reasoning selector)', () => {
    test('exact case_number query match wins over a deliberately larger secondary group', () => {
        const entries = [
            ...Array.from({ length: 50 }, (_, i) => makeEntry('ST-99/2020', { date: `2020-01-${String((i % 28) + 1).padStart(2, '0')}` })),
            ...Array.from({ length: 3 }, () => makeEntry('St-2/2013', { date: '2026-06-23' }))
        ];
        const result = selectPrimaryCase(entries, { type: 'case_number', value: 'st-2/2013' });

        expect(result.selectedCaseKey).toBe('ST-2/2013');
        expect(result.method).toBe('case-number-query');
        expect(result.candidates).toHaveLength(2);
    });

    test('case_number query with no matching group falls back to document coverage', () => {
        const entries = [
            ...Array.from({ length: 5 }, () => makeEntry('ST-2/2013')),
            ...Array.from({ length: 2 }, () => makeEntry('ST-9/2019'))
        ];
        const result = selectPrimaryCase(entries, { type: 'case_number', value: 'ST-0/2000' });

        expect(result.selectedCaseKey).toBe('ST-2/2013');
        expect(result.method).toBe('document-coverage');
    });

    test('most document-carrying entries win (not raw entry count)', () => {
        const entries = [
            ...Array.from({ length: 10 }, () => makeEntry('ST-2/2013', { docs: false })),
            ...Array.from({ length: 3 }, () => makeEntry('ST-9/2019', { docs: true }))
        ];
        const result = selectPrimaryCase(entries, { type: 'oib', value: '66124057408' });

        expect(result.selectedCaseKey).toBe('ST-9/2019');
        expect(result.method).toBe('document-coverage');
    });

    test('recency breaks document-count ties; undated groups lose', () => {
        const entries = [
            ...Array.from({ length: 2 }, () => makeEntry('ST-9/2019', { date: '2020-05-05' })),
            ...Array.from({ length: 2 }, () => makeEntry('ST-2/2013', { date: '2026-06-23' })),
            ...Array.from({ length: 2 }, () => makeEntry('ST-1/2018', { date: 'N/A' }))
        ];
        const result = selectPrimaryCase(entries, null);

        expect(result.selectedCaseKey).toBe('ST-2/2013');
    });

    test('lexical key is the final deterministic fallback', () => {
        const entries = [
            makeEntry('ST-9/2019', { date: 'N/A' }),
            makeEntry('ST-2/2013', { date: 'N/A' })
        ];
        const first = selectPrimaryCase(entries, null);
        const second = selectPrimaryCase([...entries].reverse(), null);

        expect(first.selectedCaseKey).toBe('ST-2/2013');
        expect(second.selectedCaseKey).toBe('ST-2/2013');
    });

    test('register-prefix-distinct keys stay distinct; unkeyed entries never win', () => {
        const entries = [
            ...Array.from({ length: 4 }, () => makeEntry('4 St-2/2013')),
            ...Array.from({ length: 4 }, () => makeEntry('St-2/2013')),
            makeEntry('N/A'),
            { caseInfo: {} }
        ];
        const result = selectPrimaryCase(entries, null);

        expect(result.candidates.map((c) => c.key).sort()).toEqual(['4 ST-2/2013', 'ST-2/2013']);
        expect(result.unkeyedEntries).toBe(2);
        // Tie on docs + dates: lexical fallback picks '4 ST-2/2013'.
        expect(result.selectedCaseKey).toBe('4 ST-2/2013');
    });

    test('empty input selects nothing', () => {
        expect(selectPrimaryCase([], null)).toEqual({
            selectedCaseKey: null,
            method: 'none',
            candidates: [],
            unkeyedEntries: 0
        });
        expect(selectPrimaryCase(null, null).selectedCaseKey).toBeNull();
    });

    test('entry helpers read both CSV and pipeline entry shapes', () => {
        const csvEntry = { caseInfo: { caseNumber: 'st-2/2013', documentDownloadLink: 'https://x/y' } };
        expect(entryCaseKey(csvEntry)).toBe('ST-2/2013');
        expect(entryHasDocuments(csvEntry)).toBe(true);
        expect(entryHasDocuments({ caseInfo: { documentDownloadLink: '' }, documentLinks: [] })).toBe(false);
        expect(entryHasDocuments({ documentLinks: [{ url: 'https://x' }] })).toBe(true);
    });
});
