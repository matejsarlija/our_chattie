const { buildCourtAnalysisPayload } = require('../helpers/courtAnalysisPayload');

describe('buildCourtAnalysisPayload', () => {
    test('preserves cluster-scoped discovery metadata while returning lean processed case data', () => {
        const finalResult = {
            processedCases: [
                {
                    caseResult: {
                        title: 'Predmet A',
                        caseNumber: 'ST-100/2023',
                        court: 'Trgovački sud u Splitu',
                        date: '15.03.2025',
                        detailLink: 'https://e-oglasna.pravosudje.hr/objave/128734',
                        participants: [{ name: 'KERUM d.o.o.', oib: '11111111111' }]
                    },
                    files: [
                        { url: 'https://example.test/doc-1.pdf', text: 'doc-1.pdf', filePath: '/tmp/doc-1.pdf' }
                    ],
                    analysis: {
                        individualAnalyses: [
                            {
                                text: 'doc-1.pdf',
                                aiResult: 'Nalaz',
                                error: null,
                                rawChunkCount: 4
                            }
                        ]
                    },
                    groupMetadata: {
                        clusterId: 'ST-100/2023',
                        entryCount: 3,
                        selectedForReasoning: true
                    }
                }
            ],
            comparativeAnalysis: '<p>Sažetak</p>',
            discoverySummary: {
                reasoningScope: 'single-cluster',
                reasoningClusterId: 'ST-100/2023',
                recommendedPrimaryClusterId: 'ST-100/2023',
                secondaryClusterIds: ['ST-200/2021'],
                clusters: [
                    { clusterId: 'ST-100/2023', selectedForReasoning: true },
                    { clusterId: 'ST-200/2021', selectedForReasoning: false }
                ]
            },
            primaryCluster: {
                clusterId: 'ST-100/2023',
                selectedForReasoning: true
            },
            secondaryClusters: [
                {
                    clusterId: 'ST-200/2021',
                    selectedForReasoning: false
                }
            ],
            clusterEvidencePackage: {
                packageType: 'ClusterEvidencePackage',
                clusterId: 'ST-100/2023',
                selectedClusterIds: ['ST-100/2023'],
                documentLinks: [
                    {
                        url: 'https://example.test/doc-1.pdf',
                        sourceProvenance: { acquisitionMode: 'search-window' }
                    }
                ]
            },
            report: {
                clusterId: 'ST-100/2023',
                primaryCaseNumber: 'ST-100/2023',
                findings: [
                    {
                        text: 'Nalaz',
                        confidence: 'medium',
                        citations: [{ sourceId: 'doc-1.pdf' }]
                    }
                ],
                timeline: [
                    {
                        date: '15.03.2025',
                        description: 'Objava (ST-100/2023)',
                        citations: [{ source: 'ST-100/2023:entry-1', text: 'Predmet A' }]
                    }
                ],
                meta: {
                    discoverySummaryRef: 'ST-100/2023'
                }
            }
        };

        const payload = buildCourtAnalysisPayload(finalResult);

        expect(payload.comparativeAnalysis).toBe('Sažetak');
        expect(payload.discoverySummary).toEqual(finalResult.discoverySummary);
        expect(payload.primaryCluster).toEqual(finalResult.primaryCluster);
        expect(payload.secondaryClusters).toEqual(finalResult.secondaryClusters);
        expect(payload.clusterEvidencePackage).toEqual(finalResult.clusterEvidencePackage);
        expect(payload.report).toEqual(finalResult.report);
        expect(payload.report.timeline).toEqual(finalResult.report.timeline);
        expect(payload.report.timeline[0]).toMatchObject({
            date: '15.03.2025',
            description: 'Objava (ST-100/2023)'
        });
        expect(payload.report.timeline[0].citations).toEqual([
            { source: 'ST-100/2023:entry-1', text: 'Predmet A' }
        ]);
        expect(payload.processedCases).toEqual([
            {
                caseResult: {
                    title: 'Predmet A',
                    caseNumber: 'ST-100/2023',
                    court: 'Trgovački sud u Splitu',
                    date: '15.03.2025',
                    detailLink: 'https://e-oglasna.pravosudje.hr/objave/128734',
                    entryDisplayId: '128734',
                    participants: [{ name: 'KERUM d.o.o.', oib: '11111111111' }]
                },
                files: [
                    { url: 'https://example.test/doc-1.pdf', text: 'doc-1.pdf' }
                ],
                analysis: {
                    individualAnalyses: [
                        {
                            fileName: 'doc-1.pdf',
                            aiResult: 'Nalaz',
                            error: null
                        }
                    ]
                },
                    groupMetadata: {
                        clusterId: 'ST-100/2023',
                        entryCount: 3,
                        selectedForReasoning: true
                }
            }
        ]);
    });

    test('handles missing optional fields without throwing', () => {
        const payload = buildCourtAnalysisPayload({
            processedCases: [],
            comparativeAnalysis: '',
            discoverySummary: null
        });

        expect(payload).toEqual({
            processedCases: [],
            comparativeAnalysis: '',
            discoverySummary: null,
            primaryCluster: null,
            secondaryClusters: [],
            clusterEvidencePackage: null,
            report: null
        });
    });

    test('keeps reasoning payload cluster-scoped and excludes local file internals', () => {
        const payload = buildCourtAnalysisPayload({
            processedCases: [
                {
                    caseResult: {
                        caseNumber: 'ST-700/2024',
                        detailLink: 'https://e-oglasna.pravosudje.hr/objave/777'
                    },
                    files: [
                        {
                            url: 'https://example.test/st700.zip',
                            text: 'ST-700.zip',
                            filePath: '/tmp/private/ST-700.zip'
                        }
                    ],
                    analysis: {
                        individualAnalyses: [
                            {
                                text: 'ST-700.pdf',
                                aiResult: 'Nalaz',
                                error: null,
                                rawChunkCount: 15
                            }
                        ]
                    },
                    groupMetadata: {
                        clusterId: 'ST-700/2024',
                        selectedForReasoning: true,
                        expansionPlan: {
                            targetClusterId: 'ST-700/2024',
                            executable: true
                        }
                    }
                }
            ],
            comparativeAnalysis: 'Sažetak',
            discoverySummary: {
                reasoningScope: 'single-cluster',
                reasoningClusterId: 'ST-700/2024',
                secondaryClusterIds: ['ST-123/2026']
            },
            primaryCluster: { clusterId: 'ST-700/2024' },
            secondaryClusters: [{ clusterId: 'ST-123/2026' }],
            clusterEvidencePackage: {
                packageType: 'ClusterEvidencePackage',
                clusterId: 'ST-700/2024',
                selectedClusterIds: ['ST-700/2024'],
                discovery: {
                    secondaryClusterIds: ['ST-123/2026']
                },
                documentLinks: [
                    {
                        url: 'https://example.test/st700.zip',
                        sourceProvenance: {
                            acquisitionMode: 'search-window',
                            sourceCaseNumber: 'ST-700/2024'
                        }
                    }
                ]
            },
            report: { clusterId: 'ST-700/2024', findings: [] }
        });

        expect(payload.discoverySummary.reasoningScope).toBe('single-cluster');
        expect(payload.clusterEvidencePackage.selectedClusterIds).toEqual(['ST-700/2024']);
        expect(payload.clusterEvidencePackage.discovery.secondaryClusterIds).toEqual(['ST-123/2026']);
        expect(payload.clusterEvidencePackage.documentLinks[0].sourceProvenance).toEqual({
            acquisitionMode: 'search-window',
            sourceCaseNumber: 'ST-700/2024'
        });
        expect(payload.report.clusterId).toBe('ST-700/2024');
        expect(payload.processedCases).toHaveLength(1);
        expect(payload.processedCases[0].groupMetadata.expansionPlan).toEqual({
            targetClusterId: 'ST-700/2024',
            executable: true
        });
        expect(payload.processedCases[0].files).toEqual([
            { url: 'https://example.test/st700.zip', text: 'ST-700.zip' }
        ]);
        expect(payload.processedCases[0].files[0]).not.toHaveProperty('filePath');
        expect(payload.processedCases[0].analysis.individualAnalyses[0]).not.toHaveProperty('rawChunkCount');
    });
});
