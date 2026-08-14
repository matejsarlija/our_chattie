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
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined))
}));

// Import the synthesizer (which we will write next)
// We use a relative path assuming the test file is in backend/tests/reasoning
const {
    synthesizeReport,
    createReasoningEvidenceFromPackage
} = require('../../court-analysis/reasoning/synthesizer');
const { SCHEMA_VERSION, validateReport } = require('../../court-analysis/reasoning/schema');
const { validateClusterEvidencePackage } = require('../../court-analysis/reasoning/evidencePackage');

describe('Synthesizer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const mockEvidence = {
        timeline: [
            { date: '2023-01-01', description: 'Case started', evidence: [] },
            { date: '2023-02-01', description: 'Hearing held', evidence: [{ sourceId: 'd1', text: 'quote', provenance: { acquisitionMode: 'search-window' } }] }
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

        // Timeline conformance: report.timeline is populated from evidence with citations
        expect(report.timeline).toHaveLength(2);
        expect(report.timeline[0]).toMatchObject({ date: '2023-01-01', description: 'Case started', citations: [] });
        expect(report.timeline[1].citations).toEqual([
            { source: 'd1', text: 'quote', provenance: { acquisitionMode: 'search-window' } }
        ]);

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
        expect(report.timeline).toEqual([]);
    });

    test('downgrades structural findings and surfaces an open question when most document analyses fail', async () => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify({
                narrative: 'Sažetak.',
                findings: [{ text: 'Dokument pripada predmetu.', confidence: 'high', citations: ['doc-1'] }],
                openQuestions: [],
                nextSteps: []
            })
        });

        const report = await synthesizeReport({
            timeline: [],
            claims: [{ id: 'document-1', text: 'Dokument pripada predmetu.', confidence: 'medium', evidence: [{ sourceId: 'doc-1', text: 'Strukturna poveznica dokumenta.', metadata: { sourceType: 'document-link' } }] }],
            meta: { caseNumber: 'ST-700/2024', coverage: { analyzed: 1, failed: 2, total: 3 } }
        });

        expect(mockInvoke.mock.calls[0][0]).toContain('DOCUMENT COVERAGE WARNING');
        expect(report.findings[0].confidence).toBe('low');
        expect(report.openQuestions.join(' ')).toContain('Analiza dokumenata nije potpuna');
    });

    test('populates report.timeline from the evidence timeline with citations', async () => {
        mockInvoke.mockResolvedValue({
            content: `{
                "narrative": "Sažetak temeljen na vremenskoj crti.",
                "findings": [],
                "openQuestions": [],
                "nextSteps": []
            }`
        });

        const report = await synthesizeReport(mockEvidence);

        expect(report.timeline).toBeDefined();
        expect(report.timeline).toHaveLength(2);
        expect(report.timeline[0]).toEqual({
            date: '2023-01-01',
            description: 'Case started',
            citations: []
        });
        expect(report.timeline[1].citations).toHaveLength(1);
        expect(report.timeline[1].citations[0]).toEqual({
            source: 'd1',
            text: 'quote',
            provenance: { acquisitionMode: 'search-window' }
        });
        expect(validateReport(report).valid).toBe(true);
    });

    test('throws/handles invalid JSON from LLM', async () => {
        mockInvoke.mockResolvedValue({ content: "This is not JSON" });

        await expect(synthesizeReport(mockEvidence)).rejects.toThrow(); 
    });

    test('validates single-cluster evidence package invariants', () => {
        const validPackage = {
            packageType: 'ClusterEvidencePackage',
            reasoningScope: 'single-cluster',
            selectedClusterIds: ['ST-700/2024'],
            clusterId: 'ST-700/2024',
            primaryCaseNumber: 'ST-700/2024',
            discovery: {
                reasoningClusterId: 'ST-700/2024',
                secondaryClusterIds: ['ST-123/2026']
            },
            entries: [{ caseNumber: 'ST-700/2024', title: 'Objava' }],
            documentLinks: [{ caseNumber: 'ST-700/2024', url: 'https://example.test/doc.pdf' }]
        };

        expect(validateClusterEvidencePackage(validPackage)).toEqual({ valid: true });
        expect(validateClusterEvidencePackage({
            ...validPackage,
            selectedClusterIds: ['ST-700/2024', 'ST-123/2026']
        }).valid).toBe(false);
        expect(validateClusterEvidencePackage({
            ...validPackage,
            discovery: { reasoningClusterId: 'ST-999/2026' }
        }).valid).toBe(false);
        expect(validateClusterEvidencePackage({
            ...validPackage,
            entries: [{ caseNumber: 'ST-123/2026', title: 'Secondary' }]
        }).valid).toBe(false);
    });

    test('creates reasoning evidence from the selected-cluster package without flattening secondary clusters', () => {
        const packageInput = {
            packageType: 'ClusterEvidencePackage',
            schemaVersion: 1,
            reasoningScope: 'single-cluster',
            selectedClusterIds: ['ST-700/2024'],
            clusterId: 'ST-700/2024',
            primaryCaseNumber: 'ST-700/2024',
            query: { type: 'text', value: 'JADRAN' },
            identity: {
                consistency: 'consistent',
                notes: [],
                participantNames: ['JADRAN d.o.o.'],
                participantOibs: ['88888888888']
            },
            discovery: {
                reasoningClusterId: 'ST-700/2024',
                recommendedPrimaryClusterId: 'ST-700/2024',
                secondaryClusterIds: ['ST-123/2026'],
                discoveryMode: 'search-window',
                totalResults: 21,
                pagesScanned: 1
            },
            selection: {
                score: 0.72,
                diagnostics: { finalSelectionScore: 0.72 }
            },
            expansion: {
                plan: { targetClusterId: 'ST-700/2024', executable: true }
            },
            acquisition: {
                modes: ['search-window', 'cluster-expansion']
            },
            entries: [
                {
                    caseNumber: 'ST-700/2024',
                    title: 'Rješenje od 10.02.2025.',
                    date: '10.02.2025.',
                    participants: [{ name: 'JADRAN d.o.o.' }],
                    acquisition: { mode: 'search-window', currentPage: 1 }
                }
            ],
            documentLinks: [
                {
                    id: 'ST-700/2024::entry-1::doc-1',
                    caseNumber: 'ST-700/2024',
                    url: 'https://example.test/st700-1',
                    text: 'st700-1.pdf',
                    sourceProvenance: {
                        acquisitionMode: 'search-window',
                        sourceCaseNumber: 'ST-700/2024'
                    }
                }
            ]
        };

        const evidence = createReasoningEvidenceFromPackage(packageInput);

        expect(evidence.meta.clusterId).toBe('ST-700/2024');
        expect(evidence.meta.discovery.reasoningClusterId).toBe('ST-700/2024');
        expect(evidence.meta.discovery.secondaryClusterIds).toEqual(['ST-123/2026']);
        expect(evidence.meta.selection.score).toBe(0.72);
        expect(evidence.meta.expansion.plan.targetClusterId).toBe('ST-700/2024');
        expect(evidence.meta.documentLinks[0].sourceProvenance).toEqual({
            acquisitionMode: 'search-window',
            sourceCaseNumber: 'ST-700/2024'
        });
        expect(evidence.timeline).toHaveLength(1);
        expect(evidence.claims).toHaveLength(1);
        expect(evidence.claims[0].evidence[0].provenance.acquisitionMode).toBe('search-window');
        expect(evidence.claims.some((claim) => claim.text.includes('ST-123/2026'))).toBe(false);
    });

    test('synthesizes reports directly from ClusterEvidencePackage and keeps package metadata in report.meta', async () => {
        mockInvoke.mockResolvedValue({
            content: `{
                "narrative": "Predmet ST-700/2024 obrađen je iz odabranog paketa dokaza.",
                "findings": [
                    { "text": "Dokument pripada odabranom predmetu", "confidence": "medium" }
                ],
                "openQuestions": [],
                "nextSteps": []
            }`
        });

        const report = await synthesizeReport({
            packageType: 'ClusterEvidencePackage',
            schemaVersion: 1,
            reasoningScope: 'single-cluster',
            selectedClusterIds: ['ST-700/2024'],
            clusterId: 'ST-700/2024',
            primaryCaseNumber: 'ST-700/2024',
            identity: { participantNames: ['JADRAN d.o.o.'], participantOibs: ['88888888888'] },
            discovery: {
                reasoningClusterId: 'ST-700/2024',
                recommendedPrimaryClusterId: 'ST-700/2024',
                secondaryClusterIds: ['ST-123/2026']
            },
            entries: [
                { caseNumber: 'ST-700/2024', title: 'Rješenje', date: '10.02.2025.' }
            ],
            documentLinks: [
                {
                    id: 'doc-1',
                    caseNumber: 'ST-700/2024',
                    text: 'st700.pdf',
                    url: 'https://example.test/st700.pdf',
                    sourceProvenance: { acquisitionMode: 'search-window', sourceCaseNumber: 'ST-700/2024' }
                }
            ]
        });

        const prompt = mockInvoke.mock.calls[0][0];

        expect(prompt).toContain('ST-700/2024');
        expect(prompt).toContain('JADRAN d.o.o.');
        expect(report.schemaVersion).toBe(SCHEMA_VERSION);
        expect(report.meta.packageType).toBe('ClusterEvidencePackage');
        expect(report.meta.clusterId).toBe('ST-700/2024');
        expect(report.meta.discovery.reasoningClusterId).toBe('ST-700/2024');
        expect(report.meta.discovery.secondaryClusterIds).toEqual(['ST-123/2026']);
        expect(report.claims[0].evidence[0].provenance).toEqual({
            acquisitionMode: 'search-window',
            sourceCaseNumber: 'ST-700/2024'
        });
        expect(report.timeline).toHaveLength(1);
        expect(report.timeline[0].date).toBe('10.02.2025.');
        expect(report.timeline[0].description).toContain('ST-700/2024');
        expect(report.timeline[0].citations).toHaveLength(1);
        expect(report.timeline[0].citations[0].source).toBe('ST-700/2024:entry-1');
    });
});
