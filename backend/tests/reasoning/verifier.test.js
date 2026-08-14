const { SCHEMA_VERSION } = require('../../court-analysis/reasoning/schema');

// 1. Mock the module factory
jest.mock("@langchain/google-genai");

// 2. Import the mocked class
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");

// 3. Create the mock function we want to track
const mockInvoke = jest.fn();

// 4. Set the implementation BEFORE requiring the module under test
ChatGoogleGenerativeAI.mockImplementation(() => ({
    invoke: mockInvoke
}));

// 5. Require the module under test
const { verifyReport } = require('../../court-analysis/reasoning/verifier');

// Mock retry helper
jest.mock("../../helpers/geminiRetry", () => ({
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined))
}));

describe('Verifier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockReport = {
        schemaVersion: SCHEMA_VERSION,
        findings: [
            { text: 'Defendant paid the debt', confidence: 'medium', citations: [] },
            { text: 'Case was dismissed', confidence: 'medium', citations: [] }
        ],
        claims: [
            { id: 'c1', text: 'Raw extracted claim: debt payment mentioned in source', confidence: 'medium', evidence: [] },
            { id: 'c2', text: 'Raw extracted claim: dismissal not yet verified', confidence: 'medium', evidence: [] }
        ],
        openQuestions: [],
        conflicts: [],
        timeline: [
            { date: '2023-01-01', description: 'Debt was paid in full', citations: [{ source: 'd1', text: 'quote' }] }
        ],
        meta: {}
    };

    const mockEvidence = {
        timeline: [
            { date: '2023-01-01', description: 'Debt was paid in full', evidence: [] }
        ],
        claims: []
    };

    test('verifies supported claims and adds evidence', async () => {
        // Mock LLM response: c1 supported, c2 unsupported
        mockInvoke.mockResolvedValue({
            content: `\`\`\`json
            [
                { "index": 1, "status": "supported", "reason": "Timeline mentions debt paid", "confidence": "high" },
                { "index": 2, "status": "unsupported", "reason": "No mention of dismissal", "confidence": "low" }
            ]
            \`\`\``
        });

        const verifiedReport = await verifyReport(mockReport, mockEvidence);

        expect(verifiedReport.findings).toHaveLength(1); // Only supported synthesized finding remains
        expect(verifiedReport.findings[0].text).toBe('Defendant paid the debt');
        expect(verifiedReport.findings[0].confidence).toBe('high');
        expect(verifiedReport.findings[0].citations[0].text).toContain('Timeline mentions debt paid');

        expect(verifiedReport.claims).toEqual(mockReport.claims);
        expect(verifiedReport.openQuestions).toHaveLength(1);
        expect(verifiedReport.openQuestions[0]).toContain('Unverified finding: Case was dismissed');
        expect(verifiedReport.timeline).toEqual(mockReport.timeline);
    });

    test('handles contradictions correctly', async () => {
        // Mock LLM response: c1 contradicted
        mockInvoke.mockResolvedValue({
            content: `\`\`\`json
            [
                { "index": 1, "status": "contradicted", "reason": "Evidence says debt NOT paid", "confidence": "low" },
                { "index": 2, "status": "unsupported", "reason": "Not found", "confidence": "low" }
            ]
            \`\`\``
        });

        const verifiedReport = await verifyReport(mockReport, mockEvidence);

        expect(verifiedReport.findings[0].text).toBe('Defendant paid the debt');
        expect(verifiedReport.findings[0].confidence).toBe('low');
        
        expect(verifiedReport.conflicts).toHaveLength(1);
        expect(verifiedReport.conflicts[0].finding).toContain('Defendant paid the debt');
        expect(verifiedReport.conflicts[0].reason).toContain('Evidence says debt NOT paid');
    });

    test('does not let verification raise structural findings above low confidence when document coverage is poor', async () => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify([
                { index: 1, status: 'supported', reason: 'Poveznica je pronađena.', confidence: 'high' },
                { index: 2, status: 'unsupported', reason: 'Nije pronađeno.', confidence: 'low' }
            ])
        });

        const result = await verifyReport(mockReport, {
            ...mockEvidence,
            meta: { coverage: { analyzed: 0, failed: 2, total: 2 } }
        });

        expect(result.findings[0].confidence).toBe('low');
        expect(result.openQuestions.join(' ')).toContain('Analiza dokumenata nije potpuna');
    });

    test('handles empty report gracefully', async () => {
        const emptyReport = { schemaVersion: SCHEMA_VERSION, claims: [], findings: [], meta: {} };
        const result = await verifyReport(emptyReport, mockEvidence);
        expect(result).toBe(emptyReport);
    });

    test('handles LLM failure gracefully', async () => {
        mockInvoke.mockRejectedValue(new Error('LLM error'));
        const result = await verifyReport(mockReport, mockEvidence);
        // Should return original report on failure
        expect(result).toBe(mockReport);
    });
});
