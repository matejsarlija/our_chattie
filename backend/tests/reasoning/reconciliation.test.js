const { reconcileMoneyFlows } = require('../../court-analysis/reasoning/reconciliation');

const entry = (overrides = {}) => ({
    amount: 1000,
    currency: 'EUR',
    description: 'Polog za troškove postupka',
    fileName: 'dokument-1.pdf',
    sourceId: 'src-1',
    ...overrides
});

describe('reconcileMoneyFlows', () => {
    test('flags divergent amounts for the same purpose across documents', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1200, description: 'Polog za troškove stečajnog postupka', fileName: 'a.pdf', sourceId: 's-a' }),
                entry({ amount: 2500, description: 'polog za troskove stecajnog postupka', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].finding).toContain('1,200');
        expect(result.conflicts[0].finding).toContain('2,500');
        expect(result.conflicts[0].sources).toEqual(['s-a', 's-b']);
    });

    test('does not flag matching duplicate descriptions', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1200 }),
                entry({ amount: 1200.005, description: 'polog za troskove postupka', fileName: 'b.pdf' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
    });

    test('ignores generic one-token descriptions that would collide across documents', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 100, description: 'Iznos', fileName: 'a.pdf' }),
                entry({ amount: 99999, description: 'iznos razlicit', fileName: 'b.pdf' })
            ]
        });
        // 'iznos' alone is too short to group; 'razlicit' differs anyway.
        expect(result.conflicts).toHaveLength(0);
    });

    test('total-vs-parts mismatch becomes an openQuestion, not a conflict', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 90000, description: 'Ukupno prijavljene tražbine', fileName: 'izvjestaj.pdf' }),
                entry({ amount: 84500, description: 'Tražbina banke', fileName: 'prijava.pdf' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
        expect(result.openQuestions).toHaveLength(1);
        expect(result.openQuestions[0]).toContain('90,000');
        expect(result.openQuestions[0]).toContain('84,500');
    });

    test('matching total suppresses the question entirely', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, description: 'Ukupno za naknade' }),
                entry({ amount: 600, description: 'Naknada vjerovniku A', fileName: 'b.pdf' }),
                entry({ amount: 400, description: 'Naknada upravitelju', fileName: 'c.pdf' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
        expect(result.openQuestions).toHaveLength(0);
    });

    test('empty money flow yields empty output without throwing', () => {
        expect(reconcileMoneyFlows(null)).toEqual({ conflicts: [], openQuestions: [] });
        expect(reconcileMoneyFlows({ entries: [] })).toEqual({ conflicts: [], openQuestions: [] });
    });
});
