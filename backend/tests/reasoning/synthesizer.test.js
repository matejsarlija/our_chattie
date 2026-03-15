// Mocking necessary modules
const { HumanMessage } = require("@langchain/core/messages");

// Mock ChatGoogleGenerativeAI
const mockInvoke = jest.fn();
jest.mock("@langchain/google-genai", () => {
    return {
        ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
            invoke: mockInvoke
        }))
    };
});

// Mock retry helper
jest.mock("../../helpers/geminiRetry", () => ({
    withGeminiRetry: jest.fn((fn) => fn())
}));

// Import the synthesizer (which we will write next)
// We use a relative path assuming the test file is in backend/tests/reasoning
const { synthesizeReport } = require('../../court-analysis/reasoning/synthesizer');
const { SCHEMA_VERSION, validateReport } = require('../../court-analysis/reasoning/schema');

describe('Synthesizer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockEvidence = {
        timeline: [
            { date: '2023-01-01', description: 'Case started', evidence: [] },
            { date: '2023-02-01', description: 'Hearing held', evidence: [] }
        ],
        claims: [
            { id: 'c1', text: 'Defendant is liable', confidence: 'high', evidence: [{ sourceId: 'd1', text: 'quote' }] }
        ],
        meta: {
            caseNumber: 'St-123/2023',
            parties: ['Party A', 'Party B']
        }
    };

    test('generates a valid structured report', async () => {
        // Mock the LLM response
        const mockResponse = {
            content: `\`\`\`json
            {
                "narrative": "Ovo je sažetak slučaja na hrvatskom jeziku.",
                "findings": [
                    {
                        "claim": "Defendant is liable",
                        "confidence": "high",
                        "citations": ["d1"]
                    }
                ],
                "openQuestions": ["Will they settle?"],
                "nextSteps": ["Wait for judgment"]
            }
            \`\`\``
        };
        mockInvoke.mockResolvedValue(mockResponse);

        const report = await synthesizeReport(mockEvidence);

        expect(report).toBeDefined();
        expect(report.schemaVersion).toBe(SCHEMA_VERSION);
        expect(report.narrative).toBe("Ovo je sažetak slučaja na hrvatskom jeziku.");
        expect(report.findings).toHaveLength(1);
        
        // Validate against schema
        const validation = validateReport(report);
        expect(validation.valid).toBe(true);

        // Check if the prompt contained key info
        const lastCallArgs = mockInvoke.mock.calls[0][0];
        // lastCallArgs should be a string or array of messages. 
        // Our implementation will likely pass a string or HumanMessage.
        // Let's assume it passes a string for now or we check the content.
        const promptText = typeof lastCallArgs === 'string' ? lastCallArgs : lastCallArgs[0]?.content || lastCallArgs;
        expect(promptText).toContain('St-123/2023');
        expect(promptText).toContain('Party A');
    });

    test('handles empty evidence gracefully', async () => {
        const mockResponse = {
             content: `\`\`\`json
            {
                "narrative": "Nema dovoljno informacija.",
                "findings": [],
                "openQuestions": [],
                "nextSteps": []
            }
            \`\`\``
        };
        mockInvoke.mockResolvedValue(mockResponse);

        const emptyEvidence = { timeline: [], claims: [], meta: {} };
        const report = await synthesizeReport(emptyEvidence);
        
        expect(report.narrative).toContain("Nema dovoljno informacija");
        expect(report.findings).toEqual([]);
    });

    test('throws/handles invalid JSON from LLM', async () => {
        mockInvoke.mockResolvedValue({ content: "This is not JSON" });

        await expect(synthesizeReport(mockEvidence)).rejects.toThrow(); 
    });
});
