const { buildLexicalIndex, collectSources, tokenize } = require('../../court-analysis/reasoning/indexer');

describe('indexer', () => {
    const evidencePackage = {
        clusterId: 'ST-100/2023',
        entries: [
            {
                index: 0,
                caseNumber: 'ST-100/2023',
                title: 'Rješenje o otvaranju stečaja',
                detailLink: 'https://example.test/objave/1',
                participants: [{ name: 'KERUM d.o.o.', oib: '12345678901' }]
            }
        ],
        documentLinks: [
            {
                id: 'doc-1',
                text: 'Dokument s iznosom tražbine 10.000 EUR',
                caseNumber: 'ST-100/2023'
            }
        ]
    };

    test('builds a lexical index with source tokens and metrics', () => {
        const index = buildLexicalIndex(evidencePackage);

        expect(index).toEqual(expect.objectContaining({
            indexType: 'lexical',
            clusterId: 'ST-100/2023'
        }));
        expect(index.sources).toHaveLength(2);
        expect(index.sources[0]).toEqual(expect.objectContaining({
            sourceIndex: 0,
            normalizedText: expect.stringContaining('stecaja'),
            tokens: expect.arrayContaining(['rjesenje', 'stecaja', '12345678901'])
        }));
        expect(index.metrics).toEqual(expect.objectContaining({
            sourceCount: 2,
            tokenCount: expect.any(Number),
            buildTimeMs: expect.any(Number)
        }));
    });

    test('collects sources without requiring document chunks', () => {
        expect(collectSources(evidencePackage).map((source) => source.metadata.sourceType)).toEqual([
            'entry',
            'document-link'
        ]);
    });

    test('tokenizes Croatian legal text into searchable terms', () => {
        expect(tokenize('Rješenje o otvaranju stečaja i trošak')).toEqual([
            'rjesenje',
            'otvaranju',
            'stecaja',
            'trosak'
        ]);
    });
});
