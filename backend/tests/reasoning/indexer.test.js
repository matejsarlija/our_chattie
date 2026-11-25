const { buildLexicalIndex, collectSources, tokenize } = require('../../court-analysis/reasoning/retrieval/indexer');

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

    test('document-extracted party identifiers are searchable in analysis sources', () => {
        const index = buildLexicalIndex({
            ...evidencePackage,
            analyses: [{
                id: 'analysis-party-oib',
                fileName: 'Podnesak.pdf',
                documentParties: [{ name: 'ADRIA RIJEKA d.o.o.', oib: '08697489827', role: 'dužnik' }],
            }],
        });
        const source = index.sources.find((item) => item.normalizedText.includes('08697489827'));
        expect(source).toBeDefined();
        expect(source.tokens).toContain('08697489827');
    });

    test('tokenizes Croatian legal text into searchable terms', () => {
        expect(tokenize('Rješenje o otvaranju stečaja i trošak')).toEqual([
            'rjesenje',
            'otvaranju',
            'stecaja',
            'trosak'
        ]);
    });

    test('preserves short redni-broj tokens but excludes unrelated short numbers', () => {
        expect(tokenize('redni broj 98')).toContain('98');
        expect(tokenize('predmet 98')).not.toContain('98');
    });

    test('indexes outcomes, procedural events, citations, and ledger references', () => {
        const sources = collectSources({
            clusterId: 'St-2/2013',
            entries: [],
            documentLinks: [],
            chunks: [],
            analyses: [{
                id: 'analysis-1',
                summary: 'Podnesak vjerovnika.',
                decisionOutcome: 'odbija se prijedlog',
                proceduralEvents: [{ description: 'pravomoćno rješenje', filingReference: 'St-2/2013-1155' }],
                citedFilingReferences: ['Ovrv-305/12'],
                amounts: [{ claimRegistryNumber: '98', filingReference: 'St-2/2013-1155', isplatniRed: '98' }],
            }],
            factLedger: [{
                kind: 'amount',
                description: 'prijavljena tražbina',
                claimRegistryNumber: '98',
                filingReference: 'St-2/2013-1155',
                isplatniRed: '98',
                doc: { analysisId: 'analysis-1', fileName: 'Podnesak.pdf' },
            }],
        });
        const analysis = sources.find((source) => source.metadata.sourceType === 'analysis');
        const fact = sources.find((source) => source.metadata.sourceType === 'fact');

        expect(analysis.text).toContain('odbija se prijedlog');
        expect(analysis.text).toContain('pravomoćno rješenje');
        expect(analysis.text).toContain('Ovrv-305/12');
        expect(analysis.text).toContain('St-2/2013-1155');
        expect(fact.text).toContain('redni broj 98');
    });
});
