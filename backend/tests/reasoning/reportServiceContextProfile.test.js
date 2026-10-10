const mockSynthesizeReport = jest.fn();
const mockNormalizeReasoningEvidence = jest.fn();
const mockVerifyReport = jest.fn();
const mockInvoke = jest.fn();
const mockRunQueryPlanner = jest.fn().mockResolvedValue([]);

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({ invoke: mockInvoke }))
}));

jest.mock('../../helpers/geminiRetry', () => ({
    withGeminiRetry: (fn) => fn(),
    withGeminiTimeout: (callable) => callable(undefined)
}));

jest.mock('../../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport
}));

jest.mock('../../court-analysis/reasoning/queryPlanner', () => ({
    runQueryPlanner: mockRunQueryPlanner,
    mergeRetrievalQueries: jest.requireActual('../../court-analysis/reasoning/queryPlanner').mergeRetrievalQueries
}));

const { generateClusterReport } = require('../../court-analysis/reasoning/reportService');
const {
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../court-analysis/reasoning/analysisLab/evidenceIdentity');

const LAB_FIXTURE = require('../fixtures/replays/analysis-lab/kerum-lab.json');

describe('reportService Lab profile seam (LC-3)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRunQueryPlanner.mockResolvedValue([]);
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
        const synthesizedReport = {
            schemaVersion: '1.0.0',
            narrative: 'Sažetak',
            findings: [{ text: 'Nalaz', confidence: 'medium', citations: [] }],
            claims: [],
            openQuestions: [],
            nextSteps: [],
            conflicts: [],
            meta: { clusterId: 'St-2/2013' }
        };
        mockSynthesizeReport.mockResolvedValue(synthesizedReport);
        mockVerifyReport.mockImplementation(async (report) => report);
    });

    test('without labProfile the persisted meta shape is unchanged (baseline parity)', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const result = await generateClusterReport(pkg, {});
        expect(result.meta).not.toHaveProperty('contextTrace');
        expect(result.meta).toHaveProperty('retrieval');
        expect(result.meta).toHaveProperty('rerank');
        expect(result.meta).toHaveProperty('scope');
        // Synthesis saw exactly the flat claims (baseline + retrieval), with
        // no context-layer claims.
        const synthesisEvidence = mockSynthesizeReport.mock.calls[0][0];
        expect(synthesisEvidence.claims[0].id).toBe('base-claim-1');
        expect(synthesisEvidence.claims.some((claim) => String(claim.id).startsWith('context-node-'))).toBe(false);
        expect(synthesisEvidence.meta.context).toBeUndefined();
    });

    test('context-tree-v1 layers branch claims and surfaces the trace in meta', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const digestBefore = evidencePackageDigest(pkg);
        const result = await generateClusterReport(pkg, { labProfile: 'context-tree-v1' });

        const synthesisEvidence = mockSynthesizeReport.mock.calls[0][0];
        expect(synthesisEvidence.claims[0].id).toBe('base-claim-1');
        expect(synthesisEvidence.claims.some((claim) => String(claim.id).startsWith('context-node-'))).toBe(true);
        expect(synthesisEvidence.meta.context).toMatchObject({
            profileId: 'context-tree-v1',
            nodeSummaries: 'off',
        });

        expect(result.meta.contextTrace).toMatchObject({
            profileId: 'context-tree-v1',
            strategy: 'case-context',
            rootId: expect.any(String),
        });
        expect(evidencePackageDigest(pkg)).toBe(digestBefore);
    });

    test('summaries-on profile with a model seam yields derived claims', async () => {
        const pkg = cloneEvidencePackage(LAB_FIXTURE);
        const summarizeLlm = jest.fn(async ({ packet }) => JSON.stringify({
            statements: [{
                text: 'Sažetak grane.',
                sourceDocumentIds: packet.availableIds.sourceDocumentIds.slice(0, 1),
                factIds: packet.availableIds.factIds.slice(0, 1),
                citationIds: [],
            }],
        }));
        const result = await generateClusterReport(pkg, {
            labProfile: 'context-tree-summarized-v1',
            summarizeLlm,
        });
        const synthesisEvidence = mockSynthesizeReport.mock.calls[0][0];
        expect(synthesisEvidence.claims.some((claim) => String(claim.id).startsWith('context-node-summary-'))).toBe(true);
        expect(result.meta.contextTrace.summaries.stats.calls).toBeGreaterThan(0);
    });

    test('unknown labProfile rejects without synthesizing', async () => {
        await expect(generateClusterReport(cloneEvidencePackage(LAB_FIXTURE), { labProfile: 'nope-v1' }))
            .rejects.toThrow(/Unknown analysis-lab profile/);
        expect(mockSynthesizeReport).not.toHaveBeenCalled();
    });
});
