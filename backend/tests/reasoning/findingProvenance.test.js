const { annotateFindingsWithRetrieval } = require('../../court-analysis/reasoning/findingProvenance');

function retrieval(queryId, queryText, matches, purpose = 'trazbina') {
    return {
        queries: [{ id: queryId, text: queryText, purpose }],
        results: [{ query: { id: queryId, text: queryText, purpose }, matches }],
        metrics: {},
    };
}

describe('reasoning findingProvenance (M-09)', () => {
    test('joins a citation to its retrieval query via sourceId', () => {
        const findings = [{
            id: 'f1',
            text: 'Tražbina je utvrđena.',
            citations: [{ source: 'doc-1', text: 'Rješenje navodi tražbinu.' }],
        }];
        const out = annotateFindingsWithRetrieval(findings, retrieval(
            'planned-trazbina', 'trazbina Kerum dug',
            [{ sourceId: 'doc-1', score: 4.2, reasons: ['token:trazbina', 'anchor:St-2/2013'], metadata: {} }]
        ));
        expect(out[0].citations[0].retrievedBy).toEqual([{
            queryId: 'planned-trazbina',
            queryText: 'trazbina Kerum dug',
            queryPurpose: 'trazbina',
            planned: true,
            score: 4.2,
            reasons: ['token:trazbina', 'anchor:St-2/2013'],
        }]);
    });

    test('joins via fileName when the citation carries no sourceId', () => {
        const findings = [{
            id: 'f1', text: 'Nalaz.',
            citations: [{ fileName: 'Rjesenje.pdf' }],
        }];
        const out = annotateFindingsWithRetrieval(findings, retrieval(
            'timeline', 'datumi rociste',
            [{ sourceId: 'other-id', score: 2, reasons: [], metadata: { fileName: 'Rjesenje.pdf' } }]
        ));
        expect(out[0].citations[0].retrievedBy).toHaveLength(1);
        expect(out[0].citations[0].retrievedBy[0].planned).toBe(false);
    });

    test('unmatched citations stay link-free and input is not mutated', () => {
        const findings = [{ id: 'f1', text: 'Nalaz.', citations: [{ source: 'ghost' }] }];
        const frozen = JSON.parse(JSON.stringify(findings));
        const out = annotateFindingsWithRetrieval(findings, retrieval(
            'q', 'qq', [{ sourceId: 'doc-9', score: 1, reasons: [], metadata: {} }]
        ));
        expect(out[0].citations[0].retrievedBy).toBeUndefined();
        expect(findings).toEqual(frozen);
    });

    test('caps links per citation, best score first', () => {
        const findings = [{ id: 'f1', text: 'N.', citations: [{ source: 'doc-1' }] }];
        const out = annotateFindingsWithRetrieval(findings, {
            results: [1, 2, 3, 4, 5].map((i) => ({
                query: { id: `q-${i}`, text: `up it ${i}` },
                matches: [{ sourceId: 'doc-1', score: i, reasons: [], metadata: {} }],
            })),
        });
        const links = out[0].citations[0].retrievedBy;
        expect(links).toHaveLength(3);
        expect(links.map((l) => l.score)).toEqual([5, 4, 3]);
    });

    test('empty shapes degrade without throwing', () => {
        expect(annotateFindingsWithRetrieval(null, null)).toBeNull();
        expect(annotateFindingsWithRetrieval([], null)).toEqual([]);
        expect(annotateFindingsWithRetrieval([{ id: 'f' }], null)).toEqual([{ id: 'f' }]);
    });
});
