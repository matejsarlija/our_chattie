const { GEMINI_ROLE_CONFIG } = require('../../helpers/geminiConfig');
const {
    EXTRACTION_SCHEMA_VERSION,
    REPAIRABLE_FIELDS,
    validateExtraction,
    validateAmount,
    parseFieldRepairResponse,
    buildFieldRepairPrompt,
    buildFullRepairPrompt
} = require('../../court-analysis/reasoning/extractionSchema');

describe('validateExtraction', () => {
    test('accepts a fully valid document with no gaps', () => {
        const doc = {
            caseNumber: 'ST-2/2013',
            decisionDate: '2024-01-10',
            summary: 'Sažetak.',
            amounts: [{
                description: 'Tražbina',
                amount: 1000,
                currency: 'EUR',
                direction: 'obveza',
                payerOib: '66124057408',
                quote: 'verbatim'
            }],
            propertyFlow: [],
            citedFilingReferences: ['St-2/2013-1196-1', '  ', null],
            proceduralEvents: [{
                eventType: 'appellate-decision',
                instance: 'Županijski sud u Splitu',
                outcome: 'overturned',
                finalityStated: 'final',
                date: '2024-02-15',
                filingReference: 'St-2/2013-2000',
                targetFilingReference: 'St-2/2013-1196-1',
                description: 'Ukida se prvostupanjska odluka.',
                quote: 'Ukida se prvostupanjska odluka.',
            }],
        };
        const result = validateExtraction(doc);

        expect(result.valid).toBe(true);
        expect(result.gaps).toEqual([]);
        expect(result.value.amounts[0]).toEqual(expect.objectContaining({
            description: 'Tražbina',
            amount: 1000,
            currency: 'EUR',
            direction: 'obveza',
            payerOib: '66124057408',
            quote: 'verbatim'
        }));
        expect(result.value.citedFilingReferences).toEqual(['St-2/2013-1196-1']);
        expect(result.value.proceduralEvents).toEqual([expect.objectContaining({
            eventType: 'appellate-decision',
            instance: 'Županijski sud u Splitu',
            outcome: 'overturned',
            finalityStated: 'final',
            filingReference: 'St-2/2013-2000',
            targetFilingReference: 'St-2/2013-1196-1',
            quote: 'Ukida se prvostupanjska odluka.',
        })]);
    });
    test('decisionOutcome accepts enum values, treats absence as null, and gaps invalid enums', () => {
        const valid = validateExtraction({ decisionOutcome: 'rejected' });
        expect(valid.valid).toBe(true);
        expect(valid.value.decisionOutcome).toBe('rejected');

        for (const input of [{ decisionOutcome: null }, {}]) {
            const absent = validateExtraction(input);
            expect(absent.value.decisionOutcome).toBeNull();
            expect(absent.gaps).toEqual([]);
        }

        const invalid = validateExtraction({ decisionOutcome: 'maybe' });
        expect(invalid.valid).toBe(false);
        expect(invalid.value.decisionOutcome).toBeNull();
        expect(invalid.gaps).toEqual([expect.objectContaining({
            field: 'decisionOutcome',
            code: 'invalid-enum',
        })]);
    });

    test('document party identities require an exact 11-digit OIB and source quote', () => {
        const valid = validateExtraction({
            documentParties: [{
                name: 'ADRIA RIJEKA d.o.o.',
                oib: '08697489827',
                role: 'dužnik',
                quote: 'ADRIA RIJEKA d.o.o., OIB: 08697489827',
            }],
        });
        expect(valid.valid).toBe(true);
        expect(valid.value.documentParties).toEqual([{
            name: 'ADRIA RIJEKA d.o.o.',
            oib: '08697489827',
            role: 'dužnik',
            quote: 'ADRIA RIJEKA d.o.o., OIB: 08697489827',
        }]);

        const invalid = validateExtraction({
            documentParties: [{ name: 'ADRIA', oib: '123', quote: '' }],
        });
        expect(invalid.value.documentParties).toEqual([]);
        expect(invalid.gaps.map((item) => item.field)).toEqual([
            'documentParties[0].oib',
            'documentParties[0].quote',
        ]);
    });

    test('null root and non-object roots are unusable, never thrown', () => {
        for (const bad of [null, undefined, 'string', 42, []]) {
            const result = validateExtraction(bad);
            expect(result.value).toBeNull();
            expect(result.valid).toBe(false);
            expect(result.gaps).toEqual([
                expect.objectContaining({ field: '$', code: 'malformed-json' })
            ]);
        }
    });

    test('invalid property enums are gaps rather than silently reclassified', () => {
        const result = validateExtraction({
            summary: 'S.',
            propertyFlow: [{ description: 'Nekretnina', assetType: 'nepoznato', eventType: 'pogrešno' }]
        });
        expect(result.valid).toBe(false);
        expect(result.value.propertyFlow[0]).toEqual(expect.objectContaining({ assetType: 'drugo', eventType: null }));
        expect(result.gaps.map((entry) => entry.field)).toEqual(expect.arrayContaining([
            'propertyFlow[0].assetType', 'propertyFlow[0].eventType'
        ]));
    });
    test('procedural events validate all requested fields and invalid enums leave a gap', () => {
        const valid = validateExtraction({
            proceduralEvents: [{
                eventType: 'appeal',
                instance: 'Visoki trgovački sud',
                outcome: 'pending',
                finalityStated: 'appealed',
                date: '2024-01-20',
                filingReference: 'St-2/2013-1210',
                targetFilingReference: 'St-2/2013-1196-1',
                description: 'Žalba protiv odluke.',
                quote: 'Podnosimo žalbu protiv rješenja.',
            }],
        });
        expect(valid.valid).toBe(true);
        expect(valid.value.proceduralEvents[0]).toEqual(expect.objectContaining({
            eventType: 'appeal',
            outcome: 'pending',
            finalityStated: 'appealed',
            filingReference: 'St-2/2013-1210',
            targetFilingReference: 'St-2/2013-1196-1',
        }));

        const invalid = validateExtraction({
            proceduralEvents: [{
                eventType: 'lawsuit',
                outcome: 'maybe',
                finalityStated: 'probably',
                description: 'Odluka.',
            }],
        });
        expect(invalid.valid).toBe(false);
        expect(invalid.gaps.map((item) => item.field)).toEqual(expect.arrayContaining([
            'proceduralEvents[0].eventType',
            'proceduralEvents[0].outcome',
            'proceduralEvents[0].finalityStated',
        ]));
    });

    test('absent arrays default to empty without gaps; malformed arrays gap', () => {
        const absent = validateExtraction({ summary: 'Samo sažetak.' });
        expect(absent.valid).toBe(true);
        expect(absent.value.documentParties).toEqual([]);
        expect(absent.value.amounts).toEqual([]);
        expect(absent.value.propertyFlow).toEqual([]);
        expect(absent.value.proceduralEvents).toEqual([]);

        const malformed = validateExtraction({
            summary: 'S.',
            documentParties: 'not-an-array',
            amounts: 'not-an-array',
            propertyFlow: 42,
            proceduralEvents: 'not-an-array',
        });
        expect(malformed.valid).toBe(false);
        expect(malformed.value.documentParties).toEqual([]);
        expect(malformed.value.amounts).toEqual([]);
        expect(malformed.value.propertyFlow).toEqual([]);
        expect(malformed.value.proceduralEvents).toEqual([]);
        expect(malformed.gaps).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'documentParties', code: 'schema-mismatch' }),
            expect.objectContaining({ field: 'amounts', code: 'schema-mismatch' }),
            expect.objectContaining({ field: 'propertyFlow', code: 'schema-mismatch' }),
            expect.objectContaining({ field: 'proceduralEvents', code: 'schema-mismatch' }),
        ]));
    });

    test('amount entries without descriptions drop with a gap; bad enums null out', () => {
        const result = validateExtraction({
            summary: 'S.',
            amounts: [
                { amount: 100, currency: 'EUR' },
                { description: '  ', amount: 5 },
                { description: 'Dobra tražbina', amount: 'not-a-number', currency: 'USD', direction: 'bogus', payerOib: '123', quote: 42 }
            ]
        });

        expect(result.valid).toBe(false);
        expect(result.value.amounts).toHaveLength(1);
        expect(result.value.amounts[0]).toEqual(expect.objectContaining({
            description: 'Dobra tražbina',
            amount: null,
            currency: null,
            direction: null,
            payerOib: null,
            quote: '42'
        }));
        expect(result.gaps.map((g) => g.field)).toEqual(expect.arrayContaining(['amounts[0]', 'amounts[1]']));
        expect(result.gaps.every((g) => g.code === 'schema-mismatch')).toBe(true);
    });

    test('validateAmount rejects non-objects without throwing', () => {
        expect(validateAmount('x', 0).value).toBeNull();
        expect(validateAmount(null, 1).value).toBeNull();
        expect(validateAmount([], 2).value).toBeNull();
    });

    test('TL-1 ledger fields validate; invalid-but-present roles gap', () => {
        const result = validateExtraction({
            summary: 'S.',
            amounts: [{
                description: 'Ukupno potraživanje',
                amount: 100,
                currency: 'EUR',
                amountRole: 'total',
                legalEffect: 'resolves',
                references: ['St-2/2013-1196-1', '  ', 42],
                relationshipBasis: 'explicit_text',
                eventType: 'namirenje'
            }]
        });

        expect(result.valid).toBe(true);
        expect(result.value.amounts[0]).toEqual(expect.objectContaining({
            amountRole: 'total',
            legalEffect: 'resolves',
            references: ['St-2/2013-1196-1', '42'],
            relationshipBasis: 'explicit_text',
            eventType: 'namirenje'
        }));

        const bad = validateExtraction({
            summary: 'S.',
            amounts: [{ description: 'X', amountRole: 'bogus', legalEffect: 'bogus', relationshipBasis: 'bogus', references: 'nope' }]
        });
        expect(bad.valid).toBe(false);
        expect(bad.value.amounts[0]).toEqual(expect.objectContaining({
            amountRole: null,
            legalEffect: null,
            relationshipBasis: null,
            references: []
        }));
        expect(bad.gaps.map((g) => g.field)).toEqual(expect.arrayContaining([
            'amounts[0].amountRole', 'amounts[0].legalEffect',
            'amounts[0].relationshipBasis', 'amounts[0].references'
        ]));
    });

    test('property amounts retain explicit value roles and reject unknown roles', () => {
        const valid = validateExtraction({
            propertyFlow: [{
                description: 'Saldo tražbine',
                value: 100,
                assetType: 'tražbina',
                valueRole: 'claim_balance',
            }],
        });
        expect(valid.value.propertyFlow[0].valueRole).toBe('claim_balance');

        const invalid = validateExtraction({
            propertyFlow: [{ description: 'Vrijednost', valueRole: 'maybe-balance' }],
        });
        expect(invalid.value.propertyFlow[0].valueRole).toBeNull();
        expect(invalid.gaps.map((item) => item.field)).toContain('propertyFlow[0].valueRole');
    });

    test('schema version and repairable set are published', () => {
        expect(EXTRACTION_SCHEMA_VERSION).toBe(4);
        expect(REPAIRABLE_FIELDS).toEqual(['documentParties', 'amounts', 'propertyFlow', 'proceduralEvents']);
    });
});

