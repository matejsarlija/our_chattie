// backend/court-analysis/reasoning/moneyFlow.js
//
// Track 3c — money-flow reconstruction. Analyses that contain financial
// figures produce a structured `amounts` array (extracted by the analysis
// agent). This module normalizes those raw amounts into a deterministic,
// source-cited money-flow surface so the report meta and the "Tijek novca"
// visualizer subgraph can render real payments/claims instead of relying on
// free-text prose alone.

const KNOWN_CURRENCIES = {
    'EUR': 'EUR',
    'EURO': 'EUR',
    '€': 'EUR',
    'HRK': 'HRK',
    'KN': 'HRK',
    'KUNE': 'HRK',
    'KUNA': 'HRK',
};

function normalizeCurrency(value) {
    const code = String(value || '').trim().toUpperCase();
    return KNOWN_CURRENCIES[code] || (code || null);
}

// Accepts both Croatian ("1.200.000,00" / "63,38") and international
// ("1,200,000.00" / "63.38") number formats, plus plain numbers.
function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    let s = String(value || '').trim();
    if (!s) return null;

    let normalized;
    if (s.includes(',') && s.includes('.')) {
        const lastComma = s.lastIndexOf(',');
        const lastDot = s.lastIndexOf('.');
        normalized = lastComma > lastDot
            ? s.replace(/\./g, '').replace(',', '.')
            : s.replace(/,/g, '');
    } else if (s.includes(',')) {
        normalized = s.replace(/\./g, '').replace(',', '.');
    } else if (s.includes('.')) {
        const dotCount = (s.match(/\./g) || []).length;
        normalized = dotCount > 1 ? s.replace(/\./g, '') : s;
    } else {
        normalized = s;
    }

    const stripped = normalized.replace(/[^\d.-]/g, '');
    if (!/\d/.test(stripped)) return null;
    const num = Number(stripped);
    return Number.isFinite(num) ? num : null;
}

function normalizeAmountItem(raw, index, analysis) {
    if (!raw || typeof raw !== 'object') return null;

    const amount = parseAmount(raw.amount ?? raw.value ?? raw.iznos ?? raw.iznosa);
    if (amount === null) return null;

    return {
        id: `money-${index + 1}`,
        amount,
        currency: normalizeCurrency(raw.currency ?? raw.valuta) || null,
        description: raw.description || raw.text || raw.opis || raw.namjena || null,
        date: raw.date || raw.datum || null,
        from: raw.from || raw.source || raw.platitelj || null,
        to: raw.to || raw.target || raw.primatelj || null,
        quote: typeof raw.quote === 'string' ? raw.quote : null,
        grounded: raw.grounded === true,
        sourceId: analysis?.id || null,
        fileName: analysis?.fileName || null,
        caseNumber: analysis?.caseNumber || null
    };
}

/**
 * Aggregates structured money movements across all successful analyses.
 * @param {Array<object>} analyses - Analysis items (as attached by
 *  attachAnalysesToEvidencePackage, carrying an `amounts` array).
 * @returns {{count: number, entries: Array<object>, currencyTotals: object, hasMoneyFlow: boolean}}
 */
function collectMoneyFlows(analyses) {
    const entries = [];
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        const rawAmounts = analysis?.amounts;
        if (!Array.isArray(rawAmounts)) continue;
        for (const raw of rawAmounts) {
            const entry = normalizeAmountItem(raw, entries.length, analysis);
            if (entry) entries.push(entry);
        }
    }

    const currencyTotals = {};
    for (const entry of entries) {
        const key = entry.currency || 'UNKNOWN';
        currencyTotals[key] = (currencyTotals[key] || 0) + entry.amount;
    }

    return {
        count: entries.length,
        entries,
        currencyTotals,
        hasMoneyFlow: entries.length > 0
    };
}

module.exports = {
    collectMoneyFlows,
    normalizeCurrency,
    parseAmount
};