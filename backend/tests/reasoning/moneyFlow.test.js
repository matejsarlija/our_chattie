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

        test('K-02: every entry carries a consolidated amountEur', () => {
            const flow = collectMoneyFlows([
                {
                    id: 'a-1',
                    fileName: 'x.pdf',
                    amounts: [
                        { description: 'Isplata', amount: 1000, currency: 'EUR' },
                        { description: 'Stara obveza', amount: '7.534,50', currency: 'HRK' },
                        { description: 'Nepoznata valuta', amount: 5, currency: 'USD' },
                    ]
                }
            ]);

            expect(flow.entries[0]).toEqual(expect.objectContaining({
                amountEur: 1000, amountEurSource: 'as-is',
            }));
            expect(flow.entries[1]).toEqual(expect.objectContaining({
                amountEur: 1000, amountEurSource: 'converted',
            }));
            expect(flow.entries[2].amountEur).toBeNull();
            expect(flow.entries[2].amountEurSource).toBeNull();
            expect(flow.eurTotal).toBe(2000);
        });

        test('K-04: source-stated dual quote prefers EUR and records the pair', () => {
            const flow = collectMoneyFlows([
                {
                    id: 'a-1',
                    fileName: 'Troškovnik.pdf',
                    amounts: [{
                        description: 'Trošak prijeboja',
                        amount: '248,86',
                        currency: 'EUR',
                        quote: 'Trošak prijeboja iznosi 248,86 € (1.875,oo kn).',
                    }]
                }
            ]);

            expect(flow.entries[0]).toEqual(expect.objectContaining({
                amountEur: 248.86,
                amountEurSource: 'stated',
                dualCurrency: expect.objectContaining({ statedEur: 248.86, statedHrk: 1875 }),
            }));
            expect(flow.entries[0].currencyNote).toBeUndefined();
        });

        test('K-04: inconsistent dual figures keep EUR but flag dual-mismatch', () => {
            const flow = collectMoneyFlows([
                {
                    id: 'a-1',
                    fileName: 'x.pdf',
                    amounts: [{
                        description: 'Sporni trošak',
                        amount: 248.86,
                        currency: 'EUR',
                        amountHrk: 1500,
                    }]
                }
            ]);

            expect(flow.entries[0].amountEur).toBe(248.86);
            expect(flow.entries[0].currencyNote).toBe('dual-mismatch');
            expect(flow.entries[0].dualCurrency.deviationPct).toBeGreaterThan(1);
        });

        test('J-01: direction normalizes Croatian rulings to the enum', () => {
            const { normalizeDirection } = require('../../court-analysis/reasoning/moneyFlow');
            expect(normalizeDirection('potraživanje')).toBe('potraživanje');
            expect(normalizeDirection('obveza')).toBe('obveza');
            expect(normalizeDirection('dosuđeno')).toBe('awarded');
            expect(normalizeDirection('odbijeno')).toBe('rejected');
            expect(normalizeDirection('prijeboj')).toBe('netted');
            expect(normalizeDirection('nepoznato')).toBeNull();
            expect(normalizeDirection(null)).toBeNull();
        });

        test('J-02/J-03/J-04: identity, rank and registry identifiers normalize', () => {
            const { normalizeOib } = require('../../court-analysis/reasoning/moneyFlow');
            expect(normalizeOib('66124057408')).toBe('66124057408');
            expect(normalizeOib('HR 66124057408')).toBe('66124057408');
            expect(normalizeOib('123')).toBeNull();

            const flow = collectMoneyFlows([
                {
                    id: 'a-1',
                    fileName: 'Prilog.pdf',
                    caseNumber: 'St-2/2013',
                    amounts: [{
                        description: 'Tražbina CroGo',
                        amount: 1000,
                        currency: 'EUR',
                        direction: 'potraživanje',
                        payerName: 'Kerum d.o.o.',
                        payerOib: '66124057408',
                        recipientName: 'CroGo d.o.o.',
                        recipientOib: '12345678901',
                        isplatniRed: 'drugi viši isplatni red',
                        claimRegistryNumber: '106',
                        filingReference: 'St-2/2013-1196-1',
                    }]
                }
            ]);
            expect(flow.entries[0]).toEqual(expect.objectContaining({
                direction: 'potraživanje',
                payerName: 'Kerum d.o.o.',
                payerOib: '66124057408',
                recipientName: 'CroGo d.o.o.',
                recipientOib: '12345678901',
                isplatniRed: 'drugi viši isplatni red',
                claimRegistryNumber: '106',
                filingReference: 'St-2/2013-1196-1',
                // J-02 bridges the legacy from/to plumbing so it receives data.
                from: 'Kerum d.o.o.',
                to: 'CroGo d.o.o.',
            }));
        });
    });
});