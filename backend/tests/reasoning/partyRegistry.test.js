'use strict';

const { buildCanonicalParties, normalizePartyName, extractValidOib } = require('../../court-analysis/reasoning/ledger/partyRegistry');

describe('partyRegistry', () => {
    test('extractValidOib extracts 11-digit OIBs and rejects invalid values', () => {
        expect(extractValidOib('12345678901')).toBe('12345678901');
        expect(extractValidOib('OIB: 66124057408')).toBe('66124057408');
        expect(extractValidOib('12345')).toBeNull();
        expect(extractValidOib(null)).toBeNull();
    });

    test('normalizePartyName strips corporate suffixes and Croatian diacritics', () => {
        expect(normalizePartyName('B2 KAPITAL d.o.o.')).toBe('b2 kapital');
        expect(normalizePartyName('KERUM d.o.o. u stečaju')).toBe('kerum');
        expect(normalizePartyName('Čićak & Sinovi j.d.o.o.')).toBe('cicak sinovi');
    });

    test('resolves name-only variants onto oib:<11-digit> when OIB appears elsewhere in the cluster', () => {
        const registry = buildCanonicalParties([
            {
                id: 'doc-1',
                docId: 'doc-hash-1',
                documentParties: [
                    { name: 'B2 KAPITAL d.o.o.', oib: '49803335555', role: 'vjerovnik' },
                ],
                amounts: [
                    { payerName: 'KERUM d.o.o. u stečaju', recipientName: 'B2 Kapital', amount: 1000, currency: 'EUR' },
                ],
            },
            {
                id: 'doc-2',
                docId: 'doc-hash-2',
                documentParties: [
                    { name: 'B2 Kapital d.o.o.', oib: null, role: 'tuženik' },
                ],
            },
        ], [
            {
                caseInfo: {
                    participants: [{ name: 'KERUM d.o.o.', oib: '66124057408', role: 'DUŽNIK' }],
                },
            },
        ]);

        expect(registry.resolve('B2 Kapital d.o.o.')).toBe('oib:49803335555');
        expect(registry.resolve('KERUM d.o.o.')).toBe('oib:66124057408');
        expect(registry.resolve('Nepoznati Vjerovnik d.o.o.')).toBe('name:nepoznati vjerovnik');

        const b2 = registry.parties.find((p) => p.canonicalPartyId === 'oib:49803335555');
        expect(b2).toBeDefined();
        expect(b2.roles).toEqual(expect.arrayContaining(['vjerovnik', 'tuženik']));
        expect(b2.documentCount).toBe(2);
    });
});
