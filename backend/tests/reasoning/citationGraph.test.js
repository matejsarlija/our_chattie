const {
    buildCitationGraph,
    findCitationLinkedPairs,
} = require('../../court-analysis/reasoning/citationGraph');

function makeAnalysis(id, fileName, refs, cited) {
    return {
        id,
        fileName,
        amounts: (refs || []).map((filingReference) => ({
            description: 'Tražbina', amount: 100, currency: 'EUR', filingReference,
        })),
        propertyFlow: [],
        citedFilingReferences: cited || [],
    };
}

describe('reasoning citationGraph (L-02)', () => {
    test('empty input yields an empty graph without throwing', () => {
        expect(buildCitationGraph([])).toEqual({ nodes: [], edges: [] });
        expect(buildCitationGraph(null)).toEqual({ nodes: [], edges: [] });
        expect(findCitationLinkedPairs([], [])).toEqual(new Set());
    });

    test('resolves cited refs to owning documents, leaves unknown refs dangling', () => {
        const graph = buildCitationGraph([
            makeAnalysis('a-1', 'prijava.pdf', ['St-2/2013-1196-1'], []),
            makeAnalysis('a-2', 'zalba.pdf', ['St-2/2013-1214'], ['St-2/2013-1196-1', 'St-2/2013-9999']),
        ]);
        expect(graph.nodes).toHaveLength(2);
        expect(graph.nodes[0]).toEqual(expect.objectContaining({
            id: 'a-1', filingReferences: ['St-2/2013-1196-1'],
        }));
        expect(graph.edges).toEqual(expect.arrayContaining([
            { from: 'a-2', to: 'a-1', via: 'St-2/2013-1196-1', resolved: true },
            { from: 'a-2', to: 'St-2/2013-9999', via: 'St-2/2013-9999', resolved: false },
        ]));
    });

    test('findCitationLinkedPairs joins entries whose docs cite each other', () => {
        const analyses = [
            makeAnalysis('a-1', 'prijava.pdf', ['St-2/2013-1196-1'], []),
            makeAnalysis('a-2', 'zalba.pdf', ['St-2/2013-1214'], ['St-2/2013-1196-1']),
        ];
        const entries = [
            { id: 'prop-1', filingReference: 'St-2/2013-1196-1', sourceId: 'a-1' },
            { id: 'prop-2', filingReference: 'St-2/2013-1214', sourceId: 'a-2' },
            { id: 'prop-3', filingReference: null, sourceId: 'a-2' },
        ];
        expect(findCitationLinkedPairs(entries, analyses)).toEqual(new Set(['prop-1::prop-2']));
    });

    test('no citation, no pair — never fuzzy', () => {
        const analyses = [makeAnalysis('a-1', 'x.pdf', ['St-2/2013-1'], [])];
        const entries = [
            { id: 'prop-1', filingReference: 'St-2/2013-1', sourceId: 'a-1' },
            { id: 'prop-2', filingReference: 'St-2/2013-2', sourceId: 'a-1' },
        ];
        expect(findCitationLinkedPairs(entries, analyses).size).toBe(0);
    });
});
