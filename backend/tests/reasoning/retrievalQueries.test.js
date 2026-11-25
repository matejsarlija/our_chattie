const { retrieveEvidence } = require('../../court-analysis/reasoning/retriever');

function packageWith(overrides = {}) {
    return {
        packageType: 'ClusterEvidencePackage',
        schemaVersion: 1,
        reasoningScope: 'single-cluster',
        selectedClusterIds: ['Stč-2150/2022'],
        clusterId: 'Stč-2150/2022',
        primaryCaseNumber: 'Stč-2150/2022',
        query: { type: 'oib', value: '12345678901' },
        identity: {
            consistency: 'consistent',
            notes: [],
            participantNames: ['KERUM d.o.o.'],
            participantOibs: ['12345678901'],
        },
        discovery: {
            reasoningClusterId: 'Stč-2150/2022',
            recommendedPrimaryClusterId: 'Stč-2150/2022',
            secondaryClusterIds: [],
        },
        entries: [],
        documentLinks: [],
        chunks: [],
        ...overrides,
    };
}

describe('deterministic retrieval queries', () => {
    test('creates a stable cluster-scoped query set with case and identity anchors', () => {
        const queries = retrieveEvidence(packageWith()).queries;

        expect(queries.map((query) => query.id)).toEqual([
            'timeline',
            'amounts',
            'procedural-status',
            'party-roles',
            'property-flow',
        ]);
        expect(queries[0]).toEqual(expect.objectContaining({
            queryType: 'oib',
            purpose: 'timeline',
        }));
        expect(queries[0].anchors).toEqual(expect.arrayContaining([
            '12345678901',
            'Stč-2150/2022',
            'KERUM d.o.o.',
        ]));
    });

    test('falls back unknown query types to text', () => {
        const queries = retrieveEvidence(packageWith({
            query: { type: 'unknown', value: 'JADRAN' },
        })).queries;

        expect(queries.every((query) => query.queryType === 'text')).toBe(true);
    });

    test('property-flow template targets asset and receivable vocabulary', () => {
        const query = retrieveEvidence(packageWith()).queries.find((entry) => entry.id === 'property-flow');

        expect(query).toEqual(expect.objectContaining({ purpose: 'property-assets' }));
        for (const term of ['imovina', 'nekretnina', 'tražbina', 'ustup']) {
            expect(query.text).toContain(term);
        }
    });

    test('property-flow query retrieves relevant document chunks', () => {
        const pkg = packageWith({
            query: { type: 'text', value: 'Ducanor' },
            identity: { consistency: 'consistent', notes: [], participantNames: [], participantOibs: [] },
            chunks: [{
                id: 'c-1',
                text: 'Ugovor o ustupu tražbina: vjerovnik ustupa tražbinu prema dužniku u iznosu od 15.000,00 EUR. Prodaja nekretnine upisane u katastar provodi se radi namirenja.',
                metadata: { fileName: 'ustup.pdf', caseNumber: 'Stč-2150/2022' },
            }],
        });
        const retrieval = retrieveEvidence(pkg, { topK: 10 });
        const propertyResult = retrieval.results.find((result) => result.query?.id === 'property-flow');

        expect(propertyResult).toBeDefined();
        expect(propertyResult.matches.map((match) => match.sourceId)).toContain('c-1');
    });
});
