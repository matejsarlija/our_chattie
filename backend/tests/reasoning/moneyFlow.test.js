const { collectMoneyFlows, normalizeCurrency, parseAmount } = require('../../court-analysis/reasoning/moneyFlow');

describe('reasoning moneyFlow', () => {
    describe('parseAmount', () => {
        test('parses Croatian thousands+decimal format', () => {
            expect(parseAmount('1.200.000,00')).toBe(1200000.00);
            expect(parseAmount('63,38')).toBe(63.38);
        });

        test('parses international decimal format', () => {
            expect(parseAmount('1,200,000.00')).toBe(1200000.00);
            expect(parseAmount('63.38')).toBe(63.38);
        });

        test('parses plain numbers and numbers', () => {
            expect(parseAmount(266988.78)).toBe(266988.78);
            expect(parseAmount('100')).toBe(100);
        });

        test('returns null for unparseable or empty values', () => {
            expect(parseAmount('')).toBeNull();
            expect(parseAmount('neodređeno')).toBeNull();
            expect(parseAmount(null)).toBeNull();
            expect(parseAmount(undefined)).toBeNull();
        });
    });

    describe('normalizeCurrency', () => {
        test('normalizes known currencies', () => {
            expect(normalizeCurrency('EUR')).toBe('EUR');
            expect(normalizeCurrency('eur')).toBe('EUR');
            expect(normalizeCurrency('€')).toBe('EUR');
            expect(normalizeCurrency('HRK')).toBe('HRK');
            expect(normalizeCurrency('kn')).toBe('HRK');
        });

        test('passes through unknown values and null', () => {
            expect(normalizeCurrency('USD')).toBe('USD');
            expect(normalizeCurrency(null)).toBeNull();
            expect(normalizeCurrency('')).toBeNull();
        });
    });

    describe('collectMoneyFlows', () => {
        test('aggregates structured amounts across analyses with currency totals', () => {
            const analyses = [
                {
                    id: 'a-1',
                    fileName: 'diobni_popis.pdf',
                    caseNumber: 'ST-2/2013',
                    amounts: [
                        { description: 'Isplata drugog višeg isplatnog reda', amount: '1.200.000,00', currency: 'EUR', date: '2025-12-17' },
                        { description: 'Rezervacija parničnih troškova', amount: 1033.25, currency: 'EUR' }
                    ]
                },
                {
                    id: 'a-2',
                    fileName: 'troškovnik.pdf',
                    caseNumber: 'ST-2/2013',
                    amounts: [
                        { description: 'Trošak prijeboja', amount: 63.38, currency: 'EUR' }
                    ]
                },
                {
                    id: 'a-3',
                    fileName: 'bez_iznosa.pdf',
                    caseNumber: 'ST-2/2013',
                    amounts: []
                }
            ];

            const flow = collectMoneyFlows(analyses);

            expect(flow.count).toBe(3);
            expect(flow.hasMoneyFlow).toBe(true);
            expect(flow.currencyTotals).toEqual({ EUR: 1200000.00 + 1033.25 + 63.38 });
            expect(flow.entries[0]).toEqual(expect.objectContaining({
                amount: 1200000.00,
                currency: 'EUR',
                description: 'Isplata drugog višeg isplatnog reda',
                date: '2025-12-17',
                sourceId: 'a-1',
                fileName: 'diobni_popis.pdf',
                caseNumber: 'ST-2/2013'
            }));
        });

        test('returns an empty surface when there are no amounts', () => {
            const flow = collectMoneyFlows([
                { id: 'a-1', fileName: 'x.pdf', amounts: [] },
                { id: 'a-2', fileName: 'y.pdf', amounts: undefined }
            ]);

            expect(flow).toEqual({
                count: 0,
                entries: [],
                currencyTotals: {},
                hasMoneyFlow: false
            });
        });

        test('skips malformed amount entries', () => {
            const flow = collectMoneyFlows([
                {
                    id: 'a-1',
                    fileName: 'x.pdf',
                    amounts: [
                        { description: 'Bez iznosa' },
                        { amount: 'neodređeno', currency: 'EUR' },
                        { amount: '12,50', currency: 'HRK' }
                    ]
                }
            ]);

            expect(flow.count).toBe(1);
            expect(flow.entries[0].amount).toBe(12.5);
            expect(flow.entries[0].currency).toBe('HRK');
        });
    });
});