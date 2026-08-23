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

    test('keeps non-verifiable document-link findings in place while verifying the rest', async () => {
        const mechanicalOne = {
            text: 'Dokument "Prilog 1.pdf" pripada odabranom predmetu St-2/2013.',
            confidence: 'medium',
            citations: [{ sourceId: 'doc-1', metadata: { sourceType: 'document-link' } }],
        };
        const substantive = {
            text: 'Tražbina od 100.000 EUR je priznata.',
            confidence: 'medium',
            citations: [],
        };
        const mechanicalTwo = {
            text: 'Dokument "Prilog 2.pdf" pripada odabranom predmetu St-2/2013.',
            confidence: 'high',
            evidence: [{ sourceId: 'doc-2', metadata: { sourceType: 'document-link' } }],
        };
        const mixedReport = {
            schemaVersion: SCHEMA_VERSION,
            findings: [mechanicalOne, substantive, mechanicalTwo],
            claims: [],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };

        mockInvoke.mockResolvedValue({
            content: JSON.stringify([
                { index: 1, status: 'supported', reason: 'Potvrđeno u dokumentima.', confidence: 'high' },
            ]),
        });

        const result = await verifyReport(mixedReport, mockEvidence);

        // All three findings survive, in the original order.
        expect(result.findings.map((finding) => finding.text)).toEqual([
            mechanicalOne.text,
            substantive.text,
            mechanicalTwo.text,
        ]);
        // Only the substantive finding was verified.
        expect(result.findings[1].confidence).toBe('high');
        expect(result.findings[1].citations[0].sourceId).toBe('verification-pass');
        // Mechanical findings pass through untouched — skipped, not deleted.
        expect(result.findings[0]).toBe(mechanicalOne);
        expect(result.findings[2]).toBe(mechanicalTwo);

        // The prompt diet still holds: only the substantive text is sent.
        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt).toContain(substantive.text);
        expect(prompt).not.toContain(mechanicalOne.text);
        expect(prompt).not.toContain(mechanicalTwo.text);
    });

    test('handles LLM failure gracefully', async () => {
        mockInvoke.mockRejectedValue(new Error('LLM error'));
        const result = await verifyReport(mockReport, mockEvidence);
        // Should return original report on failure
        expect(result).toBe(mockReport);
    });
});

describe('Verifier evidence diet', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    const summary = 'Stecajni postupak otvoren je 2013. protiv CroGo-Kerum d.o.o.';

    const evidenceWithNoise = () => ({
        timeline: [{ date: '2023-01-01', description: 'Objava otvaranja', evidence: [] }],
        claims: [
            {
                id: 'doc-1',
                text: 'Dokument "Prilog 1.pdf" pripada odabranom predmetu St-2/2013.',
                confidence: 'medium',
                evidence: [{
                    sourceId: 'doc-1',
                    text: 'Prilog 1.pdf',
                    metadata: { sourceType: 'document-link' },
                }],
            },
            {
                id: 'analysis-1',
                text: summary,
                confidence: 'medium',
                evidence: [{
                    sourceId: 'file-1',
                    text: summary,
                    metadata: { sourceType: 'analysis' },
                }],
            },
            {
                id: 'money-1',
                text: 'Financijski iznos 1.500 EUR (trgovacki dug).',
                confidence: 'medium',
                evidence: [{
                    sourceId: 'money-1',
                    text: '1500 EUR trgovacki dug',
                    metadata: { sourceType: 'analysis-amount' },
                }],
            },
        ],
        meta: {},
    });

    const reportWithFindings = () => ({
        schemaVersion: SCHEMA_VERSION,
        findings: [
            { text: 'Postupak je otvoren 2013.', confidence: 'medium', citations: [] },
        ],
        claims: [],
        openQuestions: [],
        conflicts: [],
        meta: {},
    });

    test('excludes document-link claims and duplicated claim echoes from the prompt', async () => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify([
                { index: 1, status: 'supported', reason: 'Potvrdeno', confidence: 'high' },
            ]),
        });

        await verifyReport(reportWithFindings(), evidenceWithNoise());

        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt).not.toContain('pripada odabranom predmetu');
        // The analysis summary appears exactly once even though the claim's
        // citation echoes it verbatim.
        expect(prompt.split(summary).length - 1).toBe(1);
        // Money-flow claims stay in scope for verification.
        expect(prompt).toContain('Financijski iznos');
    });

    test('skips the model entirely when only mechanical claims exist', async () => {
        const linkOnlyEvidence = {
            timeline: [],
            claims: [
                {
                    id: 'doc-1',
                    text: 'Dokument "a.pdf" pripada odabranom predmetu St-2/2013.',
                    confidence: 'medium',
                    evidence: [{ sourceId: 'doc-1', text: 'a.pdf', metadata: { sourceType: 'document-link' } }],
                },
            ],
            meta: {},
        };
        const report = {
            schemaVersion: SCHEMA_VERSION,
            findings: [],
            claims: [
                {
                    id: 'doc-1',
                    text: 'Dokument "a.pdf" pripada odabranom predmetu St-2/2013.',
                    confidence: 'medium',
                    evidence: [{ sourceId: 'doc-1', text: 'a.pdf', metadata: { sourceType: 'document-link' } }],
                },
            ],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };

        const result = await verifyReport(report, linkOnlyEvidence);

        expect(mockInvoke).not.toHaveBeenCalled();
        expect(result).toBe(report);
    });

    test('legacy claims without sourceType remain verifiable', async () => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify([
                { index: 1, status: 'supported', reason: 'ok', confidence: 'high' },
            ]),
        });

        const legacyReport = {
            schemaVersion: SCHEMA_VERSION,
            findings: [{ text: 'Legacy finding', confidence: 'medium', citations: [] }],
            claims: [],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };

        const result = await verifyReport(legacyReport, {
            timeline: [],
            claims: [{ id: 'c1', text: 'Legacy substantive claim', confidence: 'medium', evidence: [] }],
            meta: {},
        });

        expect(mockInvoke).toHaveBeenCalledTimes(1);
        expect(result.findings[0].confidence).toBe('high');
    });
});
