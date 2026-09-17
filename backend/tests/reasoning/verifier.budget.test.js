const mockInvoke = jest.fn();

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({ invoke: mockInvoke }))
}));

jest.mock('../../helpers/geminiRetry', () => ({
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined))
}));

const { verifyReport } = require('../../court-analysis/reasoning/verifier');

describe('verifier evidence char budget (refinement 4)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockInvoke.mockResolvedValue({ content: '[]' });
    });

    test('caps the assembled evidence and annotates truncation in the prompt', async () => {
        const hugeClaim = {
            id: 'claim-1',
            text: 'Nalaz za provjeru.',
            confidence: 'medium',
            evidence: Array.from({ length: 200 }, (_, i) => ({
                sourceId: `src-${i}`,
                text: `Odlomak dokaza broj ${i} s puno sadržaja koji naduva budžet. `.repeat(5)
            }))
        };
        const report = { findings: [], claims: [hugeClaim], openQuestions: [], conflicts: [] };
        // Evidence lines assemble from evidencePackage.claims — that is where
        // the budget must bind.
        const evidencePackage = {
            timeline: [{ date: '2024-01-01', description: 'Objava' }],
            claims: [hugeClaim]
        };

        await verifyReport(report, evidencePackage);

        expect(mockInvoke).toHaveBeenCalledTimes(1);
        const promptText = mockInvoke.mock.calls[0][0];
        expect(typeof promptText).toBe('string');
        expect(promptText).toContain('[Dokazni materijal je skraćen');
        const citedSnippets = (promptText.match(/\[Citation src-/g) || []).length;
        expect(citedSnippets).toBeLessThan(200);
        expect(citedSnippets).toBeGreaterThan(0);
    });

    test('small evidence passes through untruncated without the marker', async () => {
        const smallClaim = {
            id: 'c1',
            text: 'Mali nalaz.',
            confidence: 'medium',
            evidence: [{ sourceId: 's1', text: 'kratki dokaz' }]
        };
        const report = { findings: [{ ...smallClaim, id: 'f1' }], claims: [smallClaim], openQuestions: [], conflicts: [] };
        const evidencePackage = { timeline: [], claims: [smallClaim] };

        await verifyReport(report, evidencePackage);

        const promptText = mockInvoke.mock.calls[0][0];
        expect(promptText).not.toContain('[Dokazni materijal je skraćen');
        expect(promptText).toContain('kratki dokaz');
    });
});
