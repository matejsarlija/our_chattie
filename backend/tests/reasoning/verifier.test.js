const { SCHEMA_VERSION } = require('../../court-analysis/reasoning/schema/schema');

const mockInvoke = jest.fn();
jest.mock('../../llm/openrouterClient.js', () => ({
    createOpenRouterClient: () => ({ invoke: mockInvoke })
}));

const { verifyReport } = require('../../court-analysis/reasoning/synthesis/verifier');

// Mock retry helper
jest.mock("../../llm/retry", () => ({
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

        expect(verifiedReport.findings).toHaveLength(2); // Zero silent deletion; unsupported kept as unverified
        expect(verifiedReport.findings[0]).toMatchObject({
            text: 'Defendant paid the debt',
            confidence: 'high',
            verificationStatus: 'verified_llm',
        });
        expect(verifiedReport.findings[1]).toMatchObject({
            text: 'Case was dismissed',
            verificationStatus: 'unverified',
        });

        expect(verifiedReport.claims).toEqual(mockReport.claims);
        expect(verifiedReport.openQuestions).toHaveLength(1);
        expect(verifiedReport.openQuestions[0]).toContain('Nepotvrđen nalaz: Case was dismissed');
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
        expect(result.findings[1].verificationStatus).toBe('verified_llm');
        // Mechanical findings keep not_checked status — skipped, not deleted.
        expect(result.findings[0]).toMatchObject({ text: mechanicalOne.text, verificationStatus: 'not_checked' });
        expect(result.findings[2]).toMatchObject({ text: mechanicalTwo.text, verificationStatus: 'not_checked' });

        // The prompt diet still holds: only the substantive text is sent.
        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt).toContain(substantive.text);
        expect(prompt).not.toContain(mechanicalOne.text);
        expect(prompt).not.toContain(mechanicalTwo.text);
    });

    test('parses verification results from a LangChain content-block array', async () => {
        mockInvoke.mockResolvedValue({
            content: [{
                type: 'text',
                text: JSON.stringify([
                    { index: 1, status: 'supported', reason: 'Potvrđeno u evidenciji.', confidence: 'high' },
                    { index: 2, status: 'unsupported', reason: 'Nema potvrde.', confidence: 'low' },
                ]),
            }],
        });

        const result = await verifyReport(mockReport, mockEvidence);

        expect(result.meta.verification).toMatchObject({ status: 'complete', failedCount: 0 });
        expect(result.findings).toHaveLength(2);
        expect(result.findings[0]).toMatchObject({ text: 'Defendant paid the debt', verificationStatus: 'verified_llm' });
        expect(result.findings[1]).toMatchObject({ text: 'Case was dismissed', verificationStatus: 'unverified' });
    });

    test('records verification failure as partial without discarding the report', async () => {
        mockInvoke.mockResolvedValue({ content: '[{"index":1,"status":"supported"' });
        const result = await verifyReport(mockReport, mockEvidence);
        expect(result).not.toBe(mockReport);
        expect(result.findings).toHaveLength(2);
        expect(result.findings[0].verificationStatus).toBe('unverified');
        expect(result.meta.verification).toMatchObject({
            status: 'partial',
            failedCount: mockReport.findings.length,
        });
        expect(result.openQuestions).toContain('Dio nalaza nije mogao biti provjeren; rezultat provjere nije dostupan.');
    });

    test('verifies ledger-backed findings deterministically at $0 without invoking LLM', async () => {
        const report = {
            schemaVersion: SCHEMA_VERSION,
            claims: [],
            findings: [{
                id: 'f-det',
                text: 'Vjerovnik B2 KAPITAL d.o.o. (OIB 49803335555) ima tražbinu od 15.000,00 EUR.',
                confidence: 'medium',
                citations: [{ docId: 'doc-1', text: '15.000,00 EUR' }],
            }],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };
        const evidence = {
            timeline: [],
            claims: [],
            factLedger: [{
                id: 'fact-1',
                kind: 'amount',
                value: 15000,
                valueEur: 15000,
                currency: 'EUR',
                grounded: true,
                parties: { recipientName: 'B2 KAPITAL d.o.o.', recipientOib: '49803335555' },
            }],
            meta: {},
        };

        const result = await verifyReport(report, evidence);

        expect(mockInvoke).not.toHaveBeenCalled();
        expect(result.findings[0]).toMatchObject({
            verificationStatus: 'verified_deterministic',
            verificationNote: expect.stringContaining('determinističkom provjerom'),
        });
        expect(result.meta.verification).toMatchObject({
            status: 'complete',
            attemptedCount: 1,
            verifiedCount: 1,
            deterministicVerifiedCount: 1,
            failedCount: 0,
        });
    });

    test('verifies grounded single-fact findings deterministically at $0 even without OIB in finding prose', async () => {
        const report = {
            schemaVersion: SCHEMA_VERSION,
            claims: [],
            findings: [{
                id: 'f-det-no-oib',
                text: 'Društvo B2 KAPITAL d.o.o. ostvaruje namirenje od 15.000,00 EUR.',
                confidence: 'medium',
                citations: [{ docId: 'doc-hash-1', text: '15.000,00 EUR' }],
            }],
            openQuestions: [],
            conflicts: [],
            meta: {},
        };
        const evidence = {
            timeline: [],
            claims: [],
            factLedger: [{
                id: 'fact-2',
                kind: 'amount',
                docId: 'doc-hash-1',
                value: 15000,
                valueEur: 15000,
                currency: 'EUR',
                grounded: true,
                parties: { recipientName: 'B2 KAPITAL d.o.o.', recipientOib: '49803335555' },
            }],
            meta: {},
        };

        const result = await verifyReport(report, evidence);
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(result.findings[0].verificationStatus).toBe('verified_deterministic');
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

    test('merges repeated claim text without losing distinct attached source passages', async () => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify([{ index: 1, status: 'supported', reason: 'Potvrđeno', confidence: 'high' }]),
        });
        await verifyReport(reportWithFindings(), {
            timeline: [],
            claims: [
                { text: summary, evidence: [{ sourceId: 'doc-1', text: 'Prvi zaseban izvorni odlomak.' }] },
                { text: summary, evidence: [{ sourceId: 'doc-2', text: 'Drugi zaseban izvorni odlomak.' }] },
            ],
        });
        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt.split(`[Source Claim] ${summary}`).length - 1).toBe(1);
        expect(prompt).toContain('[Citation doc-1] Prvi zaseban izvorni odlomak.');
        expect(prompt).toContain('[Citation doc-2] Drugi zaseban izvorni odlomak.');
        expect(prompt).not.toContain('[Dokazni materijal je skraćen');
    });

    test.each(['finding', 'claim'])('keeps attached evidence when a %s citation already contains the claim text', async (citationOrigin) => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify([{ index: 1, status: 'supported', reason: 'Potvrđeno', confidence: 'high' }]),
        });
        const echoedClaim = 'Naknadni zahtjev vjerovnika je odbijen.';
        const report = reportWithFindings();
        const claims = [{
            text: echoedClaim,
            evidence: [{ sourceId: 'decision', text: 'Sud odbija zahtjev zbog nedostatka dokaza.' }],
        }];
        if (citationOrigin === 'finding') {
            report.findings[0].citations = [{ sourceId: 'echo', text: echoedClaim }];
        } else {
            claims.unshift({
                text: 'Postupak je otvoren 2013.',
                evidence: [{ sourceId: 'echo', text: echoedClaim }],
            });
        }
        await verifyReport(report, { timeline: [], claims });
        const prompt = mockInvoke.mock.calls[0][0];
        expect(prompt).toContain(`[Citation echo] ${echoedClaim}`);
        expect(prompt).toContain('[Citation decision] Sud odbija zahtjev zbog nedostatka dokaza.');
        expect(prompt).not.toContain('[Dokazni materijal je skraćen');
    });

    test('retains identical passages from distinct sources but deduplicates the same citation', async () => {
        mockInvoke.mockResolvedValue({
            content: JSON.stringify([{ index: 1, status: 'supported', reason: 'Potvrđeno', confidence: 'high' }]),
        });
        const report = reportWithFindings();
        report.findings[0].citations = [
            { sourceId: 'doc-1', text: 'Zahtjev je povučen.' },
            { sourceId: 'doc-2', text: 'Zahtjev je povučen.' },
        ];
        await verifyReport(report, {
            timeline: [],
            claims: [
                { text: summary, evidence: report.findings[0].citations },
                { text: 'Zasebna tvrdnja.', evidence: [{ sourceId: 'doc-3', text: 'Zahtjev je povučen.' }] },
            ],
        });
        const prompt = mockInvoke.mock.calls[0][0];
        for (const sourceId of ['doc-1', 'doc-2', 'doc-3']) {
            expect(prompt.split(`[Citation ${sourceId}] Zahtjev je povučen.`).length - 1).toBe(1);
        }
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
