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
