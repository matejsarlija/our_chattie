// backend/court-analysis/reasoning/moneyFlow.js
//
// Track 3c — money-flow reconstruction. Analyses that contain financial
// figures produce a structured `amounts` array (extracted by the analysis
// agent). This module normalizes those raw amounts into a deterministic,
// source-cited money-flow surface so the report meta and the "Tijek novca"
// visualizer subgraph can render real payments/claims instead of relying on
// free-text prose alone.

const { convertToEur, dualMismatch } = require('./currencyConversion');

// J-01 — signed/directional amounts: potraživanje (asset/claim) vs obveza
// (liability), or an explicit ruling outcome (awarded/rejected/netted).
const DIRECTION_ALIASES = {
    'potrazivanje': 'potraživanje',
    'potraživanje': 'potraživanje',
    'obveza': 'obveza',
    'obaveza': 'obveza',
    'awarded': 'awarded',
    'dosudeno': 'awarded',
    'dosuđeno': 'awarded',
    'priznato': 'awarded',
    'usvojeno': 'awarded',
    'rejected': 'rejected',
    'odbijeno': 'rejected',
    'osporeno': 'rejected',
    'netted': 'netted',
    'prijeboj': 'netted',
    'prebijeno': 'netted',
    'kompenzirano': 'netted',
};

function normalizeDirection(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return null;
    const ascii = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    return DIRECTION_ALIASES[ascii] || DIRECTION_ALIASES[raw] || null;
}

// J-02 — Croatian OIBs are exactly 11 digits. Strip formatting, keep only
// valid shapes; malformed values degrade to null, never fail a run.
function normalizeOib(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
}

function cleanText(value) {
    const s = String(value || '').trim();
    return s || null;
}

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

