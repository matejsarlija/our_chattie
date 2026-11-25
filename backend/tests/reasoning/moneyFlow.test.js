const { collectFlows, normalizeCurrency, parseAmount, normalizeDirection, normalizeOib } = require('../../court-analysis/reasoning/ledger/flow');

describe('canonical money flows', () => {
    test('normalizes amounts into the shared flow contract', () => {
        expect(parseAmount('63,38')).toBe(63.38);
        expect(normalizeCurrency('kn')).toBe('HRK');
        expect(normalizeDirection('dosuđeno')).toBe('awarded');
        expect(normalizeOib('66124057408')).toBe('66124057408');

        const flow = collectFlows([{
            id: 'a-1',
            fileName: 'doc.pdf',
            caseNumber: 'St-1/2024',
            amounts: [{ description: 'Polog', amount: 1200, currency: 'EUR', direction: 'obveza', payerName: 'Dužnik d.o.o.' }],
        }]).entries[0];
        expect(flow).toEqual(expect.objectContaining({
            id: 'flow-1',
            kind: 'amount',
            amountEur: 1200,
            sourceAmount: 1200,
            sourceCurrency: 'EUR',
            sourcePages: [],
            sourceChunkId: null,
            docId: 'a-1',
            grounded: false,
            crossCategoryFactId: null,
            valueChanges: [],
            direction: 'obveza',
            transferor: 'Dužnik d.o.o.',
        }));
        expect(flow.canonicalPartyId).toBeNull();
    });
});
