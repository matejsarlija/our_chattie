const { validateGoldLabels } = require('../../../court-analysis/reasoning/eval/goldSchema');

const validGold = () => ({
    schemaVersion: 1,
    clusterId: 'Stč-2150/2022',
    citationSpans: [{ textIncludes: 'otvara se stečajni postupak' }],
    expectedAmounts: [{ value: 1200, currency: 'EUR', tolerancePct: 0.001 }]
});

describe('eval goldSchema', () => {
    test('accepts a well-formed gold document', () => {
        const { valid, errors } = validateGoldLabels(validGold());
        expect(valid).toBe(true);
        expect(errors).toEqual([]);
    });

    test('rejects non-object input', () => {
        expect(validateGoldLabels(null).valid).toBe(false);
        expect(validateGoldLabels([1]).valid).toBe(false);
    });

    test('requires matching schemaVersion and clusterId', () => {
        const gold = { ...validGold(), schemaVersion: 99, clusterId: '' };
        const { valid, errors } = validateGoldLabels(gold);
        expect(valid).toBe(false);
        expect(errors.join(' ')).toMatch(/schemaVersion/);
        expect(errors.join(' ')).toMatch(/clusterId/);
    });

    test('requires at least one well-formed citation span', () => {
        const emptySpans = validateGoldLabels({ ...validGold(), citationSpans: [] });
        expect(emptySpans.valid).toBe(false);

        const badSpan = validateGoldLabels({ ...validGold(), citationSpans: [{ textIncludes: '   ' }] });
        expect(badSpan.valid).toBe(false);
        expect(badSpan.errors.join(' ')).toMatch(/textIncludes/);
    });

    test('validates amount shape when present', () => {
        const { valid, errors } = validateGoldLabels({
            ...validGold(),
            expectedAmounts: [{ value: '1200', currency: 'EUR' }, { value: 5, currency: '', tolerancePct: -1 }]
        });
        expect(valid).toBe(false);
        expect(errors.join(' ')).toMatch(/expectedAmounts\[0\].value/);
        expect(errors.join(' ')).toMatch(/expectedAmounts\[1\].currency/);
        expect(errors.join(' ')).toMatch(/tolerancePct/);
    });

    test('validates expectedDates shape when present', () => {
        const { errors } = validateGoldLabels({ ...validGold(), expectedDates: ['2022-03-15', ''] });
        expect(errors.join(' ')).toMatch(/expectedDates/);
    });
});
