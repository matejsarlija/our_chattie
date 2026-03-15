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
    withGeminiRetry: jest.fn((fn) => fn())
}));

describe('Verifier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockReport = {
        schemaVersion: SCHEMA_VERSION,
        claims: [
            { id: 'c1', text: 'Defendant paid the debt', confidence: 'medium', evidence: [] },
            { id: 'c2', text: 'Case was dismissed', confidence: 'medium', evidence: [] }
        ],
        meta: { openQuestions: [] }
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

        expect(verifiedReport.claims).toHaveLength(1); // Only c1 supported
        expect(verifiedReport.claims[0].id).toBe('c1');
        expect(verifiedReport.claims[0].confidence).toBe('high');
        expect(verifiedReport.claims[0].evidence[0].text).toContain('Timeline mentions debt paid');

        expect(verifiedReport.meta.openQuestions).toHaveLength(1);
        expect(verifiedReport.meta.openQuestions[0]).toContain('Unverified claim: Case was dismissed');
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

        // Contradicted claim is kept but marked low confidence and flagged
        expect(verifiedReport.claims[0].id).toBe('c1');
        expect(verifiedReport.claims[0].confidence).toBe('low');
        
        // Check conflicts array (new field)
        expect(verifiedReport.meta.conflicts).toHaveLength(1);
        expect(verifiedReport.meta.conflicts[0].claim).toContain('Defendant paid the debt');
        expect(verifiedReport.meta.conflicts[0].conflict).toContain('Evidence says debt NOT paid');
    });

    test('handles empty report gracefully', async () => {
        const emptyReport = { schemaVersion: SCHEMA_VERSION, claims: [], meta: {} };
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
