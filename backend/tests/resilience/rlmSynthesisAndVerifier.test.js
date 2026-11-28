'use strict';

const mockInvoke = jest.fn();
jest.mock('../../llm/openrouterClient.js', () => ({
    createOpenRouterClient: () => ({ invoke: mockInvoke }),
}));
jest.mock('../../llm/retry', () => ({
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined)),
}));

const { buildSynthesisInput } = require('../../court-analysis/reasoning/synthesis/synthesisInputBuilder');
const { verifyReport } = require('../../court-analysis/reasoning/synthesis/verifier');

describe('Resilience: RLM Stage-2 25% BM25 Floor & Croatian Verifier Retention', () => {
    beforeEach(() => {
        mockInvoke.mockReset();
    });

    test('preserves protected BM25 excerpts alongside 400 flow rows and retains Croatian unverified findings', async () => {
        const pkg = {
            caseNumber: 'St-2/2013',
            analyses: Array.from({ length: 20 }, (_, i) => ({
                id: `doc-${i}`,
                docId: `doc-${i}`,
                fileName: `Objava-${i}.pdf`,
                decisionDate: '2025-02-10',
                summary: `Sažetak ${i}`,
            })),
            flows: {
                entries: Array.from({ length: 400 }, (_, i) => ({
                    id: `flow-${i}`,
                    description: `Tražbina ${i}`,
                    value: 1000 + i,
                    currency: 'EUR',
                    docId: `doc-${i % 20}`,
                    fileName: `Objava-${i % 20}.pdf`,
                    grounded: true,
                })),
            },
            reconciliation: { conflicts: [] },
        };
        const retrieval = {
            results: [{
                query: { id: 'q1', purpose: 'claims', text: 'tražbina' },
                matches: Array.from({ length: 12 }, (_, i) => ({
                    sourceId: `chunk-${i}`,
                    fileName: `Objava-${i}.pdf`,
                    text: `Dokazni isječak ${i} o tražbini.`,
                    score: 100 - i,
                    metadata: { docId: `doc-${i}`, sourceType: 'chunk' },
                })),
            }],
        };

        const input = buildSynthesisInput(pkg, retrieval);
        const retrievedClaims = (input.claims || []).filter((c) => String(c.id || '').startsWith('retrieved-'));
        expect(retrievedClaims.length).toBeGreaterThan(0);

        mockInvoke.mockResolvedValue({
            content: JSON.stringify({
                verdicts: [{ index: 1, status: 'unsupported', reason: 'Nema dokaza u spisu.' }],
            }),
        });

        const report = {
            narrative: 'Sažetak postupka.',
            findings: [
                {
                    id: 'f-unverified',
                    text: 'Nepotvrđena tvrdnja bez citata.',
                    confidence: 'medium',
                    citations: [],
                },
            ],
        };
        const verified = await verifyReport(report, input, { taskRouter: null });
        expect(verified.findings).toHaveLength(1);
        expect(verified.findings[0].verificationStatus).toBe('unverified');
    });
});
