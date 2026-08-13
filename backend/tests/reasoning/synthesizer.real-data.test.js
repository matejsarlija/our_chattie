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

// 5. Require the module under test (which instantiates the class)
const { synthesizeReport, createEvidenceFromProcessedCases } = require('../../court-analysis/reasoning/synthesizer');

// Mock retry helper
jest.mock("../../helpers/geminiRetry", () => ({
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined))
}));

describe('Synthesizer Integration with Real Data', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const realCaseData = {
        caseResult: {
            caseNumber: 'St-2/2013',
            participants: [
                { name: 'CRO-GO d.o.o.', role: 'Vjerovnik' },
                { name: 'KERUM d.o.o. u stečaju', role: 'Dužnik' }
            ]
        },
        analysis: {
            individualAnalyses: [
                {
                    filePath: 'backend/uploads/Prilog St-2_2013-1196-1 - CroGo-Kerum_I°-2.pdf',
                    aiResult: {
                        summary: "Trgovački sud u Splitu donio je presudu kojom se odbija tužbeni zahtjev tužitelja CRO-GO d.o.o. protiv tuženika KERUM d.o.o. u stečaju radi isplate.",
                        decisionDate: "2022-05-11", // ISO format extracted by agent
                        parties: ["CRO-GO d.o.o.", "KERUM d.o.o. u stečaju"]
                    }
                },
                {
                    filePath: 'backend/uploads/Troškovnik.pdf',
                    aiResult: {
                        summary: "Troškovnik sudskih pristojbi i troškova postupka.",
                        // No date
                    }
                }
            ]
        }
    };

    test('correctly transforms real-world processed cases into evidence package', () => {
        const evidence = createEvidenceFromProcessedCases([realCaseData]);

        expect(evidence.meta.caseNumber).toBe('St-2/2013');
        expect(evidence.meta.parties).toContain('CRO-GO d.o.o.');
        expect(evidence.meta.parties).toContain('KERUM d.o.o. u stečaju');

        expect(evidence.timeline).toHaveLength(1);
        expect(evidence.timeline[0].date).toBe('2022-05-11');
        expect(evidence.timeline[0].description).toContain('Trgovački sud u Splitu');

        expect(evidence.claims).toHaveLength(2); // One per summary
        expect(evidence.claims[0].text).toContain('odbija tužbeni zahtjev');
    });

    test('generates synthesis prompt with rich context from real data', async () => {
        const evidence = createEvidenceFromProcessedCases([realCaseData]);
        
        // Mock LLM response
        mockInvoke.mockResolvedValue({
            content: `\`\`\`json
            {
                "narrative": "Sud je odbio zahtjev vjerovnika CRO-GO d.o.o.",
                "findings": [
                    { "text": "Zahtjev odbijen", "confidence": "high" }
                ],
                "openQuestions": [],
                "nextSteps": ["Žalba?"]
            }
            \`\`\``
        });

        const report = await synthesizeReport(evidence);

        // Verify the prompt content sent to LLM
        const lastCallArgs = mockInvoke.mock.calls[0][0];
        const promptText = typeof lastCallArgs === 'string' ? lastCallArgs : lastCallArgs[0]?.content || lastCallArgs;

        // Check for specific Croatian entities and dates in the prompt
        expect(promptText).toContain('St-2/2013');
        expect(promptText).toContain('CRO-GO d.o.o.');
        expect(promptText).toContain('KERUM d.o.o. u stečaju');
        expect(promptText).toContain('2022-05-11'); // Timeline event
        expect(promptText).toContain('Trgovački sud u Splitu'); // Description from summary

        // Verify output structure
        expect(report.schemaVersion).toBe(SCHEMA_VERSION);
        expect(report.narrative).toContain('Sud je odbio zahtjev');
        expect(report.claims.length).toBeGreaterThan(0); // Should retain input claims
    });

    test('packages only one selected cluster instead of flattening multiple processed cases', () => {
        const secondaryCaseData = {
            caseResult: {
                caseNumber: 'St-445/2018',
                participants: [
                    { name: 'OTHER d.o.o.', role: 'Dužnik' }
                ]
            },
            groupMetadata: {
                clusterId: 'St-445/2018',
                identityConsistency: 'ambiguous',
                identityNotes: ['OIB missing on secondary cluster']
            },
            analysis: {
                individualAnalyses: [
                    {
                        filePath: 'backend/uploads/other.pdf',
                        aiResult: {
                            summary: 'Drugi predmet s drugim činjeničnim stanjem.',
                            decisionDate: '2024-01-10'
                        }
                    }
                ]
            }
        };

        const evidence = createEvidenceFromProcessedCases([realCaseData, secondaryCaseData]);

        expect(evidence.meta.caseNumber).toBe('St-2/2013');
        expect(evidence.meta.clusterId).toBe('St-2/2013');
        expect(evidence.meta.parties).toContain('CRO-GO d.o.o.');
        expect(evidence.meta.parties).not.toContain('OTHER d.o.o.');
        expect(evidence.claims).toHaveLength(2);
        expect(evidence.claims.some(claim => claim.text.includes('Drugi predmet'))).toBe(false);
    });
});
