'use strict';

/**
 * One canonical form per fact, shared by gold scoring and parser fidelity.
 *
 * Both lanes compare "what the source says" with "what the arm produced", and
 * a comparison is only as good as the normalizer under it. When the two lanes
 * kept their own copies, the same printed date scored in one table and
 * silently disappeared in the other: `22. travnja. 2022.g.` was a gold date
 * that `canonicalDate` could not read, so every arm was charged a false
 * negative *and* a false positive for correctly extracting 22.04.2022.
 *
 * Rules that bind this module:
 *  - pure, no I/O, no state;
 *  - never convert between currencies (scoring compares stated values);
 *  - an OIB is an 11-digit string, never a number (leading zeros survive);
 *  - register prefixes are identity (`4 St-2/2013` != `St-2/2013`).
 */

const unique = (values) => [...new Set(values)];

const CROATIAN_MONTHS = new Map([
    ['siječnja', 1], ['veljače', 2], ['ožujka', 3], ['travnja', 4], ['svibnja', 5], ['lipnja', 6],
    ['srpnja', 7], ['kolovoza', 8], ['rujna', 9], ['listopada', 10], ['studenoga', 11], ['prosinca', 12],
]);

// Typography that PDF extraction and model output disagree about. Collapsing
// these is about spelling only, never about meaning.
const DASH = /[\u2010-\u2015\u2212]/g;

function tidy(raw) {
    return String(raw ?? '')
        .replace(DASH, '-')
        .replace(/\u00ad/g, '')       // soft hyphen inserted at a line wrap
        .replace(/\u00a0/g, ' ')      // NBSP
        .trim();
}

/**
 * Strip accents for comparison. Not used to *store* anything: Croatian text is
 * compared on the raw form when possible and on this form when a parser has
 * already lost the diacritics.
 */
function foldCroatian(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, (letter) => (letter === 'Đ' ? 'D' : 'd'));
}

// --- dates -----------------------------------------------------------------

