'use strict';

const { setMetrics, extractFilingNumbers } = require('./metrics');
const { canonicalAmount, canonicalCurrency, canonicalDate, canonicalOib } = require('./canonicalize');
const { summarizeGold, canonicalDecisionOutcome } = require('./gold-editor');
const unique = (values) => [...new Set(values)];

function flattenFacts(extraction) {
    return extraction?.parsed || extraction?.extraction || extraction || {};
}

function predictedAmounts(extraction) {
    const parsed = flattenFacts(extraction);
    return (Array.isArray(parsed.amounts) ? parsed.amounts : []).flatMap((fact) => {
        const values = [];
        if (fact.amount != null && fact.currency) values.push(canonicalAmount(fact.amount, fact.currency));
        if (fact.amountEur != null) values.push(canonicalAmount(fact.amountEur, 'EUR'));
        if (fact.amountHrk != null) values.push(canonicalAmount(fact.amountHrk, 'HRK'));
        return values.filter(Boolean);
    });
}

// An OIB is an 11-digit number, but it arrives as `66124057408`, `66124057408 `
// or with separators. Matching is by value only: gold records the legal party
// role (`Stečajni dužnik`), while extraction reports a flow side
// (`payer`/`recipient`), so comparing the roles would always score zero.
const oibKey = canonicalOib;

function predictedOibs(extraction) {
    const parsed = flattenFacts(extraction);
    const values = [];
    for (const fact of [...(parsed.amounts || []), ...(parsed.propertyFlow || [])]) {
        for (const side of ['payer', 'recipient', 'transferor', 'transferee']) {
            const value = fact?.[`${side}Oib`] || fact?.[`${side}OIB`];
            if (value) values.push(oibKey(value));
        }
    }
    for (const party of Array.isArray(parsed.documentParties) ? parsed.documentParties : []) {
        if (party?.oib) values.push(oibKey(party.oib));
    }
    for (const party of parsed.parties || []) {
        if (party?.oib) values.push(oibKey(party.oib));
    }
    return unique(values.filter((value) => value.length === 11));
}

function predictedDates(extraction) {
    const parsed = flattenFacts(extraction);
    const values = [parsed.decisionDate, ...(parsed.amounts || []).map((item) => item.date), ...(parsed.propertyFlow || []).map((item) => item.date), ...(parsed.proceduralEvents || []).map((item) => item.date)].filter(Boolean);
    return unique(values.map(canonicalDate).filter(Boolean));
}

function predictedFilingNumbers(extraction) {
    const parsed = flattenFacts(extraction);
    const values = [parsed.caseNumber, ...(parsed.citedFilingReferences || []), ...(parsed.amounts || []).map((item) => item.filingReference), ...(parsed.propertyFlow || []).map((item) => item.filingReference), ...(parsed.proceduralEvents || []).flatMap((item) => [item.filingReference, item.targetFilingReference])].filter(Boolean);
    return unique(values.flatMap((value) => extractFilingNumbers(String(value))));
}

function scoreGold(goldDocument, extraction) {
    const gold = goldDocument.facts || goldDocument.gold || goldDocument;
    if (!summarizeGold(goldDocument).complete) return { complete: false, reason: 'Review all gold categories against the source before scoring.' };
    const parsed = flattenFacts(extraction);
    const amountExpected = (gold.amounts || []).map((item) => canonicalAmount(item.rawValue ?? item.value, item.currency)).filter(Boolean);
    const oibExpected = unique((gold.oibs || []).map((item) => oibKey(typeof item === 'string' ? item : item.value ?? item.oib ?? '')).filter((value) => value.length === 11));
    const dateExpected = unique((gold.dates || []).map((item) => canonicalDate(typeof item === 'string' ? item : item.value || '')).filter(Boolean));
    const filingExpected = unique((gold.filingNumbers || []).flatMap((item) => extractFilingNumbers(String(typeof item === 'string' ? item : item.value || ''))));
    const outcomeExpected = gold.decisionOutcome ? [canonicalDecisionOutcome(gold.decisionOutcome)].filter(Boolean) : [];
    const hasTopLevelOutcomeKey = parsed
        && Object.prototype.hasOwnProperty.call(parsed, 'decisionOutcome')
        && parsed.decisionOutcome !== undefined;
    const outcomePredicted = hasTopLevelOutcomeKey
        ? (parsed.decisionOutcome ? [canonicalDecisionOutcome(parsed.decisionOutcome)].filter(Boolean) : [])
        : unique((parsed.proceduralEvents || []).map((item) => canonicalDecisionOutcome(item.outcome)).filter(Boolean));
    const expectedRows = (gold.tables || []).reduce((sum, table) => sum + Number(table.rowCount || 0), 0);
    const predictedRows = (parsed.amounts || []).filter((fact) => fact.amountRole === 'line_item').length;
    const tableRowCounts = expectedRows === 0 && predictedRows === 0
        ? { precision: 1, recall: 1, counts: { truePositive: 0, predicted: 0, reference: 0 } }
        : { precision: expectedRows ? Math.min(expectedRows, predictedRows) / Math.max(predictedRows, 1) : 0, recall: expectedRows ? Math.min(expectedRows, predictedRows) / expectedRows : predictedRows === 0 ? 1 : 0, counts: { truePositive: Math.min(expectedRows, predictedRows), predicted: predictedRows, reference: expectedRows } };
    return {
        complete: true,
        amounts: setMetrics(amountExpected, predictedAmounts(extraction)),
        oibs: setMetrics(oibExpected, predictedOibs(extraction)),
        dates: setMetrics(dateExpected, predictedDates(extraction)),
        filingNumbers: setMetrics(filingExpected, predictedFilingNumbers(extraction)),
        decisionOutcome: setMetrics(outcomeExpected, outcomePredicted),
        tableRowCounts,
    };
}

// `canonicalCurrency` / `canonicalAmount` / `canonicalDate` are re-exported for
// existing callers; the implementations live in `canonicalize.js`.
module.exports = {
    canonicalCurrency, canonicalAmount, canonicalDate,
    flattenFacts, predictedAmounts, predictedOibs, predictedDates, predictedFilingNumbers, scoreGold,
};
