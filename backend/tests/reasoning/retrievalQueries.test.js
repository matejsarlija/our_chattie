const { createRetrievalQueries } = require('../../court-analysis/reasoning/retrievalQueries');

describe('retrievalQueries', () => {
    test('creates deterministic cluster-scoped query set with case and identity anchors', () => {
        const queries = createRetrievalQueries({
            query: { type: 'oib', value: '12345678901' },
            clusterId: 'ST-100/2023',
            identity: {
                participantOibs: ['12345678901'],
                participantNames: ['KERUM d.o.o.']
            }
        });

        expect(queries.map((query) => query.id)).toEqual([
            'timeline',
            'amounts',
            'procedural-status',
            'party-roles',
            'property-flow'
        ]);
        expect(queries[0]).toEqual(expect.objectContaining({
            queryType: 'oib',
            purpose: 'timeline'
        }));
        expect(queries[0].anchors).toEqual(expect.arrayContaining([
            '12345678901',
            'ST-100/2023',
            'KERUM d.o.o.'
        ]));
    });

    test('falls back unknown query types to text', () => {
        const queries = createRetrievalQueries({
            query: { type: 'unknown', value: 'JADRAN' }
        });

        expect(queries.every((query) => query.queryType === 'text')).toBe(true);
    });

    test('property-flow template targets asset/receivable vocabulary', () => {
        const queries = createRetrievalQueries({ clusterId: 'Stč-2150/2022' });
        const template = queries.find((query) => query.id === 'property-flow');
        expect(template).toEqual(expect.objectContaining({ purpose: 'property-assets' }));
        for (const term of ['imovina', 'nekretnina', 'tražbina', 'ustup']) {
            expect(template.text).toContain(term);
        }
    });

    test('property-flow-relevant chunks are retrievable via the new template', () => {
        const { retrieveEvidence } = require('../../court-analysis/reasoning/retriever');
        const pkg = {
            packageType: 'ClusterEvidencePackage',
            schemaVersion: 1,
            reasoningScope: 'single-cluster',
            selectedClusterIds: ['Stč-2150/2022'],
            clusterId: 'Stč-2150/2022',
            primaryCaseNumber: 'Stč-2150/2022',
            query: { type: 'text', value: 'Ducanor' },
            identity: { consistency: 'consistent', notes: [], participantNames: [], participantOibs: [] },
            discovery: { reasoningClusterId: 'Stč-2150/2022', recommendedPrimaryClusterId: 'Stč-2150/2022', secondaryClusterIds: [] },
            entries: [],
            documentLinks: [],
            chunks: [
                {
                    id: 'c-1',
                    text: 'Ugovor o ustupu tražbina: vjerovnik ustupa tražbinu prema dužniku u iznosu od 15.000,00 EUR. Prodaja nekretnine upisane u katastar provodi se radi namirenja.',
                    metadata: { fileName: 'ustup.pdf', caseNumber: 'Stč-2150/2022' },
                },
            ],
        };
        const retrieval = retrieveEvidence(pkg, { topK: 10 });
        const propertyResult = retrieval.results.find((result) => result.query?.id === 'property-flow');
        expect(propertyResult).toBeDefined();
        expect(propertyResult.matches.map((match) => match.sourceId)).toContain('c-1');
    });
});
