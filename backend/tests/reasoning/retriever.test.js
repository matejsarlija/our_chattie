const { collectSources, retrieveEvidence } = require('../../court-analysis/reasoning/retriever');

describe('retriever', () => {
    const evidencePackage = {
        packageType: 'ClusterEvidencePackage',
        clusterId: 'ST-100/2023',
        primaryCaseNumber: 'ST-100/2023',
        query: { type: 'oib', value: '12345678901' },
        identity: {
            participantOibs: ['12345678901'],
            participantNames: ['KERUM d.o.o.']
        },
        entries: [
            {
                index: 0,
                caseNumber: 'ST-100/2023',
                title: 'Rješenje o otvaranju stečaja',
                court: 'Trgovački sud u Splitu',
                date: '01.02.2025',
                detailLink: 'https://example.test/objave/1',
                participants: [{ name: 'KERUM d.o.o.', oib: '12345678901' }]
            },
            {
                index: 1,
                caseNumber: 'ST-100/2023',
                title: 'Zaključak bez financijskih iznosa',
                detailLink: 'https://example.test/objave/2',
                participants: []
            }
        ],
        documentLinks: [
            {
                id: 'doc-1',
                text: 'Dokument s iznosom tražbine 10.000 EUR',
                url: 'https://example.test/doc-1.pdf',
                caseNumber: 'ST-100/2023'
            }
        ]
    };

    test('collects package-local entries and document links as retrieval sources', () => {
        const sources = collectSources(evidencePackage);

        expect(sources.map((source) => source.metadata.sourceType)).toEqual([
            'entry',
            'entry',
            'document-link'
        ]);
        expect(sources[0].text).toContain('12345678901');
    });

    test('boosts exact OIB and same-cluster matches with stable ordering', () => {
        const result = retrieveEvidence(evidencePackage, {
            topK: 2,
            queries: [
                {
                    id: 'party-roles',
                    purpose: 'party-roles',
                    text: 'dužnik oib',
                    anchors: ['12345678901', 'ST-100/2023'],
                    queryType: 'oib'
                }
            ]
        });

        expect(result.metrics).toEqual(expect.objectContaining({
            queryCount: 1,
            sourceCount: 3,
            tokenCount: expect.any(Number),
            indexBuildTimeMs: expect.any(Number),
            matchCount: 2
        }));
        expect(result.results[0].matches[0]).toEqual(expect.objectContaining({
            sourceId: 'https://example.test/objave/1',
            reasons: expect.arrayContaining(['anchor:12345678901', 'same-cluster'])
        }));
    });

    test('returns financial document evidence for amount queries', () => {
        const result = retrieveEvidence(evidencePackage, {
            topK: 1,
            queries: [
                {
                    id: 'amounts',
                    purpose: 'financial-amounts',
                    text: 'iznos tražbina eur',
                    anchors: [],
                    queryType: 'case_number'
                }
            ]
        });

        expect(result.results[0].matches[0]).toEqual(expect.objectContaining({
            sourceId: 'doc-1',
            score: expect.any(Number)
        }));
        expect(result.results[0].matches[0].score).toBeGreaterThan(0);
    });
});
