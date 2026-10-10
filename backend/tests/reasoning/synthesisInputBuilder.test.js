const mockNormalizeReasoningEvidence = jest.fn();

jest.mock('../../court-analysis/reasoning/synthesizer', () => ({
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

const { buildSynthesisInput } = require('../../court-analysis/reasoning/synthesisInputBuilder');

describe('synthesisInputBuilder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockNormalizeReasoningEvidence.mockImplementation((pkg) => ({
            timeline: [{ date: '01.02.2025', description: `Objava ${pkg.clusterId}`, evidence: [] }],
            claims: [{
                id: 'base-claim-1',
                text: `Osnovni dokaz za ${pkg.clusterId}`,
                confidence: 'medium',
                evidence: []
            }],
            meta: { clusterId: pkg.clusterId }
        }));
    });

    test('builds compact synthesis input from selected-cluster evidence and reranked retrieval', () => {
        const evidencePackage = {
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023',
            selectedClusterIds: ['ST-100/2023'],
            discovery: {
                secondaryClusterIds: ['P-200/2024']
            }
        };
        const retrieval = {
            results: [{
                query: { id: 'amounts', purpose: 'financial-amounts' },
                matches: [{
                    sourceId: 'doc-1',
                    text: 'Tražbina 10.000 EUR',
                    score: 8,
                    reasons: ['token:trazbina'],
                    metadata: { caseNumber: 'ST-100/2023' }
                }]
            }],
            metrics: { matchCount: 1 }
        };
        const rerank = {
            ...retrieval,
            rerankStatus: 'skipped',
            results: [{
                ...retrieval.results[0],
                rerankStatus: 'skipped',
                matches: [{
                    ...retrieval.results[0].matches[0],
                    lexicalRank: 1,
                    rerankStatus: 'skipped',
                    rerankScore: null
                }]
            }]
        };

        const input = buildSynthesisInput(evidencePackage, retrieval, rerank);

        expect(mockNormalizeReasoningEvidence).toHaveBeenCalledWith(evidencePackage);
        expect(input).toEqual(expect.objectContaining({
            timeline: expect.any(Array),
            meta: expect.objectContaining({
                clusterId: 'ST-100/2023',
                retrieval,
                rerank
            })
        }));
        expect(input.claims).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'base-claim-1' }),
            expect.objectContaining({
                text: expect.stringContaining('Tražbina 10.000 EUR'),
                evidence: expect.arrayContaining([
                    expect.objectContaining({
                        sourceId: 'doc-1',
                        retrievalScore: 8,
                        lexicalRank: 1,
                        rerankStatus: 'skipped'
                    })
                ])
            })
        ]));
    });

    test('excludes retrieval matches from secondary clusters', () => {
        const evidencePackage = {
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023',
            selectedClusterIds: ['ST-100/2023'],
            discovery: {
                secondaryClusterIds: ['P-200/2024']
            }
        };
        const retrieval = {
            results: [{
                query: { id: 'timeline', purpose: 'timeline' },
                matches: [
                    {
                        sourceId: 'selected-entry',
                        text: 'Rješenje u odabranom predmetu',
                        score: 6,
                        metadata: { caseNumber: 'ST-100/2023' }
                    },
                    {
                        sourceId: 'secondary-entry',
                        text: 'Objava iz sekundarnog predmeta',
                        score: 5,
                        metadata: { caseNumber: 'P-200/2024' }
                    }
                ]
            }]
        };
        const rerank = {
            ...retrieval,
            rerankStatus: 'skipped',
            results: [{
                ...retrieval.results[0],
                matches: retrieval.results[0].matches.map((match, index) => ({
                    ...match,
                    lexicalRank: index + 1,
                    rerankStatus: 'skipped'
                }))
            }]
        };

        const input = buildSynthesisInput(evidencePackage, retrieval, rerank);
        const claimTexts = input.claims.map((claim) => claim.text).join('\n');

        expect(claimTexts).toContain('Rješenje u odabranom predmetu');
        expect(claimTexts).not.toContain('Objava iz sekundarnog predmeta');
    });
    test('spreads the full cited-claim limit across the chronology', () => {
        mockNormalizeReasoningEvidence.mockReturnValue({
            timeline: [],
            claims: Array.from({ length: 24 }, (_, index) => ({
                id: `analysis-${index + 1}`,
                text: `Document summary ${index + 1}`,
                confidence: 'medium',
                evidence: [{
                    sourceId: `document-${index + 1}`,
                    text: `Document summary ${index + 1}`,
                    metadata: {
                        sourceType: 'analysis',
                        fileName: `document-${index + 1}.pdf`,
                    },
                }],
            })),
            meta: {},
        });
        const reranked = {
            results: Array.from({ length: 24 }, (_, index) => ({
                matches: [{
                    sourceId: `document-${index + 1}`,
                    text: `Ground truth passage ${index + 1}`,
                    metadata: {
                        sourceType: 'chunk',
                        fileName: `document-${index + 1}.pdf`,
                    },
                }],
            })),
        };

        const input = buildSynthesisInput({ clusterId: 'St-1/2024' }, reranked, reranked);
        const fullClaims = input.claims.filter((claim) => claim.id.startsWith('analysis-') && claim.digest !== true);

        expect(fullClaims.map((claim) => claim.id)).toEqual([
            'analysis-1', 'analysis-3', 'analysis-5', 'analysis-7',
            'analysis-9', 'analysis-11', 'analysis-14', 'analysis-16',
            'analysis-18', 'analysis-20', 'analysis-22', 'analysis-24',
        ]);
        expect(input.claims.find((claim) => claim.id === 'analysis-12').digest).toBe(true);
    });
});
