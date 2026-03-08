const { normalizeCaseNumber } = require('../court-analysis/utils/caseNumber');

describe('normalizeCaseNumber', () => {
    test('normalizes standard case number', () => {
        expect(normalizeCaseNumber('St-357/2013')).toBe('ST-357/2013');
    });

    test('normalizes case number with spaces', () => {
        expect(normalizeCaseNumber(' st - 357 / 2013 ')).toBe('ST-357/2013');
    });

    test('normalizes lowercase to uppercase', () => {
        expect(normalizeCaseNumber('st-357/2013')).toBe('ST-357/2013');
    });

    test('handles variations in separators', () => {
        // Some might use different dashes or spacing
        expect(normalizeCaseNumber('St–357/2013')).toBe('ST-357/2013'); // En dash
        expect(normalizeCaseNumber('St—357/2013')).toBe('ST-357/2013'); // Em dash
    });

    test('handles Pn case types', () => {
        expect(normalizeCaseNumber('Pn-123/2023')).toBe('PN-123/2023');
    });

    test('handles Ovr case types', () => {
         expect(normalizeCaseNumber('Ovr-456/2024')).toBe('OVR-456/2024');
    });

    test('returns null for empty or invalid input', () => {
        expect(normalizeCaseNumber(null)).toBe(null);
        expect(normalizeCaseNumber(undefined)).toBe(null);
        expect(normalizeCaseNumber('')).toBe(null);
        expect(normalizeCaseNumber('   ')).toBe(null);
    });

    test('preserves non-case-number text but normalizes whitespace/case', () => {
        // If it doesn't match the specific case number pattern, we still want a clean string key
        expect(normalizeCaseNumber('Some Random Text')).toBe('SOME RANDOM TEXT');
    });

    test('handles N/A explicitly as null', () => {
         expect(normalizeCaseNumber('N/A')).toBe(null);
         expect(normalizeCaseNumber('n/a')).toBe(null);
    });
});
