const { buildSynthesisInput } = require('../../court-analysis/reasoning/synthesisInputBuilder');

const mockNormalize = jest.fn();

jest.mock('../../court-analysis/reasoning/synthesizer', () => ({
    normalizeReasoningEvidence: (...args) => mockNormalize(...args)
}));

describe('synthesisInputBuilder budget tiers (Phase 0.5)', () => {
    beforeEach(() => {
        mockNormalize.mockReset();
    });

    const pkg = { packageType: 'ClusterEvidencePackage', clusterId: 'ST-1/2024' };

    const analysisClaim = (id, text, fileName) => ({
        id,
        text,
        confidence: 'medium',
        evidence: [{ sourceId: `src-${id}`, text, metadata: { fileName } }]
    });

    test('analysis claims cited by surviving chunk matches stay full-length', () => {
        mockNormalize.mockReturnValue({
            timeline: [],
            claims: [analysisClaim('analysis-1', 'C'.repeat(600), 'cited.pdf')],
            meta: {}
        });
        const retrieval = {
            results: [{ query: { id: 'q' }, matches: [{ sourceId: 'chunk-x', text: 'S'.repeat(50), metadata: { sourceType: 'chunk', fileName: 'cited.pdf' } }] }]
        };

        const input = buildSynthesisInput(pkg, retrieval);
        const claim = input.claims.find((c) => c.id === 'analysis-1');
        expect(claim.text.length).toBeGreaterThan(300); // full length survives
        expect(claim.digest).toBeUndefined();
    });

    test('analysis-summary matches do NOT self-cite: analysis claims stay digest', () => {
        // Regression: analyses are themselves retrieval sources (indexed under
        // sourceType 'analysis' with the same fileName). A surviving analysis
        // summary must not count as a citation — only ground-truth chunks do.
        mockNormalize.mockReturnValue({
            timeline: [],
            claims: [analysisClaim('analysis-1', 'C'.repeat(600), 'self.pdf')],
            meta: {}
        });
        const retrieval = {
            results: [{ query: { id: 'q' }, matches: [{ sourceId: 'analysis-summary', text: 'C'.repeat(600), metadata: { sourceType: 'analysis', fileName: 'self.pdf' } }] }]
        };

        const input = buildSynthesisInput(pkg, retrieval);
        const claim = input.claims.find((c) => c.id === 'analysis-1');
        expect(claim.text.length).toBeLessThanOrEqual(281);
        expect(claim.digest).toBe(true);
    });

    test('uncited analysis claims degrade to digests', () => {
        const longText = 'N'.repeat(600);
        mockNormalize.mockReturnValue({
            timeline: [],
            claims: [
                analysisClaim('analysis-1', longText, 'uncited.pdf'),
                { id: 'money-flow-1', text: 'Financijski iznos 100 EUR.', confidence: 'medium', evidence: [] }
            ],
            meta: {}
        });
        const retrieval = {
            results: [{ query: { id: 'q' }, matches: [{ sourceId: 'other', text: 'nepovezani sadržaj', metadata: {} }] }]
        };

        const input = buildSynthesisInput(pkg, retrieval);
        const uncited = input.claims.find((c) => c.id === 'analysis-1');
        expect(uncited.text.length).toBeLessThanOrEqual(281);
        expect(uncited.digest).toBe(true);

        // Money-flow claims are always full — they are short and load-bearing.
        const money = input.claims.find((c) => c.id === 'money-flow-1');
        expect(money.digest).toBeUndefined();
        expect(money.text).toContain('100 EUR');
    });

    test('hard char budget drops retrieved claims from the tail first', () => {        // 30 uncited analysis claims digest to ~280 chars each (~8.5k); 50
        // retrieved claims of 900 chars add ~45k — total exceeds the 48k
        // budget, so the tail-drop loop must remove retrieved claims while
        // money-flow/structural entries survive untouched.
        const bigClaims = Array.from({ length: 30 }, (_, i) => analysisClaim(`analysis-${i + 1}`, 'X'.repeat(1500), `doc-uncited-${i}.pdf`));
        bigClaims.push({ id: 'money-flow-1', text: 'Financijski iznos 100 EUR.', confidence: 'medium', evidence: [] });
        mockNormalize.mockReturnValue({ timeline: [], claims: bigClaims, meta: {} });

        const RETRIEVED_COUNT = 50;
        const retrieved = Array.from({ length: RETRIEVED_COUNT }, (_, i) => ({
            id: `retrieved-q-${i + 1}`,
            text: `Relevantni izvor (financial-amounts): ${'R'.repeat(880)}`,
            confidence: 'medium',
            evidence: []
        }));
        const retrieval = { results: retrieved.map((r) => ({ query: { id: 'q' }, matches: [{ sourceId: r.id, text: r.text, metadata: {} }] })) };

        const input = buildSynthesisInput(pkg, retrieval);
        const remainingRetrieved = input.claims.filter((c) => String(c.id).startsWith('retrieved-'));
        expect(remainingRetrieved.length).toBeLessThan(RETRIEVED_COUNT);

        const totalChars = input.claims.reduce((sum, c) => sum + c.text.length, 0);
        expect(totalChars).toBeLessThanOrEqual(48000);
        // Money-flow survives tail-dropping.
        expect(input.claims.some((c) => c.id === 'money-flow-1')).toBe(true);
    });

    test('ungrounded money/property claims degrade to digests; grounded ones stay full', () => {
        const groundedMoney = {
            id: 'money-flow-1',
            text: 'Financijski iznos 1,200 EUR (Polog).',
            confidence: 'medium',
            evidence: [{ sourceId: 'src-money-1', text: 'Polog 1200 EUR', metadata: { sourceType: 'analysis-amount', grounded: true } }]
        };
        const ungroundedMoney = {
            id: 'money-flow-2',
            text: 'U'.repeat(600),
            confidence: 'medium',
            evidence: [{ sourceId: 'src-money-2', text: 'U'.repeat(600), metadata: { sourceType: 'analysis-amount', grounded: false } }]
        };
        const ungroundedProperty = {
            id: 'property-flow-1',
            text: 'P'.repeat(600),
            confidence: 'medium',
            evidence: [{ sourceId: 'src-prop-1', text: 'P'.repeat(600), metadata: { sourceType: 'analysis-property', grounded: false } }]
        };
        mockNormalize.mockReturnValue({ timeline: [], claims: [groundedMoney, ungroundedMoney, ungroundedProperty], meta: {} });
        const retrieval = { results: [] };

        const input = buildSynthesisInput(pkg, retrieval);
        expect(input.claims.find((c) => c.id === 'money-flow-1').digest).toBeUndefined();
        expect(input.claims.find((c) => c.id === 'money-flow-2').digest).toBe(true);
        expect(input.claims.find((c) => c.id === 'property-flow-1').digest).toBe(true);
    });
});
