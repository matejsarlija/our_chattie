const mockSynthesizeReport = jest.fn();
const mockNormalizeReasoningEvidence = jest.fn();
const mockVerifyReport = jest.fn();

jest.mock('../../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport
}));

const { generateClusterReport } = require('../../court-analysis/reasoning/reportService');

describe('reasoning reportService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockNormalizeReasoningEvidence.mockImplementation((evidencePackage) => ({
            timeline: [{ date: null, description: `Objava ${evidencePackage.clusterId}`, evidence: [] }],
            claims: [{
                id: 'base-claim-1',
                text: `Osnovni dokaz za ${evidencePackage.clusterId}`,
                confidence: 'medium',
                evidence: []
            }],
            meta: { clusterId: evidencePackage.clusterId }
        }));
    });

    test('synthesizes and verifies against normalized evidence enriched with retrieved matches', async () => {
        const evidencePackage = {
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023',
            primaryCaseNumber: 'ST-100/2023',
            query: { type: 'case_number', value: 'ST-100/2023' },
            documentLinks: [{
                id: 'doc-1',
                text: 'Rješenje navodi tražbinu od 10.000 EUR',
                caseNumber: 'ST-100/2023'
            }]
        };
        const synthesizedReport = {
            schemaVersion: '1.0.0',
            narrative: 'Sažetak',
            findings: [{ text: 'Nalaz', confidence: 'medium', citations: [] }],
            claims: [],
            openQuestions: [],
            nextSteps: [],
            conflicts: [],
            meta: { clusterId: 'ST-100/2023' }
        };
        const verifiedReport = {
            ...synthesizedReport,
            verifiedFindings: synthesizedReport.findings
        };
        const onStage = jest.fn();

        mockSynthesizeReport.mockResolvedValue(synthesizedReport);
        mockVerifyReport.mockResolvedValue(verifiedReport);

        const result = await generateClusterReport(evidencePackage, { onStage });
        const synthesisEvidence = mockSynthesizeReport.mock.calls[0][0];

        expect(result).toEqual(expect.objectContaining({
            schemaVersion: '1.0.0',
            verifiedFindings: synthesizedReport.findings
        }));
        expect(result.meta.retrieval).toEqual(expect.objectContaining({
            metrics: expect.objectContaining({
                queryCount: 4
            })
        }));
        expect(result.meta.rerank).toEqual(expect.objectContaining({
            rerankStatus: 'skipped',
            metrics: expect.objectContaining({
                rerankedMatchCount: expect.any(Number)
            })
        }));
        expect(mockNormalizeReasoningEvidence).toHaveBeenCalledWith(evidencePackage);
        expect(synthesisEvidence).toEqual(expect.objectContaining({
            timeline: expect.any(Array),
            meta: expect.objectContaining({
                clusterId: 'ST-100/2023',
                retrieval: expect.objectContaining({
                    metrics: expect.objectContaining({ matchCount: expect.any(Number) })
                }),
                rerank: expect.objectContaining({
                    rerankStatus: 'skipped'
                })
            })
        }));
        expect(synthesisEvidence.claims).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'base-claim-1' }),
            expect.objectContaining({
                id: expect.stringMatching(/^retrieved-/),
                text: expect.stringContaining('Rješenje navodi tražbinu od 10.000 EUR'),
                evidence: expect.arrayContaining([
                    expect.objectContaining({
                        sourceId: 'doc-1',
                        text: expect.stringContaining('Rješenje navodi tražbinu od 10.000 EUR'),
                        rerankStatus: 'skipped'
                    })
                ])
            })
        ]));
        expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ step: 'verifying' }));
        expect(mockVerifyReport).toHaveBeenCalledWith(synthesizedReport, synthesisEvidence, expect.any(Object));
    });
});
