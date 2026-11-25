// backend/court-analysis/reasoning/currencyConversion.js
//
// K-01 — deterministic HRK→EUR consolidation. Croatia's HRK→EUR conversion
// was a FIXED legal rate (1 EUR = 7.53450 HRK), not floating — so currency
// math is done here in code, never left to the model.
//
// Tie-break rule (K-04, decided up front): when a source states BOTH figures
// (e.g. "248,86 € (1.875,oo kn)"), the EUR-stated figure wins outright for
// all downstream math. A mismatch beyond tolerance is additionally surfaced
// as its own reconciliation question — never silently averaged.

const HRK_PER_EUR = 7.53450;

// Relative tolerance before a dual-stated figure counts as inconsistent with
// the fixed rate (rounding in filings is normal; real errors are not small).
const DUAL_MISMATCH_REL_TOL = 0.01;
// Absolute floor so tiny amounts (a few cents of rounding) never flag.
const DUAL_MISMATCH_ABS_TOL = 0.5;

function roundEur(value) {
    return Math.round(value * 100) / 100;
}

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function hrkToEur(hrk) {
    const num = toFiniteNumber(hrk);
    if (num === null) return null;
    return roundEur(num / HRK_PER_EUR);
}

/**
 * Consolidates any supported amount to EUR.
 * @param {number|null} amount
 * @param {string|null} currency - Normalized ('EUR' | 'HRK' | other | null).
 * @returns {number|null} EUR value, or null when it cannot be determined
 * (unknown currency, non-numeric amount). Never throws.
 */
function convertToEur(amount, currency) {
    const num = toFiniteNumber(amount);
    if (num === null) return null;
    if (currency === 'EUR') return num;
    if (currency === 'HRK') return hrkToEur(num);
    return null;
}

/**
 * Compares a source-stated EUR figure against the fixed-rate conversion of
 * the source-stated HRK figure from the same quote.
 * @returns {{convertedEur: number|null, deviationPct: number|null, mismatched: boolean}}
 */
function dualMismatch(statedEur, statedHrk) {
    const eur = toFiniteNumber(statedEur);
    const hrk = toFiniteNumber(statedHrk);
    if (eur === null || hrk === null) {
        return { convertedEur: null, deviationPct: null, mismatched: false };
    }
    const convertedEur = hrkToEur(hrk);
    if (convertedEur === null) return { convertedEur: null, deviationPct: null, mismatched: false };
    const absDiff = Math.abs(eur - convertedEur);
    const deviationPct = convertedEur !== 0 ? Number(((absDiff / Math.abs(convertedEur)) * 100).toFixed(2)) : null;
    const mismatched = absDiff > DUAL_MISMATCH_ABS_TOL
        && convertedEur !== 0
        && (absDiff / Math.abs(convertedEur)) > DUAL_MISMATCH_REL_TOL;
    return { convertedEur, deviationPct, mismatched };
}

module.exports = {
    HRK_PER_EUR,
    DUAL_MISMATCH_REL_TOL,
    DUAL_MISMATCH_ABS_TOL,
    hrkToEur,
    convertToEur,
    dualMismatch,
};
