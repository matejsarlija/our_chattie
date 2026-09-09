// flow-consolidation PR2: the normalize/collect contract lives in flow.test.js.
// This file pins only the backward-compat money derived view (assetType
// filtering + field renames) and the legacy entry points' survival.
const { collectMoneyFlows } = require('../../court-analysis/reasoning/moneyFlow');
const { collectFlows, deriveMoneyFlowView } = require('../../court-analysis/reasoning/flow');

describe('reasoning deriveMoneyFlowView (backward-compat mapping)', () => {
    test('currency/amount helpers are still importable from the legacy path', () => {
        const legacy = require('../../court-analysis/reasoning/moneyFlow');
        expect(legacy.parseAmount('63,38')).toBe(63.38);
        expect(legacy.normalizeCurrency('kn')).toBe('HRK');
        expect(legacy.normalizeDirection('dosuđeno')).toBe('awarded');
        expect(legacy.normalizeOib('66124057408')).toBe('66124057408');
    });

    test('keeps only novac entries and renames value back to amount', () => {
        const view = deriveMoneyFlowView(collectFlows([
            {
                id: 'a-1',
                fileName: 'doc.pdf',
                caseNumber: 'St-1/2024',
                entryDate: '2023-05-17',
                amounts: [
                    { description: 'Polog', amount: 1200, currency: 'EUR', direction: 'obveza', payerName: 'Dužnik d.o.o.' },
                ],
                propertyFlow: [
                    { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', value: 5000, currency: 'EUR' },
                ],
            },
        ]));

        expect(view.count).toBe(1);
        expect(view.hasMoneyFlow).toBe(true);
        expect(view.entries[0]).toEqual(expect.objectContaining({
            id: 'money-1',
            amount: 1200,
            currency: 'EUR',
            amountEur: 1200,
            amountEurSource: 'as-is',
            direction: 'obveza',
            payerName: 'Dužnik d.o.o.',
            from: 'Dužnik d.o.o.',
        }));
        // Unified-only vocabulary stays invisible to the legacy view.
        expect(view.entries[0].assetType).toBeUndefined();
        expect(view.entries[0].transferor).toBeUndefined();
        expect(view.entries[0].value).toBeUndefined();
        expect(view.currencyTotals).toEqual({ EUR: 1200 });
        expect(view.eurTotal).toBe(1200);
    });

    test('legacy collectMoneyFlows matches the unified path exactly', () => {
        const analyses = [
            {
                id: 'a-1',
                fileName: 'diobni_popis.pdf',
                caseNumber: 'ST-2/2013',
                amounts: [
                    { description: 'Isplata drugog višeg isplatnog reda', amount: '1.200.000,00', currency: 'EUR', date: '2025-12-17' },
                    { description: 'Rezervacija parničnih troškova', amount: 1033.25, currency: 'EUR' },
                ],
                propertyFlow: [
                    { description: 'Tražbina vjerovnika', assetType: 'tražbina', eventType: 'prijava', value: 999, currency: 'EUR' },
                ],
            },
        ];
        // Property-sourced entries must not leak into the money view even
        // though the unified collector sees them.
        expect(collectMoneyFlows(analyses)).toEqual(deriveMoneyFlowView(collectFlows(analyses)));
        expect(collectMoneyFlows(analyses).count).toBe(2);
    });

    test('entry-date fallback survives the round trip', () => {
        const view = deriveMoneyFlowView(collectFlows([
            {
                id: 'a-1', fileName: 'Podnesak.pdf', caseNumber: 'St-1/2024',
                entryDate: '2023-05-17',
                amounts: [{ description: 'Pristojba', amount: 100, currency: 'EUR' }],
            },
        ]));
        expect(view.entries[0].date).toBe('2023-05-17');
    });
});
