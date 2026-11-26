const mockInvoke = jest.fn();

jest.mock('../../llm/openrouterClient.js', () => ({
    createOpenRouterClient: () => ({ invoke: mockInvoke }),
}));

jest.mock('../../llm/retry', () => ({
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined))
}));

const { verifyReport } = require('../../court-analysis/reasoning/synthesis/verifier');

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

    test('selects evidence relevant to each batch instead of a positional prefix', async () => {
        const claims = Array.from({ length: 120 }, (_, index) => ({
            id: `claim-${index}`,
            text: `Tema${index} ${'detalj '.repeat(80)}`,
            confidence: 'medium',
            evidence: [{ sourceId: `src-${index}`, text: `Dokaz Tema${index} ${'sadržaj '.repeat(80)}` }],
        }));
        const report = {
            findings: [{
                id: 'f1',
                text: 'Nalaz o Tema119.',
                confidence: 'medium',
                citations: [],
            }],
            claims: [],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };

        await verifyReport(report, { timeline: [], claims, meta: {} });

        const promptText = mockInvoke.mock.calls[0][0];
        expect(promptText).toContain('Tema119');
        // The relevant claim is promoted ahead of the chronological prefix;
        // remaining budget still fills with other claims for coverage.
        expect(promptText.indexOf('[Source Claim] Tema119')).toBeLessThan(
            promptText.indexOf('[Source Claim] Tema0 '),
        );
        expect(promptText).toContain('[Dokazni materijal je skraćen');
    });

    test('keeps relevant duplicate attachments ahead of unrelated evidence within the same budget', async () => {
        const relevantText = 'Tema119 odluka o konačnoj raspodjeli.';
        const sharedPassage = 'Tema119 izvorni odlomak iz odluke o raspodjeli.';
        const claims = [
            {
                text: 'Nepovezano pitanje o početku postupka.',
                evidence: [{ sourceId: 'shared', text: sharedPassage }],
            },
            ...Array.from({ length: 120 }, (_, index) => ({
                text: `NepovezanaTema${index} ${'detalj '.repeat(80)}`,
                evidence: [{ sourceId: `unrelated-${index}`, text: `Nepovezani dokaz ${index} ${'sadržaj '.repeat(80)}` }],
            })),
            { text: relevantText, evidence: [{ sourceId: 'shared', text: sharedPassage }] },
            { text: relevantText, evidence: [{ sourceId: 'decision', text: 'Posebni prilog za Tema119 potvrđuje raspodjelu.' }] },
        ];
        await verifyReport({
            findings: [{ text: 'Nalaz Tema119.', citations: [] }],
            openQuestions: [],
            conflicts: [],
        }, { timeline: [], claims });

        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt).toContain(`[Citation shared] ${sharedPassage}`);
        expect(prompt).toContain('[Citation decision] Posebni prilog za Tema119 potvrđuje raspodjelu.');
        expect(prompt.indexOf(`[Source Claim] ${relevantText}`)).toBeLessThan(
            prompt.indexOf('[Source Claim] NepovezanaTema0 '),
        );
        expect(prompt.split(`[Source Claim] ${relevantText}`).length - 1).toBe(1);
        expect(prompt).toContain('[Dokazni materijal je skraćen');
        const evidence = prompt.split('EVIDENCE:\n')[1].split('FINDINGS TO VERIFY:')[0]
            .split('[Dokazni materijal je skraćen')[0].trim();
        expect(evidence.length).toBeLessThanOrEqual(24000);
    });

    test('still selects short attached evidence when its duplicate claim line cannot fit', async () => {
        const oversizedText = `Tema119 ${'duga tvrdnja '.repeat(3000)}`;
        await verifyReport({
            findings: [{ text: 'Tema119', citations: [] }],
            openQuestions: [],
            conflicts: [],
        }, {
            timeline: [],
            claims: [
                { text: oversizedText, evidence: [{ sourceId: 'first', text: 'Prvi kratki izvor za Tema119.' }] },
                { text: oversizedText, evidence: [{ sourceId: 'second', text: 'Drugi kratki izvor za Tema119.' }] },
            ],
        });
        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt).not.toContain('[Source Claim]');
        expect(prompt).toContain('[Citation first] Prvi kratki izvor za Tema119.');
        expect(prompt).toContain('[Citation second] Drugi kratki izvor za Tema119.');
        expect(prompt).toContain('[Dokazni materijal je skraćen');
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

    test('verifies findings in bounded batches and preserves every result', async () => {
        mockInvoke
            .mockResolvedValueOnce({
                content: JSON.stringify(Array.from({ length: 8 }, (_, index) => ({
                    index: index + 1,
                    status: 'supported',
                    reason: `Dokaz ${index + 1}.`,
                    confidence: 'high',
                }))),
            })
            .mockResolvedValueOnce({
                content: JSON.stringify([
                    { index: 1, status: 'supported', reason: 'Dokaz 9.', confidence: 'high' },
                ]),
            });
        const report = {
            findings: Array.from({ length: 9 }, (_, index) => ({
                id: `finding-${index + 1}`,
                text: `Nalaz ${index + 1}.`,
                confidence: 'medium',
                citations: [{ sourceId: `source-${index + 1}`, text: `Dokaz ${index + 1}.` }],
            })),
            claims: [],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };

        const result = await verifyReport(report, {
            timeline: [],
            claims: [],
            meta: {},
        });

        expect(mockInvoke).toHaveBeenCalledTimes(2);
        expect(mockInvoke.mock.calls[0][0]).toContain('Nalaz 1.');
        expect(mockInvoke.mock.calls[0][0]).toContain('Nalaz 8.');
        expect(mockInvoke.mock.calls[0][0]).not.toContain('Nalaz 9.');
        expect(mockInvoke.mock.calls[1][0]).toContain('Nalaz 9.');
        expect(result.findings).toHaveLength(9);
        expect(result.findings.every((finding) => finding.verificationStatus === 'verified_llm')).toBe(true);
        expect(result.findings.every((finding) => !finding.citations.some((c) => c.sourceId === 'verification-pass'))).toBe(true);
        expect(result.meta.verification).toMatchObject({ status: 'complete', verifiedCount: 9, failedCount: 0 });
    });

    test('keeps the complete verdicts of a truncated batch and marks the rest failed', async () => {
        // Output cap cut the array mid-object: three verdicts finished.
        mockInvoke.mockResolvedValue({
            content: '[{"index":1,"status":"supported","reason":"Dokaz 1.","confidence":"high"},'
                + '{"index":2,"status":"contradicted","reason":"Proturječi.","confidence":"high"},'
                + '{"index":3,"status":"supported","reason":"Dokaz 3.","confidence":"high"},'
                + '{"index":4,"sta',
        });
        const report = {
            findings: Array.from({ length: 6 }, (_, index) => ({
                id: `finding-${index + 1}`,
                text: `Nalaz ${index + 1}.`,
                confidence: 'medium',
                citations: [{ sourceId: `source-${index + 1}`, text: `Dokaz ${index + 1}.` }],
            })),
            claims: [],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };

        const result = await verifyReport(report, { timeline: [], claims: [], meta: {} });

        // Nothing is lost: supported/contradicted keep their verdict, the
        // three unverified findings survive with explicit unverified status.
        expect(result.findings).toHaveLength(6);
        expect(result.findings[0].verificationStatus).toBe('verified_llm');
        expect(result.findings[1].verificationStatus).toBe('unverified');
        expect(result.findings[2].verificationStatus).toBe('verified_llm');
        expect(result.findings[5]).toMatchObject({ id: 'finding-6', verificationStatus: 'unverified', citations: [{ sourceId: 'source-6' }] });
        expect(result.meta.verification).toMatchObject({ status: 'partial', attemptedCount: 6, verifiedCount: 3, failedCount: 3 });
    });
});
