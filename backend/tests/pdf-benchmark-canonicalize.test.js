'use strict';

const {
    canonicalAmount,
    canonicalCurrency,
    canonicalDate,
    canonicalFilingNumber,
    canonicalOib,
    extractFilingNumbers,
    parseAmountNumber,
} = require('../scripts/lib/canonicalize');

test('dates canonicalize to ISO across the forms Croatian filings actually print', () => {
    expect(canonicalDate('27. listopada 2025.g.')).toBe('2025-10-27');
    expect(canonicalDate('08. lipnja 2026.')).toBe('2026-06-08');
    expect(canonicalDate('8.6.2026.')).toBe('2026-06-08');
    expect(canonicalDate('2026.01.26')).toBe('2026-01-26');
    expect(canonicalDate('2026-01-26')).toBe('2026-01-26');
});

test('a stray dot after the month is still a date, not a false negative', () => {
    // Both forms were real gold entries. The old normalizer read neither, so
    // the arms that found the date were charged a false positive for it.
    expect(canonicalDate('22. travnja. 2022.g.')).toBe('2022-04-22');
    expect(canonicalDate('17 -07- 2025')).toBe('2025-07-17');
});

test('impossible dates are rejected instead of silently rolled over', () => {
    expect(canonicalDate('31.2.2026.')).toBeNull();
    expect(canonicalDate('nije datum')).toBeNull();
    expect(canonicalDate('')).toBeNull();
});

test('amounts parse Croatian, English and OCR spellings without converting currency', () => {
    expect(parseAmountNumber('1.234,56')).toBe('1234.56');
    expect(parseAmountNumber('1,234.56')).toBe('1234.56');
    expect(parseAmountNumber('1.875,oo')).toBe('1875.00');
    expect(canonicalAmount('185,48', '€')).toBe('185.48|EUR');
    expect(canonicalAmount('1.397,50', 'kn')).toBe('1397.50|HRK');
    // The source figure is compared as stated; a stated EUR is not rewritten
    // into HRK (or the reverse) by the harness.
    expect(canonicalAmount('1.033,25', 'EUR')).toBe('1033.25|EUR');
});

test('an amount with no currency is not a comparable fact', () => {
    expect(canonicalAmount('1.234,56', '')).toBeNull();
    expect(canonicalAmount('1.234,56', null)).toBeNull();
    expect(canonicalCurrency('kuna')).toBe('HRK');
});

test('an OIB stays an 11-digit string, leading zero included', () => {
    expect(canonicalOib('08697489827')).toBe('08697489827');
    expect(canonicalOib('OIB: 08697489827')).toBe('08697489827');
    expect(canonicalOib(' 66124057408 ')).toBe('66124057408');
    expect(canonicalOib('08697489827')).toHaveLength(11);
});

test('filing-number typography collapses to one identity', () => {
    // Dash vs en dash, spacing, and a dash lost at a line wrap.
    expect(extractFilingNumbers('St-2/2013-1214')).toEqual(['St-2/2013-1214']);
    expect(extractFilingNumbers('St – 2/2013-1214')).toEqual(['St-2/2013-1214']);
    expect(extractFilingNumbers('St2/2013-1214')).toEqual(['St-2/2013-1214']);
    expect(extractFilingNumbers('Pž2889/2022-2')).toEqual(['Pž-2889/2022-2']);
    expect(extractFilingNumbers('Pž-2889/2022-2')).toEqual(['Pž-2889/2022-2']);
    // Extraction can split digits with whitespace.
    expect(extractFilingNumbers('St - 2 /2 0 13')).toEqual(['St-2/2013']);
});

test('register prefixes stay distinct identities', () => {
    expect(extractFilingNumbers('4 St-2/2013')).toEqual(['4 St-2/2013']);
    expect(extractFilingNumbers('4 St-2/2013, St-2/2013')).toHaveLength(2);
    // A register whose own spelling ends in a digit is not merged with its
    // sequence.
    expect(extractFilingNumbers('R1 123/2020')).toEqual(['R1-123/2020']);
    expect(extractFilingNumbers('R123/2020')).toEqual(['R-123/2020']);
});

test('ordinary prose and amounts are never read as filing numbers', () => {
    expect(extractFilingNumbers('račun 1.234/2020')).toEqual([]);
    expect(extractFilingNumbers('List 2/2013')).toEqual([]);
    expect(extractFilingNumbers('')).toEqual([]);
    expect(canonicalFilingNumber('Povrv - 772/2021 - 10')).toBe('Povrv-772/2021-10');
});

test('gold scoring and parser fidelity share the same canonical date form', () => {
    // This is the real Troškovnik gold set: five printed dates, one of them a
    // duplicate of another. Distinct canonical days must be four, and the
    // awkward `22. travnja. 2022.g.` must be one of them.
    const goldDates = ['11. svibnja 2022.g.', '7. rujna 2022.g.', '22. travnja. 2022.g.', '26. siječnja 2026.g.', '2026.01.26'];
    const canonical = [...new Set(goldDates.map(canonicalDate).filter(Boolean))];
    expect(canonical).toEqual(['2022-05-11', '2022-09-07', '2022-04-22', '2026-01-26']);
});
