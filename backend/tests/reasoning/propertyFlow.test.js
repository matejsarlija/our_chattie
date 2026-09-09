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

    test('K-02/K-03: property values consolidate to EUR and reconcile across currencies', () => {        const { reconcilePropertyFlows } = require('../../court-analysis/reasoning/reconciliation');
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'doc1.pdf', [
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', transferee: 'Kupac A d.o.o.', value: 7534.5, currency: 'HRK' },
            ]),
            makeAnalysis('a-2', 'doc2.pdf', [
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', transferee: 'Kupac A d.o.o.', value: 1000, currency: 'EUR' },
            ]),
        ]);
        expect(flow.entries[0].valueEur).toBe(1000);
        expect(flow.entries[0].valueEurSource).toBe('converted');
        expect(flow.entries[1].valueEur).toBe(1000);
        // Same EUR-scale value, same transferee → no conflict.
        expect(reconcilePropertyFlows(flow).conflicts).toHaveLength(0);
    });

    test('J-03/J-04: tražbina entries carry rank and registry identifiers', () => {        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'prijava.pdf', [
                {
                    description: 'Tražbina CroGo d.o.o.',
                    assetType: 'tražbina',
                    eventType: 'prijava',
                    value: 84500,
                    currency: 'EUR',
                    isplatniRed: 'drugi viši isplatni red',
                    claimRegistryNumber: '106',
                    filingReference: 'St-2/2013-1196-1',
                },
            ]),
        ]);
        expect(flow.entries[0]).toEqual(expect.objectContaining({
            isplatniRed: 'drugi viši isplatni red',
            claimRegistryNumber: '106',
            filingReference: 'St-2/2013-1196-1',
        }));
    });

    test('L-01: shared claimRegistryNumber forms a timeline without fuzzy matching', () => {
        const { reconcilePropertyFlows } = require('../../court-analysis/reasoning/reconciliation');
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'prijava.pdf', [
                {
                    // Deliberately different prose: only the stable ID joins them.
                    description: 'Prijava potraživanja vjerovnika CroGo',
                    assetType: 'tražbina', eventType: 'prijava',
                    value: 177218.01, currency: 'HRK', date: '2022-06-15',
                    claimRegistryNumber: '106',
                },
            ]),
            makeAnalysis('a-2', 'rjesenje.pdf', [
                {
                    description: 'Utvrđena tražbina drugog višeg isplatnog reda',
                    assetType: 'tražbina', eventType: 'namirenje',
                    value: 23520, currency: 'EUR', date: '2023-06-01',
                    claimRegistryNumber: '106',
                },
            ]),
        ]);
        const result = reconcilePropertyFlows(flow);
        expect(result.conflicts).toHaveLength(0);
        expect(result.valueChanges).toHaveLength(1);
        expect(result.valueChanges[0]).toEqual(expect.objectContaining({
            linkage: 'claimRegistryNumber',
        }));
    });

    test('L-01: explicit supersedes resolves by registry number, not prop-N', () => {
        const { reconcilePropertyFlows } = require('../../court-analysis/reasoning/reconciliation');
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'prijava.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Kerum d.o.o. u stečaju',
                    assetType: 'tražbina', eventType: 'prijava',
                    value: 84500, currency: 'EUR', date: '2022-06-15',
                    claimRegistryNumber: '106',
                },
            ]),
            makeAnalysis('a-2', 'ustup.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Kerum d.o.o. u stečaju',
                    assetType: 'tražbina', eventType: 'ustup',
                    value: 15000, currency: 'EUR', date: '2023-06-01',
                    supersedes: '106',
                },
            ]),
        ]);
        const result = reconcilePropertyFlows(flow);
        expect(result.conflicts).toHaveLength(0);
        expect(result.valueChanges).toHaveLength(1);
        expect(result.valueChanges[0].linkage).toBe('supersedes');
    });

    test('L-02: citation-linked entries join the chain via context analyses', () => {
        const { reconcilePropertyFlows } = require('../../court-analysis/reasoning/reconciliation');
        const analyses = [
            {
                id: 'a-1', fileName: 'prijava.pdf', caseNumber: 'St-2/2013',
                amounts: [],
                propertyFlow: [{
                    description: 'Tražbina vjerovnika prema dužniku Gradnja Plus d.o.o.',
                    assetType: 'tražbina', eventType: 'prijava',
                    transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac Prvi d.o.o.',
                    value: 84500, currency: 'EUR', date: '2022-06-15',
                    filingReference: 'St-2/2013-1196-1',
                }],
                citedFilingReferences: [],
            },
            {
                id: 'a-2', fileName: 'zalba.pdf', caseNumber: 'St-2/2013',
                amounts: [],
                propertyFlow: [{
                    description: 'Tražbina vjerovnika prema dužniku Gradnja Plus d.o.o.',
                    assetType: 'tražbina', eventType: 'ustup',
                    transferor: 'Vjerovnik A d.o.o.', transferee: 'Kupac Drugi d.o.o.',
                    value: 15000, currency: 'EUR', date: '2023-06-01',
                    filingReference: 'St-2/2013-1214',
                }],
                citedFilingReferences: ['St-2/2013-1196-1'],
            },
        ];
        const flow = collectPropertyFlows(analyses);
        // Without the citation signal this is a competing-claims conflict.
        expect(reconcilePropertyFlows(flow).conflicts).toHaveLength(1);
        // With it, the pair joins one timeline.
        const linked = reconcilePropertyFlows(flow, { analyses });
        expect(linked.conflicts).toHaveLength(0);
        expect(linked.valueChanges).toHaveLength(1);
    });

    test('property derived view keeps legacy vocabulary and filters out novac', () => {
        const { collectFlows, derivePropertyFlowView } = require('../../court-analysis/reasoning/flow');
        const view = derivePropertyFlowView(collectFlows([
            {
                id: 'a-1', fileName: 'doc.pdf', caseNumber: 'Stč-2150/2022',
                entryDate: '2023-05-17',
                amounts: [{ description: 'Polog', amount: 1200, currency: 'EUR' }],
                propertyFlow: [
                    {
                        description: 'Tražbina vjerovnika prema dužniku iz podneska',
                        assetType: 'tražbina', eventType: 'prijava',
                        value: 5000, currency: 'EUR',
                        isplatniRed: 'drugi viši isplatni red',
                        claimRegistryNumber: '106',
                        filingReference: 'St-2/2013-1196-1',
                    },
                ],
            },
        ]));
        expect(view.count).toBe(1);
        expect(view.hasPropertyFlow).toBe(true);
        expect(view.entries[0]).toEqual(expect.objectContaining({
            id: 'prop-1',
            description: 'Tražbina vjerovnika prema dužniku iz podneska',
            assetType: 'tražbina',
            eventType: 'prijava',
            value: 5000,
            valueEur: 5000,
            isplatniRed: 'drugi viši isplatni red',
            claimRegistryNumber: '106',
            filingReference: 'St-2/2013-1196-1',
            date: '2023-05-17',
        }));
        // Unified-only vocabulary stays invisible to the legacy view.
        expect(view.entries[0].direction).toBeUndefined();
        expect(view.entries[0].payerName).toBeUndefined();
    });

    test('legacy prop-N supersedes round-trips through the unified ids', () => {
        const flow = collectPropertyFlows([
            makeAnalysis('a-1', 'prijava.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Ducanor d.o.o.',
                    assetType: 'tražbina', eventType: 'prijava',
                    value: 84500, currency: 'EUR', date: '2022-06-15',
                },
            ]),
            makeAnalysis('a-2', 'ustup.pdf', [
                {
                    description: 'Tražbina vjerovnika prema dužniku Ducanor d.o.o.',
                    assetType: 'tražbina', eventType: 'ustup',
                    value: 15000, currency: 'EUR', date: '2023-06-01', supersedes: 'prop-1',
                },
            ]),
        ]);
        expect(flow.entries[1].supersedes).toBe('prop-1');
        const result = reconcilePropertyFlows(flow);
        expect(result.valueChanges).toHaveLength(1);
    });

    test('value-change timeline orders mixed ISO and Croatian date formats chronologically', () => {
        const { buildValueChangeTimeline } = require('../../court-analysis/reasoning/propertyFlow');
        const timeline = buildValueChangeTimeline([
            // Lexicographically "15.06.2022." > "2023-06-01" — string sorting
            // would put the 2022 stage last and invert original/latest values.
            { id: 'prop-2', description: 'Tražbina', value: 15000, currency: 'EUR', date: '2023-06-01', sourceId: 's-2', fileName: 'b.pdf' },
            { id: 'prop-1', description: 'Tražbina', value: 84500, currency: 'EUR', date: '15.06.2022.', sourceId: 's-1', fileName: 'a.pdf' },
        ], 'test');
        expect(timeline.stages.map((s) => s.id)).toEqual(['prop-1', 'prop-2']);
        expect(timeline.originalValue).toBe(84500);
        expect(timeline.latestValue).toBe(15000);
    });

    test('analysis role cap leaves headroom for J-era schema on dense documents', () => {        const { GEMINI_ROLE_CONFIG } = require('../../helpers/geminiConfig');
        expect(GEMINI_ROLE_CONFIG.analysis.maxOutputTokens).toBeGreaterThanOrEqual(16384);
        // Dense synthetic document: 30 amounts with verbatim quotes + J
        // identity/direction fields + 10 property entries + citation refs.
        // At ~4 chars/token, the cap must hold this with margin.
        const dense = {
            caseNumber: 'Stč-2150/2022',
            decisionDate: '2023-02-10',
            summary: 'S'.repeat(2000),
            amounts: Array.from({ length: 30 }, (_, i) => ({
                description: `Stavka broj ${i + 1} za troškove postupka`,
                amount: 1000 + i,
                currency: 'EUR',
                direction: 'obveza',
                payerName: 'Dužnik d.o.o.',
                payerOib: '12345678901',
                recipientName: 'Vjerovnik d.o.o.',
                recipientOib: '10987654321',
                isplatniRed: 'drugi viši isplatni red',
                claimRegistryNumber: `${100 + i}`,
                filingReference: `St-2/2013-${1196 + i}-1`,
                quote: 'Q'.repeat(160),
            })),
            propertyFlow: Array.from({ length: 10 }, (_, i) => ({
                description: `Imovina broj ${i + 1}`,
                assetType: 'pokretnina',
                value: 5000 + i,
                currency: 'EUR',
                isplatniRed: 'drugi viši isplatni red',
                claimRegistryNumber: `${100 + i}`,
                filingReference: `St-2/2013-${1196 + i}-1`,
                quote: 'Q'.repeat(160),
            })),
            citedFilingReferences: ['St-2/2013-1214', 'St-2/2013-1215'],
        };
        const chars = JSON.stringify(dense).length;
        const estimatedCapacity = GEMINI_ROLE_CONFIG.analysis.maxOutputTokens * 4;
        expect(chars).toBeLessThan(estimatedCapacity * 0.75);
    });
});
