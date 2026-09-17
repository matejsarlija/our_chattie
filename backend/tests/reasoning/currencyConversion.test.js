const {
    HRK_PER_EUR,
    hrkToEur,
    convertToEur,
    dualMismatch,
} = require('../../court-analysis/reasoning/currencyConversion');

describe('reasoning currencyConversion (K-01)', () => {
    test('fixed legal rate is 7.53450 HRK per EUR', () => {
        expect(HRK_PER_EUR).toBe(7.53450);
    });

    test('hrkToEur converts the Troškovnik dual figure to the stated EUR', () => {
        // Real fixture: Troškovnik.pdf states "248,86 € (1.875,oo kn)" —
        // 1875 / 7.53450 = 248.855… → 248.86, matching the filing exactly.
        expect(hrkToEur(1875)).toBe(248.86);
    });

    test('hrkToEur rounds to cents and rejects non-numeric input', () => {
        expect(hrkToEur(753.45)).toBe(100);
        expect(hrkToEur('x')).toBeNull();
        expect(hrkToEur(null)).toBeNull();
    });

    test('convertToEur passes EUR through, converts HRK, nulls unknown', () => {
        expect(convertToEur(100, 'EUR')).toBe(100);
        expect(convertToEur(753.45, 'HRK')).toBe(100);
        expect(convertToEur(100, 'USD')).toBeNull();
        expect(convertToEur(100, null)).toBeNull();
        expect(convertToEur(null, 'EUR')).toBeNull();
    });

    test('dualMismatch: consistent dual figures do not flag', () => {
        const r = dualMismatch(248.86, 1875);
        expect(r.mismatched).toBe(false);
        expect(r.convertedEur).toBe(248.86);
    });

    test('dualMismatch: genuinely inconsistent figures flag', () => {
        const r = dualMismatch(248.86, 1500);
        expect(r.mismatched).toBe(true);
        expect(r.deviationPct).toBeGreaterThan(1);
    });

    test('dualMismatch: tiny rounding noise never flags (absolute floor)', () => {
        const r = dualMismatch(0.1, 1);
        expect(r.mismatched).toBe(false);
    });

    test('dualMismatch: non-numeric input degrades without throwing', () => {
        expect(dualMismatch(null, 100)).toEqual({ convertedEur: null, deviationPct: null, mismatched: false });
    });
});
