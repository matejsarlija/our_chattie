const { attachAnalysesToEvidencePackage, validateClusterEvidencePackage } = require('../../court-analysis/reasoning/evidencePackage');

const basePackage = () => ({
    packageType: 'ClusterEvidencePackage',
    schemaVersion: 1,
    reasoningScope: 'single-cluster',
    selectedClusterIds: ['St-1/2024'],
    clusterId: 'St-1/2024',
    primaryCaseNumber: 'St-1/2024',
    identity: { consistency: 'consistent', notes: [], participantNames: [], participantOibs: [] },
    discovery: { reasoningClusterId: 'St-1/2024', secondaryClusterIds: [] },
    selection: {},
    expansion: {},
    acquisition: {},
    entries: [],
    documentLinks: []
});

const chunkOf = (text, index) => ({
    id: `chunk-${index}`,
    text,
    metadata: { startIndex: index * 1000, endIndex: index * 1000 + text.length }
});

describe('attachAnalysesToEvidencePackage — ground-truth chunk branch (Phase 0.1)', () => {
    test('collects chunks from successful analyses', () => {
        const pkg = attachAnalysesToEvidencePackage(basePackage(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/a.pdf',
                        text: 'uspjela-analiza.pdf',
                        aiResult: { caseNumber: 'St-1/2024', summary: 'Sažetak.', amounts: [] },
                        retrievalChunks: [chunkOf('Puni tekst prvog dokumenta o stečajnom postupku.', 0)]
                    }
                ]
            }
        }], null);

        expect(pkg.chunks).toHaveLength(1);
        expect(pkg.chunks[0].metadata).toEqual(expect.objectContaining({
            fileName: 'uspjela-analiza.pdf',
            caseNumber: 'St-1/2024'
        }));
    });

    test('keeps chunks from analysis-failures-with-extracted-text (Gap-2 branch)', () => {
        const pkg = attachAnalysesToEvidencePackage(basePackage(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/b.pdf',
                        text: 'kvota-neuspjela.pdf',
                        aiResult: null,
                        error: 'Dnevni limit AI analize je iscrpljen.',
                        retrievalChunks: [
                            chunkOf('Tekst dokumenta koji je OCR uspješno izvukao prije nego što je analiza pala.', 0),
                            chunkOf('Drugi odlomak s pravnim sadržajem o tražbinama vjerovnika i rokovima prijave.', 1)
                        ]
                    }
                ]
            }
        }], null);

        // The whole point: no aiResult, but the paid-for OCR text still grounds.
        expect(pkg.analyses).toHaveLength(0);
        expect(pkg.chunks).toHaveLength(2);
        expect(pkg.chunks[0].metadata.fileName).toBe('kvota-neuspjela.pdf');
        expect(pkg.coverage.failed).toBe(1);
    });

    test('items without extracted text contribute no chunks', () => {
        const pkg = attachAnalysesToEvidencePackage(basePackage(), [{
            analysis: {
                individualAnalyses: [
                    { filePath: '/tmp/c.pdf', text: 'prazan.pdf', aiResult: null, error: 'ocr-failed' }
                ]
            }
        }], null);

        expect(pkg.chunks).toEqual([]);
    });

    test('attaches deterministic reconciliation output for the synthesizer to seed', () => {
        const pkg = attachAnalysesToEvidencePackage(basePackage(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/d.pdf',
                        text: 'd.pdf',
                        aiResult: {
                            caseNumber: 'St-1/2024',
                            summary: 'Sažetak s iznosima.',
                            amounts: [
                                { description: 'Ukupno prijavljene tražbine', amount: 90000, currency: 'EUR' },
                                { description: 'Tražbina banke', amount: 84500, currency: 'EUR' }
                            ]
                        }
                    }
                ]
            }
        }], null);

        expect(pkg.reconciliation.conflicts).toHaveLength(0);
        expect(pkg.reconciliation.openQuestions).toHaveLength(1);
        expect(validateClusterEvidencePackage(pkg).valid).toBe(true);
    });
});

