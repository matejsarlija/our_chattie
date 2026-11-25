'use strict';

const path = require('path');

const { canonicalCurrency } = require('./canonicalize');
const { PROCEDURAL_OUTCOMES } = require('../../court-analysis/reasoning/schema/extractionSchema');

// Currency spellings the gold editor accepts. Everything is stored canonically
// as EUR or HRK so scoreGold compares like with like. The alias table itself
// lives in `canonicalize.js`; this is only the set the editor will *accept*, so
// an unknown spelling is a validation error rather than a silent new currency.
const ACCEPTED_CURRENCIES = new Set(['EUR', 'HRK']);
const OIB_PATTERN = /^\d{11}$/;
const SET_ID_PATTERN = /^[0-9TZ-]+-[a-f0-9]{8}$/;
const GOLD_FILE_PATTERN = /^[a-f0-9]{16}\.json$/;
const GOLD_CATEGORIES = ['amounts', 'oibs', 'dates', 'filingNumbers', 'decisionOutcome', 'tables'];
const GOLD_OUTCOMES = PROCEDURAL_OUTCOMES;
const OUTCOME_ALIASES = new Map([
    ['usvaja se', 'granted'],
    ['prihvaća se', 'granted'],
    ['udovoljava se', 'granted'],
    ['odbacuje se', 'dismissed'],
    ['odbija se', 'rejected'],
    ['potvrđuje se', 'upheld'],
    ['ukida se', 'overturned'],
    ['preinačuje se', 'modified'],
    ['vraća se na ponovni postupak', 'remanded'],
]);

const text = (value) => String(value ?? '').trim();

// Comparison only: keep the human's source wording in saved gold. Match exact
// labels, not substrings in a ruling that may contain several different orders.
function canonicalDecisionOutcome(value) {
    const label = text(value).toLowerCase().replace(/\s+/g, ' ').replace(/[.!;:]+$/u, '').trim();
    return OUTCOME_ALIASES.get(label) || label;
}

/**
 * Normalize a human-edited fact ledger into the stored schema.
 * Blank rows are dropped silently; half-filled rows are reported as errors so
 * a template can never look "complete" while carrying unusable entries.
 */
function normalizeGoldFacts(input) {
    const source = input && typeof input === 'object' ? input : {};
    const errors = [];

    const amounts = [];
    (Array.isArray(source.amounts) ? source.amounts : []).forEach((item, index) => {
        const rawValue = text(item?.rawValue ?? item?.value);
        const currency = text(item?.currency).toUpperCase();
        // The currency select always has a value, so an untouched row must be
        // treated as blank rather than as a half-filled entry.
        if (!rawValue) return;
        if (!/\d/.test(rawValue)) { errors.push(`Amount ${index + 1}: the value needs at least one digit.`); return; }
        const canonical = canonicalCurrency(currency);
        if (!ACCEPTED_CURRENCIES.has(canonical)) { errors.push(`Amount ${index + 1}: currency must be EUR or HRK.`); return; }
        amounts.push({ rawValue, currency: canonical });
    });

    const oibs = [];
    (Array.isArray(source.oibs) ? source.oibs : []).forEach((item, index) => {
        const value = text(item?.value ?? item?.oib).replace(/\s+/g, '');
        const role = text(item?.role);
        if (!value && !role) return;
        if (!OIB_PATTERN.test(value)) { errors.push(`OIB ${index + 1}: needs exactly 11 digits.`); return; }
        oibs.push(role ? { value, role } : { value });
    });

    const dates = (Array.isArray(source.dates) ? source.dates : [])
        .map((item) => text(typeof item === 'string' ? item : item?.value))
        .filter(Boolean);

    const filingNumbers = (Array.isArray(source.filingNumbers) ? source.filingNumbers : [])
        .map((item) => text(typeof item === 'string' ? item : item?.value))
        .filter(Boolean);

    const tables = [];
    (Array.isArray(source.tables) ? source.tables : []).forEach((item, index) => {
        const description = text(item?.description);
        const rawCount = text(item?.rowCount);
        if (!description && !rawCount) return;
        if (!description) { errors.push(`Table ${index + 1}: describe which table this is.`); return; }
        if (!rawCount) { errors.push(`Table ${index + 1}: row count is required.`); return; }
        const rowCount = Number(rawCount);
        if (!Number.isInteger(rowCount) || rowCount < 0) { errors.push(`Table ${index + 1}: row count must be a whole number.`); return; }
        tables.push({ description, rowCount });
    });

    return {
        facts: {
            amounts,
            oibs,
            dates,
            filingNumbers,
            decisionOutcome: text(source.decisionOutcome),
            tables,
        },
        errors,
    };
}

function normalizeReviewedCategories(input) {
    const accepted = new Set(Array.isArray(input) ? input : []);
    return GOLD_CATEGORIES.filter((category) => accepted.has(category));
}

function summarizeGold(template) {
    const facts = template?.facts || {};
    const tables = Array.isArray(facts.tables) ? facts.tables : [];
    const reviewedCategories = normalizeReviewedCategories(template?.reviewedCategories);
    const missingReviews = GOLD_CATEGORIES.filter((category) => !reviewedCategories.includes(category));
    return {
        complete: template?.factsComplete === true && missingReviews.length === 0,
        reviewedCategories,
        reviewedCount: reviewedCategories.length,
        missingReviews,
        amounts: (facts.amounts || []).length,
        oibs: (facts.oibs || []).length,
        dates: (facts.dates || []).length,
        filingNumbers: (facts.filingNumbers || []).length,
        tables: tables.length,
        tableRows: tables.reduce((sum, table) => sum + Number(table.rowCount || 0), 0),
        decisionOutcome: Boolean(text(facts.decisionOutcome)),
    };
}

function factCount(summary) {
    return summary.amounts + summary.oibs + summary.dates + summary.filingNumbers + summary.tables
        + (summary.decisionOutcome ? 1 : 0);
}

/**
 * Resolve a gold template path, refusing anything outside
 * <dataRoot>/<setId>/gold. The editor only ever writes there.
 */
function resolveGoldTarget(dataRoot, setId, file) {
    if (!SET_ID_PATTERN.test(String(setId || ''))) throw new Error('Unknown gold set.');
    if (!GOLD_FILE_PATTERN.test(String(file || ''))) throw new Error('Unknown gold template file.');
    const root = path.resolve(dataRoot);
    const dir = path.resolve(root, setId, 'gold');
    if (!dir.startsWith(`${root}${path.sep}`)) throw new Error('Gold set is outside the benchmark data folder.');
    const filePath = path.resolve(dir, file);
    if (!filePath.startsWith(`${dir}${path.sep}`)) throw new Error('Gold template is outside its set folder.');
    return { dir, filePath };
}

module.exports = {
    normalizeGoldFacts,
    normalizeReviewedCategories,
    summarizeGold,
    factCount,
    resolveGoldTarget,
    ACCEPTED_CURRENCIES,
    GOLD_CATEGORIES,
    GOLD_OUTCOMES,
    canonicalDecisionOutcome,
};
