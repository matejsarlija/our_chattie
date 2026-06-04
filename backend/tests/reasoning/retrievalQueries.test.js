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
            'party-roles'
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
});