describe('attachAnalysesToEvidencePackage — structural entry-date fallback', () => {
    const packageWithEntry = () => ({
        ...basePackage(),
        entries: [
            {
                index: 0,
                caseNumber: 'St-1/2024',
                title: 'Podnesak bez datuma u tekstu',
                court: 'Trgovački sud u Zagrebu',
                date: '2023-05-17',
                detailLink: 'https://e-oglasna.pravosudje.hr/objave/entry-1',
                entryDisplayId: 'entry-1',
                participants: [],
                acquisition: { mode: 'search-window' },
                documentLinks: [
                    {
                        id: 'St-1/2024::entry-1::doc-1',
                        url: 'https://e-oglasna.pravosudje.hr/attachment/podnesak.pdf',
                        text: 'Podnesak.pdf',
                        entryIndex: 0,
                        entryTitle: 'Podnesak bez datuma u tekstu',
                        entryDisplayId: 'entry-1',
                        caseNumber: 'St-1/2024',
                        acquisition: { mode: 'search-window' },
                        sourceProvenance: null
                    }
                ]
            }
        ],
        documentLinks: [
            {
                id: 'St-1/2024::entry-1::doc-1',
                url: 'https://e-oglasna.pravosudje.hr/attachment/podnesak.pdf',
                text: 'Podnesak.pdf',
                entryIndex: 0,
                entryTitle: 'Podnesak bez datuma u tekstu',
                entryDisplayId: 'entry-1',
                caseNumber: 'St-1/2024',
                acquisition: { mode: 'search-window' },
                sourceProvenance: null
            }
        ]
    });

    test('falls back to the source entry date when decisionDate is null', () => {
        const pkg = attachAnalysesToEvidencePackage(packageWithEntry(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/podnesak.pdf',
                        text: 'Podnesak.pdf',
                        url: 'https://e-oglasna.pravosudje.hr/attachment/podnesak.pdf',
                        aiResult: {
                            caseNumber: 'St-1/2024',
                            decisionDate: null,
                            summary: 'Procesni podnesak bez datuma u tekstu.',
                            amounts: [],
                            propertyFlow: []
                        }
                    }
                ]
            }
        }], null);

        expect(pkg.analyses).toHaveLength(1);
        expect(pkg.analyses[0].decisionDate).toBe('2023-05-17');
    });

    test('never overwrites a real extracted decisionDate with the entry date', () => {
        const pkg = attachAnalysesToEvidencePackage(packageWithEntry(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/podnesak.pdf',
                        text: 'Podnesak.pdf',
                        url: 'https://e-oglasna.pravosudje.hr/attachment/podnesak.pdf',
                        aiResult: {
                            caseNumber: 'St-1/2024',
                            decisionDate: '2022-01-10',
                            summary: 'Podnesak s izričitim datumom.',
                            amounts: [],
                            propertyFlow: []
                        }
                    }
                ]
            }
        }], null);

        expect(pkg.analyses[0].decisionDate).toBe('2022-01-10');
    });

    test('money-flow and property-flow entries inherit the entry date when undated', () => {
        const pkg = attachAnalysesToEvidencePackage(packageWithEntry(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/podnesak.pdf',
                        text: 'Podnesak.pdf',
                        url: 'https://e-oglasna.pravosudje.hr/attachment/podnesak.pdf',
                        aiResult: {
                            caseNumber: 'St-1/2024',
                            decisionDate: null,
                            summary: 'Podnesak s iznosima bez datuma.',
                            amounts: [
                                { description: 'Sudska pristojba za podnesak', amount: 100, currency: 'EUR' }
                            ],
                            propertyFlow: [
                                {
                                    description: 'Tražbina vjerovnika prema dužniku iz podneska',
                                    assetType: 'tražbina',
                                    eventType: 'prijava',
                                    value: 5000,
                                    currency: 'EUR'
                                }
                            ]
                        }
                    }
                ]
            }
        }], null);

        expect(pkg.moneyFlow.entries[0].date).toBe('2023-05-17');
        expect(pkg.propertyFlow.entries[0].date).toBe('2023-05-17');
    });

    test('explicit sourceEntryIndex resolves the entry without fuzzy matching', () => {
        const pkg = attachAnalysesToEvidencePackage(packageWithEntry(), [{
            analysis: {
                individualAnalyses: [
                    {
                        // No url/text overlap at all — only explicit provenance.
                        filePath: '/tmp/renamed-working-copy.pdf',
                        text: 'Preimenovana datoteka.pdf',
                        sourceEntryIndex: 0,
                        aiResult: {
                            caseNumber: 'St-1/2024',
                            decisionDate: null,
                            summary: 'Datoteka bez ikakvog podudaranja naziva.',
                            amounts: [],
                            propertyFlow: []
                        }
                    }
                ]
            }
        }], null);

        expect(pkg.analyses[0].decisionDate).toBe('2023-05-17');
        expect(pkg.analyses[0].sourceEntryIndex).toBe(0);
    });

    test('explicit sourceDocumentLinkId resolves via the package document link', () => {
        const pkg = attachAnalysesToEvidencePackage(packageWithEntry(), [{
            analysis: {
                individualAnalyses: [
                    {
                        filePath: '/tmp/renamed-working-copy.pdf',
                        text: 'Preimenovana datoteka.pdf',
                        sourceDocumentLinkId: 'St-1/2024::entry-1::doc-1',
                        aiResult: {
                            caseNumber: 'St-1/2024',
                            decisionDate: null,
                            summary: 'Datoteka s eksplicitnim id-jem veze.',
                            amounts: [],
                            propertyFlow: []
                        }
                    }
                ]
            }
        }], null);

        expect(pkg.analyses[0].decisionDate).toBe('2023-05-17');
        expect(pkg.analyses[0].sourceDocumentLinkId).toBe('St-1/2024::entry-1::doc-1');
    });
});
