const { collectPropertyFlows } = require('../../court-analysis/reasoning/propertyFlow');
const { reconcilePropertyFlows } = require('../../court-analysis/reasoning/reconciliation');
const { collectMoneyFlows } = require('../../court-analysis/reasoning/moneyFlow');
const { attachAnalysesToEvidencePackage } = require('../../court-analysis/reasoning/evidencePackage');

function makeAnalysis(id, fileName, propertyFlow, amounts = []) {
    return { id, fileName, caseNumber: 'Stč-2150/2022', amounts, propertyFlow };
}

describe('reasoning reconcilePropertyFlows', () => {
    test('empty propertyFlow input → empty output, no errors', () => {
        expect(reconcilePropertyFlows({ entries: [] })).toEqual({ conflicts: [], openQuestions: [], valueChanges: [] });
        expect(reconcilePropertyFlows(null)).toEqual({ conflicts: [], openQuestions: [], valueChanges: [] });
        expect(collectPropertyFlows([])).toEqual({ count: 0, entries: [], hasPropertyFlow: false });
    });

    test('non-tražbina entries: divergent value/transferee → conflict, same shape as moneyFlow', () => {
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'doc1.pdf', [
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', transferor: 'Ducanor d.o.o.', transferee: 'Kupac A d.o.o.', value: 25000, currency: 'EUR' },
            ]),
            makeAnalysis('a-2', 'doc2.pdf', [
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', transferor: 'Ducanor d.o.o.', transferee: 'Kupac B d.o.o.', value: 18000, currency: 'EUR' },
            ]),
        ]);
        const result = reconcilePropertyFlows(flow);
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0]).toEqual(expect.objectContaining({
            finding: expect.any(String),
            reason: expect.any(String),
            sources: expect.any(Array),
        }));
        expect(result.valueChanges).toHaveLength(0);
    });

    test('tražbina supersedes chain → value-change timeline, NOT a conflict', () => {
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'prijava.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Ducanor d.o.o.',
                    assetType: 'tražbina', eventType: 'prijava',
                    transferor: 'Vjerovnik A d.o.o.', value: 84500, currency: 'EUR', date: '2022-06-15',
                },
            ]),
            makeAnalysis('a-2', 'ustup.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Ducanor d.o.o.',
                    assetType: 'tražbina', eventType: 'ustup',
                    transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac Tražbina d.o.o.',
                    value: 15000, currency: 'EUR', date: '2023-06-01', supersedes: 'prop-1',
                },
            ]),
        ]);
        const result = reconcilePropertyFlows(flow);
        expect(result.conflicts).toHaveLength(0);
        expect(result.valueChanges).toHaveLength(1);
        expect(result.valueChanges[0]).toEqual(expect.objectContaining({
            originalValue: 84500,
            latestValue: 15000,
            delta: 15000 - 84500,
            finding: expect.stringContaining('ustupljena je za'),
            sources: expect.any(Array),
        }));
    });

    test('two competing unlinked cessions of the same receivable DO produce a conflict', () => {
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'ustup-a.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Gradnja Plus d.o.o.',
                    assetType: 'tražbina', eventType: 'ustup',
                    transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac Prvi d.o.o.',
                    value: 15000, currency: 'EUR',
                },
            ]),
            makeAnalysis('a-2', 'ustup-b.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Gradnja Plus d.o.o.',
                    assetType: 'tražbina', eventType: 'ustup',
                    transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac Drugi d.o.o.',
                    value: 15000, currency: 'EUR',
                },
            ]),
        ]);
        const result = reconcilePropertyFlows(flow);
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].finding).toMatch(/Konkurentske tvrdnje o istoj tražbini/);
        expect(result.valueChanges).toHaveLength(0);
    });

    test('unresolvable supersedes reference degrades to standalone — never throws', () => {
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'ustup.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Nepoznati d.o.o.',
                    assetType: 'tražbina', eventType: 'ustup',
                    transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac X d.o.o.',
                    value: 5000, currency: 'EUR', supersedes: 'prop-999',
                },
            ]),
        ]);
        let result;
        expect(() => { result = reconcilePropertyFlows(flow); }).not.toThrow();
        expect(result.conflicts).toHaveLength(0);
        expect(result.valueChanges).toHaveLength(0);
    });

    test('stecaj-klaster eval fixture chain reconciles to a timeline, not a conflict', () => {
        const fixture = require('../fixtures/eval/stecaj-klaster.fixture.json');
        const pkg = attachAnalysesToEvidencePackage(
            fixture.basePackage,
            [{ analysis: { individualAnalyses: fixture.analyses } }],
            null
        );
        expect(pkg.propertyFlow.count).toBeGreaterThan(0);
        const result = reconcilePropertyFlows(pkg.propertyFlow);
        expect(result.valueChanges).toHaveLength(1);
        expect(result.valueChanges[0]).toEqual(expect.objectContaining({
            originalValue: 84500,
            latestValue: 15000,
        }));
        expect(result.conflicts).toHaveLength(0);
    });

    test('existing amounts/moneyFlow behavior is unchanged for documents without propertyFlow', () => {
        const analyses = [
            { id: 'a-1', fileName: 'x.pdf', caseNumber: 'C', amounts: [{ description: 'Polog', amount: 1200, currency: 'EUR' }] },
        ];
        expect(collectMoneyFlows(analyses).count).toBe(1);
        expect(collectPropertyFlows(analyses)).toEqual({ count: 0, entries: [], hasPropertyFlow: false });
    });

    test('coverage gains a grounding dimension without changing existing shape', () => {        const fixture = require('../fixtures/eval/stecaj-klaster.fixture.json');
        const pkg = attachAnalysesToEvidencePackage(
            fixture.basePackage,
            [{ analysis: { individualAnalyses: fixture.analyses } }],
            null
        );
        expect(pkg.coverage).toEqual(expect.objectContaining({
            analyzed: 3, failed: 0, total: 3,
            groundedClaims: expect.any(Number),
            totalClaims: expect.any(Number),
        }));
        // 3 amounts + 3 propertyFlow entries across the fixture.
        expect(pkg.coverage.totalClaims).toBe(6);
    });

    test('analysis role cap leaves headroom for quotes + propertyFlow on dense documents', () => {
        const { GEMINI_ROLE_CONFIG } = require('../../helpers/geminiConfig');
        expect(GEMINI_ROLE_CONFIG.analysis.maxOutputTokens).toBeGreaterThanOrEqual(12288);
        // Dense synthetic document: 30 amounts with verbatim quotes + 10
        // property entries. At ~4 chars/token, the cap must hold this with margin.
        const dense = {
            caseNumber: 'Stč-2150/2022',
            decisionDate: '2023-02-10',
            summary: 'S'.repeat(2000),
            amounts: Array.from({ length: 30 }, (_, i) => ({
                description: `Stavka broj ${i + 1} za troškove postupka`,
                amount: 1000 + i,
                currency: 'EUR',
                quote: 'Q'.repeat(160),
            })),
            propertyFlow: Array.from({ length: 10 }, (_, i) => ({
                description: `Imovina broj ${i + 1}`,
                assetType: 'pokretnina',
                value: 5000 + i,
                currency: 'EUR',
                quote: 'Q'.repeat(160),
            })),
        };
        const chars = JSON.stringify(dense).length;
        const estimatedCapacity = GEMINI_ROLE_CONFIG.analysis.maxOutputTokens * 4;
        expect(chars).toBeLessThan(estimatedCapacity * 0.75);
    });
});
