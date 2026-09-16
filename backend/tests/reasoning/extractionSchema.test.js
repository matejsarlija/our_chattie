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
            citedFilingReferences: ['St-2/2013-1196-1', '  ', null]
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

    test('absent arrays default to empty without gaps; malformed arrays gap', () => {
        const absent = validateExtraction({ summary: 'Samo sažetak.' });
        expect(absent.valid).toBe(true);
        expect(absent.value.amounts).toEqual([]);
        expect(absent.value.propertyFlow).toEqual([]);

        const malformed = validateExtraction({ summary: 'S.', amounts: 'not-an-array', propertyFlow: 42 });
        expect(malformed.valid).toBe(false);
        expect(malformed.value.amounts).toEqual([]);
        expect(malformed.value.propertyFlow).toEqual([]);
        expect(malformed.gaps).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: 'amounts', code: 'schema-mismatch' }),
            expect.objectContaining({ field: 'propertyFlow', code: 'schema-mismatch' })
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

    test('schema version and repairable set are published', () => {
        expect(EXTRACTION_SCHEMA_VERSION).toBe(1);
        expect(REPAIRABLE_FIELDS).toEqual(['amounts', 'propertyFlow']);
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

        const bad = parseFieldRepairResponse('{"value": [{"amount": 5}], "absent": false}', 'amounts');
        expect(bad.ok).toBe(false);
        expect(bad.gaps).toEqual([expect.objectContaining({ field: 'amounts[0]' })]);

        expect(parseFieldRepairResponse('not json at all', 'amounts').ok).toBe(false);
        expect(parseFieldRepairResponse('{"value": "nope", "absent": false}', 'amounts').ok).toBe(false);
        expect(parseFieldRepairResponse('{"value": [], "absent": false}', 'caseNumber').ok).toBe(false);
    });

    test('repair prompts carry the source excerpt and never ask for summaries of summaries', () => {
        const field = buildFieldRepairPrompt({ field: 'amounts', sourceText: 'IZVORNI TEKST' });
        expect(field).toContain('FIELD REPAIR');
        expect(field).toContain('IZVORNI TEKST');
        expect(() => buildFieldRepairPrompt({ field: 'summary', sourceText: 'x' })).toThrow();

        const full = buildFullRepairPrompt({ sourceText: 'IZVORNI TEKST' });
        expect(full).toContain('EXTRACTION REPAIR');
        expect(full).toContain('IZVORNI TEKST');
    });
});