// K-04 — dual-currency detection. The main amount/currency counts as one
// stated side (an EUR amount IS the stated EUR figure); structured
// amountEur/amountHrk fields override it when present. Otherwise the verbatim
// quote is scanned for the standard filing pattern "248,86 € (1.875,oo kn)"
// (either order; Croatian "oo"-for-zeros spelling included). Returns
// {statedEur, statedHrk} with nulls where unknown.
function parseDualFromQuote(raw, amount, currency) {
    const structuredEur = parseAmount(
        raw.amountEur ?? raw.valueEur ?? raw.eurAmount ?? raw.iznosEur
    );
    const structuredHrk = parseAmount(
        raw.amountHrk ?? raw.valueHrk ?? raw.hrkAmount ?? raw.iznosHrk
    );
    const mainEur = currency === 'EUR' ? amount : null;
    const mainHrk = currency === 'HRK' ? amount : null;
    const statedEur = structuredEur ?? mainEur;
    const statedHrk = structuredHrk ?? mainHrk;
    if (statedEur !== null && statedEur !== undefined
        && statedHrk !== null && statedHrk !== undefined) {
        return { statedEur, statedHrk };
    }

    const quote = typeof raw.quote === 'string' ? raw.quote : '';
    if (!quote) return { statedEur: null, statedHrk: null };

    const eurFirst = quote.match(/([\d.,]+)\s*€[^()]{0,40}\(\s*([^)]+?)\s*(kn|hrk|kuna|kune)\b/i);
    if (eurFirst) {
        return { statedEur: parseAmount(eurFirst[1]), statedHrk: parseAmount(eurFirst[2]) };
    }
    const hrkFirst = quote.match(/([\d.,oO\s]+?)\s*(kn|hrk|kuna|kune)\b[^()]{0,40}\(\s*([\d.,]+)\s*€/i);
    if (hrkFirst) {
        return { statedEur: parseAmount(hrkFirst[3]), statedHrk: parseAmount(hrkFirst[1]) };
    }
    return { statedEur: null, statedHrk: null };
}

function normalizeAmountItem(raw, index, analysis) {
    if (!raw || typeof raw !== 'object') return null;

    const amount = parseAmount(raw.amount ?? raw.value ?? raw.iznos ?? raw.iznosa);
    if (amount === null) return null;

    const currency = normalizeCurrency(raw.currency ?? raw.valuta) || null;

    // K-02/K-04 — consolidated EUR + source-stated dual preference. The model
    // may state both figures structurally (amountEur/amountHrk) or only inside
    // the verbatim quote ("248,86 € (1.875,oo kn)"); either way the EUR-stated
    // figure wins outright and rate deviations beyond tolerance are recorded,
    // never silently averaged.
    const dual = parseDualFromQuote(raw, amount, currency);
    let amountEur = null;
    let amountEurSource = null;
    let dualCurrency = null;
    let currencyNote = null;
    if (dual && dual.statedEur !== null && dual.statedHrk !== null) {
        const check = dualMismatch(dual.statedEur, dual.statedHrk);
        amountEur = dual.statedEur;
        amountEurSource = 'stated';
        dualCurrency = {
            statedEur: dual.statedEur,
            statedHrk: dual.statedHrk,
            convertedEur: check.convertedEur,
            deviationPct: check.deviationPct,
        };
        if (check.mismatched) currencyNote = 'dual-mismatch';
    } else {
        amountEur = convertToEur(amount, currency);
        if (amountEur !== null) {
            amountEurSource = currency === 'EUR' ? 'as-is' : 'converted';
        }
    }

    return {
        id: `money-${index + 1}`,
        amount,
        currency,
        amountEur,
        amountEurSource,
        ...(dualCurrency ? { dualCurrency } : {}),
        ...(currencyNote ? { currencyNote } : {}),
        description: raw.description || raw.text || raw.opis || raw.namjena || null,
        date: raw.date || raw.datum || null,
        // J-01 — signed/directional amount.
        direction: normalizeDirection(raw.direction ?? raw.smjer ?? raw.outcome ?? raw.ishod),
        // J-02 — payer/recipient identity. payerName/recipientName back-fill
        // the legacy from/to plumbing so the existing surface receives data.
        payerName: cleanText(raw.payerName ?? raw.payer ?? raw.platitelj),
        payerOib: normalizeOib(raw.payerOib ?? raw.payer_oib ?? raw.oibPlatitelja),
        recipientName: cleanText(raw.recipientName ?? raw.recipient ?? raw.primatelj),
        recipientOib: normalizeOib(raw.recipientOib ?? raw.recipient_oib ?? raw.oibPrimatelja),
        from: raw.from || raw.source || raw.platitelj || cleanText(raw.payerName ?? raw.payer) || null,
        to: raw.to || raw.target || raw.primatelj || cleanText(raw.recipientName ?? raw.recipient) || null,
        // J-03 — payment-priority rank (stečaj isplatni red).
        isplatniRed: cleanText(raw.isplatniRed ?? raw.isplatni_red ?? raw.paymentRank),
        // J-04 — real claim/filing identifiers (replace fuzzy matching in L).
        claimRegistryNumber: cleanText(raw.claimRegistryNumber ?? raw.redniBroj ?? raw.redni_broj),
        filingReference: cleanText(raw.filingReference ?? raw.poslovniBroj ?? raw.poslovni_broj),
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
    let eurTotal = 0;
    let hasEurTotal = false;
    for (const entry of entries) {
        const key = entry.currency || 'UNKNOWN';
        currencyTotals[key] = (currencyTotals[key] || 0) + entry.amount;
        if (Number.isFinite(entry.amountEur)) {
            eurTotal += entry.amountEur;
            hasEurTotal = true;
        }
    }
    eurTotal = Math.round(eurTotal * 100) / 100;

    return {
        count: entries.length,
        entries,
        currencyTotals,
        ...(hasEurTotal ? { eurTotal } : {}),
        hasMoneyFlow: entries.length > 0
    };
}

module.exports = {
    collectMoneyFlows,
    normalizeCurrency,
    parseAmount,
    parseDualFromQuote,
    normalizeDirection,
    normalizeOib,
    cleanText
};