function dateKey(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * One ISO `YYYY-MM-DD` per printed date, or null.
 *
 * Accepts the shapes that actually appear in court filings:
 *   `27. listopada 2025.g.`  Croatian genitive month
 *   `08. lipnja 2026.`       leading zero, trailing dot
 *   `22. travnja. 2022.g.`   a stray dot after the month (gold had this)
 *   `8.6.2026.`              numeric, dots
 *   `17 -07- 2025`           numeric, spaced hyphens (gold had this)
 *   `2026.01.26` / `2026-01-26`  already ISO-ish
 *
 * The stray-dot form is why the month alternative carries its own `\\.?`: a
 * normalizer that rejects it turns a correct extraction into a false positive.
 */
function canonicalDate(raw) {
    const value = tidy(raw).toLowerCase();
    if (!value) return null;

    // Numeric day-first forms: `8.6.2026.`, `17 -07- 2025`.
    let match = /\b(\d{1,2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{4})\.?(?!\d)/u.exec(value);
    if (match) return dateKey(Number(match[3]), Number(match[2]), Number(match[1]));

    // ISO-ish: `2026-01-26`, `2026.01.26`.
    match = /\b(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})\b/u.exec(value);
    if (match) return dateKey(Number(match[1]), Number(match[2]), Number(match[3]));

    // Croatian month name, with or without the `g.` suffix and with or without
    // a dot between the month and the year.
    match = /\b(\d{1,2})\.?\s*(siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga|prosinca)\.?\s*(\d{4})\.?\s*(?:g\.?)?/u.exec(value);
    if (match) return dateKey(Number(match[3]), CROATIAN_MONTHS.get(match[2]), Number(match[1]));
    return null;
}

// --- amounts ---------------------------------------------------------------

/**
 * `EUR` / `HRK` only. The source may print `€`, `kn`, `kuna`; scoring compares
 * the stated currency and never converts between them.
 */
function canonicalCurrency(value) {
    const text = tidy(value).toUpperCase().replace(/\.$/, '');
    if (text === '€' || text === 'EUR' || text === 'EURO') return 'EUR';
    if (text === 'HRK' || text === 'KN' || text === 'KUNA') return 'HRK';
    return text;
}

/**
 * Parse a printed number to a fixed two-decimal string.
 *
 * Handles Croatian `1.234,56`, English `1,234.56`, and the OCR spelling
 * `1.875,oo` (letter o for zero) that shows up in scanned fee schedules.
 */
function parseAmountNumber(raw) {
    let token = String(raw ?? '').trim();
    if (!token) return null;
    // `oo` / `OO` for `00` appears where a scanner read zeros as letters.
    token = token.replace(/(?<=\d)[oO]{2}\b/g, '00').replace(/[^\d,.-]/g, '');
    if (!token || !/\d/.test(token)) return null;
    if (token.includes(',') && token.includes('.')) {
        token = token.lastIndexOf(',') > token.lastIndexOf('.')
            ? token.replace(/\./g, '').replace(',', '.')
            : token.replace(/,/g, '');
    } else if (token.includes(',')) {
        const decimals = token.length - token.lastIndexOf(',') - 1;
        token = decimals === 2 ? token.replace(/\./g, '').replace(',', '.') : token.replace(/,/g, '');
    } else if ((token.match(/\./g) || []).length > 1) {
        token = token.replace(/\./g, '');
    } else if (token.includes('.') && token.length - token.lastIndexOf('.') - 1 === 3) {
        token = token.replace('.', '');
    }
    const number = Number(token);
    return Number.isFinite(number) ? number.toFixed(2) : null;
}

/**
 * The comparison key for an amount: value plus the currency the source stated.
 *
 * A non-empty currency is required. An amount with no currency is not a
 * comparable fact, because "1.875,00" alone could be either side of the fixed
 * HRK/EUR rate.
 */
function canonicalAmount(rawValue, currency) {
    const number = parseAmountNumber(rawValue);
    if (number == null) return null;
    const unit = canonicalCurrency(currency);
    return unit ? `${number}|${unit}` : null;
}

// --- OIB -------------------------------------------------------------------

/**
 * An OIB is an 11-digit string. Parsing it as a number drops the leading zero
 * (real OIBs start with 0) and formatting it as money corrupts it further, so
 * this only ever strips non-digits.
 */
function canonicalOib(value) {
    return String(value ?? '').replace(/\D+/g, '');
}

// --- filing numbers --------------------------------------------------------

// Croatian `poslovni broj` registers. Explicit rather than "any word followed
// by digits" so ordinary prose is never mistaken for a filing number. Sorted
// longest-first so `Povrv` wins over `P` and `R1` over `R`.
const FILING_REGISTERS = [
    'Povrv', 'Povpr', 'Pžm', 'Pž', 'Pp', 'Pr', 'Ps', 'Pz', 'P', 'Stpn', 'Sts', 'Stv', 'St',
    'Gžm', 'Gž', 'Revr', 'Rev', 'Ovrv', 'Ovr', 'Kir', 'Kžm', 'Kž', 'K',
    'Sp', 'Su', 'Tt', 'Isp', 'Ik', 'Im', 'In', 'Ip', 'Is', 'Us', 'U', 'Žs', 'Ž', 'R1', 'R',
].sort((a, b) => b.length - a.length);

// A dash between the register and the number is typography, not identity, so
// it is optional: `St-2/2013`, `St – 2/2013` and `St2/2013` are one identity.
// Digits can also be split by extraction whitespace (`2 0 13`), so each digit
// run tolerates internal spaces; the canonical form closes them up again.
//
// Canonicalization works from the MATCH GROUPS rather than from surgery on the
// raw string: a global "join digits separated by spaces" rule would merge the
// register number of `R1 123/2020` into its sequence (`R-1123/2020`), which is
// a different case.
// A register whose own spelling ends in a digit (`R1`) must be followed by a
// separator, otherwise `R123/2020` would be read as register `R1` + sequence
// `23` instead of register `R` + sequence `123`.
const DIGIT_REGISTER_PATTERN = FILING_REGISTERS
    .filter((register) => /\d/.test(register))
    .map((register) => `${register}(?=\\s|[-\\u2010-\\u2015\\u2212])`)
    .join('|');
const REGISTER_PATTERN = [
    DIGIT_REGISTER_PATTERN,
    ...FILING_REGISTERS.filter((register) => !/\d/.test(register)),
].filter(Boolean).join('|');

const FILING_NUMBER_PATTERN = new RegExp(
    `\\b(?<registerNumber>\\d+\\s+)?(?<register>${REGISTER_PATTERN})\\s*[-\\u2010-\\u2015\\u2212]?\\s*(?<sequence>\\d(?:\\s*\\d)*)\\s*\\/\\s*(?<year>\\d(?:\\s*\\d)*)(?:\\s*[-\\u2010-\\u2015\\u2212\\/]\\s*(?<suffix>\\d(?:\\s*\\d)*))?\\b`,
    'giu',
);

const digitsOnly = (value) => String(value ?? '').replace(/\s+/g, '');
const properRegister = (value) => `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;

function canonicalFromMatch(match) {
    const { registerNumber, register, sequence, year, suffix } = match.groups;
    const leading = registerNumber ? `${registerNumber.trim()} ` : '';
    const tail = suffix ? `-${digitsOnly(suffix)}` : '';
    return `${leading}${properRegister(register)}-${digitsOnly(sequence)}/${digitsOnly(year)}${tail}`;
}

/**
 * One spelling per filing number. The leading register number (`4 St-2/2013`)
 * is a distinct identity and is preserved; only separators, casing, dashes and
 * whitespace are normalized.
 *
 * A string that carries no recognizable filing number is returned in its
 * tidied form rather than rejected: this is a normalizer, and validation
 * belongs to `extractFilingNumbers`.
 */
function canonicalFilingNumber(value) {
    const text = tidy(value);
    if (!text) return '';
    const match = [...text.matchAll(FILING_NUMBER_PATTERN)][0];
    if (match) return canonicalFromMatch(match);
    return text
        .replace(/\s*\/\s*/g, '/')
        .replace(/\s*[-\u2010-\u2015\u2212]\s*/g, '-')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractFilingNumbers(text) {
    const matches = [...String(text || '').matchAll(FILING_NUMBER_PATTERN)];
    return unique(matches.map(canonicalFromMatch).filter(Boolean));
}

module.exports = {
    CROATIAN_MONTHS,
    FILING_REGISTERS,
    FILING_NUMBER_PATTERN,
    foldCroatian,
    tidy,
    canonicalDate,
    canonicalCurrency,
    parseAmountNumber,
    canonicalAmount,
    canonicalOib,
    canonicalFilingNumber,
    extractFilingNumbers,
};