describe('parseFieldRepairResponse', () => {
    test('accepts the absent protocol without a gap', () => {
        expect(parseFieldRepairResponse('{"value": null, "absent": true}', 'amounts')).toEqual({
            ok: true, absent: true, value: []
        });
        expect(parseFieldRepairResponse('{"value": null, "absent": true}', 'caseNumber')).toEqual({
            ok: true, absent: true, value: null
        });
    });

    test('re-validates repaired arrays with the same validators', () => {
        const good = parseFieldRepairResponse(
            '{"value": [{"description": "T", "amount": 5, "currency": "EUR"}], "absent": false}',
            'amounts'
        );
        expect(good.ok).toBe(true);
        expect(good.value).toHaveLength(1);
        const partyRepair = parseFieldRepairResponse(
            '{"value": [{"name": "ADRIA", "oib": "08697489827", "quote": "OIB: 08697489827"}], "absent": false}',
            'documentParties',
        );
        expect(partyRepair).toMatchObject({
            ok: true,
            absent: false,
            value: [{ name: 'ADRIA', oib: '08697489827', role: null, quote: 'OIB: 08697489827' }],
        });


        const bad = parseFieldRepairResponse('{"value": [{"amount": 5}], "absent": false}', 'amounts');
        expect(bad.ok).toBe(false);
        expect(bad.gaps).toEqual([expect.objectContaining({ field: 'amounts[0]' })]);

        const eventRepair = parseFieldRepairResponse(
            '{"value": [{"eventType": "decision", "outcome": "granted", "description": "Rješenje"}], "absent": false}',
            'proceduralEvents',
        );
        expect(eventRepair.ok).toBe(true);
        expect(eventRepair.value[0]).toEqual(expect.objectContaining({ eventType: 'decision', outcome: 'granted' }));

        expect(parseFieldRepairResponse('not json at all', 'amounts').ok).toBe(false);
        expect(parseFieldRepairResponse('{"value": "nope", "absent": false}', 'amounts').ok).toBe(false);
        expect(parseFieldRepairResponse('{"value": [], "absent": false}', 'caseNumber').ok).toBe(false);
    });

    test('repair prompts carry all event fields and original source excerpt', () => {
        const field = buildFieldRepairPrompt({ field: 'amounts', sourceText: 'IZVORNI TEKST' });
        expect(field).toContain('FIELD REPAIR');
        expect(field).toContain('IZVORNI TEKST');
        expect(() => buildFieldRepairPrompt({ field: 'summary', sourceText: 'x' })).toThrow();

        const eventField = buildFieldRepairPrompt({ field: 'proceduralEvents', sourceText: 'ODLUKA IZVOR' });
        for (const fieldName of ['eventType', 'instance', 'outcome', 'finalityStated', 'date', 'filingReference', 'targetFilingReference', 'description', 'quote']) {
            expect(eventField).toContain(fieldName);
        }
        expect(buildFieldRepairPrompt({ field: 'documentParties', sourceText: 'OIB: 08697489827' })).toContain('source-explicit party identities');
        expect(buildFullRepairPrompt({ sourceText: 'OIB: 08697489827' })).toContain('"documentParties"');
        expect(buildFullRepairPrompt({ sourceText: 'IZVORNI TEKST' })).toContain('proceduralEvents');
        const fullRepair = buildFullRepairPrompt({ sourceText: 'ODLUKA IZVOR' });
        expect(fullRepair).toContain('"decisionOutcome"');
        expect(fullRepair).toContain('Every individual data row/transaction');
        expect(fullRepair).toContain('never mixing payout into amountEur');
    });

    test('dense documents leave output-token headroom for procedural events', () => {
        const dense = {
            summary: 'S'.repeat(2000),
            amounts: Array.from({ length: 30 }, (_, index) => ({
                description: `Tražbina ${index + 1}`,
                amount: 1000 + index,
                currency: 'EUR',
                quote: 'izvorni navod '.repeat(12),
            })),
            propertyFlow: Array.from({ length: 10 }, (_, index) => ({
                description: `Prenesena imovina ${index + 1}`,
                assetType: 'tražbina',
                eventType: 'ustup',
                value: 5000 + index,
                currency: 'EUR',
                quote: 'ustup tražbine '.repeat(12),
            })),
            proceduralEvents: Array.from({ length: 20 }, (_, index) => ({
                eventType: index % 2 ? 'appeal' : 'decision',
                instance: 'Trgovački sud u Zagrebu',
                outcome: index % 2 ? 'pending' : 'granted',
                finalityStated: 'unknown',
                date: '2024-01-10',
                filingReference: `St-2/2013-${1000 + index}`,
                targetFilingReference: `St-2/2013-${900 + index}`,
                description: `Odluka broj ${index + 1} o prijedlogu vjerovnika.`,
                quote: 'Ovim rješenjem odlučuje se o podnesenom prijedlogu. '.repeat(3),
            })),
            citedFilingReferences: Array.from({ length: 20 }, (_, index) => `St-2/2013-${900 + index}`),
        };
        const estimatedCapacity = GEMINI_ROLE_CONFIG.analysis.maxOutputTokens * 4;
        expect(JSON.stringify(dense).length).toBeLessThan(estimatedCapacity * 0.75);
    });
});
