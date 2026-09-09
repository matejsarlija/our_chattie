// backend/court-analysis/reasoning/flow.js
//
// Unified `Flow` entity (flow-consolidation PR1): money-flow amounts and
// property-flow assets are the same domain concept — a monetary fact and a
// transferable asset share figure, parties, registry identity, currency and
// date axes. The only discriminant is `assetType` ('novac' for plain money
// amounts, the property asset types otherwise), not two parallel models.
//
// This module owns the ONE normalize + collect implementation. The Gemini
// extraction prompt still produces two arrays (`amounts`, `propertyFlow`);
// `collectFlows` maps both into one array. Nothing calls it yet in PR1 —
// `moneyFlow.js`/`propertyFlow.js` keep serving today's paths untouched.

const { convertToEur, dualMismatch } = require('./currencyConversion');

// J-01 — signed/directional amounts: potraživanje (asset/claim) vs obveza
// (liability), or an explicit ruling outcome (awarded/rejected/netted).
// (Moved verbatim from moneyFlow.js — this is now the single home.)
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
// (Moved verbatim from moneyFlow.js.)
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
// (Moved verbatim from moneyFlow.js.)
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
// (Moved verbatim from moneyFlow.js.)
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

const VALID_ASSET_TYPES = ['novac', 'nekretnina', 'pokretnina', 'tražbina', 'drugo'];
const VALID_EVENT_TYPES = ['prijava', 'ustup', 'namirenje', 'drugo'];

// Asset-type inference: the `amounts[]` mapping path passes
// `assetTypeHint: 'novac'` (a plain money fact has no asset of its own);
// the `propertyFlow[]` path passes no hint and the raw `assetType` is
// normalized with the same coarse best-effort rules propertyFlow.js always
// used. Unknown/empty → 'drugo'. 'novac' is never inferred — only hinted.
function inferAssetType(raw, assetTypeHint) {
    if (assetTypeHint === 'novac') return 'novac';
    const value = assetTypeHint ?? raw?.assetType ?? raw?.asset_type ?? raw?.vrsta;
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return 'drugo';
    const ascii = normalized.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (['nekretnina', 'pokretnina', 'trazbina', 'tražbina', 'drugo'].includes(normalized)
        || ['nekretnina', 'pokretnina', 'trazbina', 'drugo'].includes(ascii)) {
        return normalized === 'trazbina' ? 'tražbina' : normalized;
    }
    return 'drugo';
}

function normalizeEventType(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_EVENT_TYPES.includes(raw) ? raw : null;
}

// K-02/K-04 — consolidated EUR + source-stated dual preference, shared by
// both families (money's amountEur block and property's buildValueEur were
// the same computation; this is now the only copy). Always returns explicit
// `valueEur`/`valueEurSource` keys (null when indeterminable); the derived
// views decide which keys their legacy shape exposes.
function buildFlowValueEur(raw, value, currency) {
    const dual = parseDualFromQuote(raw, value, currency);
    if (dual && dual.statedEur !== null && dual.statedHrk !== null) {
        const check = dualMismatch(dual.statedEur, dual.statedHrk);
        return {
            valueEur: dual.statedEur,
            valueEurSource: 'stated',
            dualCurrency: {
                statedEur: dual.statedEur,
                statedHrk: dual.statedHrk,
                convertedEur: check.convertedEur,
                deviationPct: check.deviationPct,
            },
            ...(check.mismatched ? { currencyNote: 'dual-mismatch' } : {}),
        };
    }
    const valueEur = convertToEur(value, currency);
    if (valueEur === null) return { valueEur: null, valueEurSource: null };
    return { valueEur, valueEurSource: currency === 'EUR' ? 'as-is' : 'converted' };
}

/**
 * The one flow normalizer. `assetTypeHint: 'novac'` selects the `amounts[]`
 * path (money semantics: unparseable figure drops the entry, description may
 * be null); no hint selects the `propertyFlow[]` path (property semantics:
 * description is required, figure is optional).
 *
 * Legacy alias fields (`payerName`/`recipientName`/`from`/`to`) are computed
 * with money's exact historical expressions so the derived money view maps
 * back byte-identically; they are non-canonical and invisible to the
 * property view. `direction` is populated only for `novac`/`tražbina` (never
 * backfilled from `eventType`); lifecycle fields only for `tražbina`.
 *
 * @param {object} raw - Raw extracted item (either family's field names).
 * @param {number} index - Position in the unified sequence (id `flow-{n}`).
 * @param {object} analysis - Normalized analysis record (entryDate fallback, provenance).
 * @param {object} [options] - `{ assetTypeHint }`.
 * @returns {object|null} Normalized flow entry, or null when dropped.
 */
function normalizeFlowItem(raw, index, analysis, options = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const assetTypeHint = options.assetTypeHint ?? null;
    const isNovacPath = assetTypeHint === 'novac';

    // Figure precedence preserves each family's historical rule so the
    // derived views map back exactly (money preferred `amount`, property
    // prefers `value` when both are present).
    const value = isNovacPath
        ? parseAmount(raw.amount ?? raw.value ?? raw.iznos ?? raw.iznosa)
        : (raw.value !== undefined && raw.value !== null) || (raw.amount !== undefined && raw.amount !== null)
            ? parseAmount(raw.value ?? raw.amount ?? raw.iznos)
            : null;
    // Money path: no parseable figure → drop (Track 3c rule).
    if (isNovacPath && value === null) return null;

    const description = isNovacPath
        ? (raw.description || raw.text || raw.opis || raw.namjena || null)
        : (raw.description || raw.text || raw.opis || null);
    // Property path: description alone anchors the entry — without it, drop.
    if (!isNovacPath && (!description || typeof description !== 'string' || !description.trim())) return null;

    const assetType = inferAssetType(raw, assetTypeHint);
    const eventType = assetType === 'tražbina' ? (normalizeEventType(raw.eventType ?? raw.event_type) || null) : null;
    const supersedes = assetType === 'tražbina' && raw.supersedes !== undefined && raw.supersedes !== null
        ? String(raw.supersedes).trim() || null
        : null;

    const currency = normalizeCurrency(raw.currency ?? raw.valuta) || null;
    const eur = (Number.isFinite(value) || isNovacPath) && value !== null
        ? buildFlowValueEur(raw, value, currency)
        : { valueEur: null, valueEurSource: null };

    return {
        id: `flow-${index + 1}`,
        assetType,
        description: description === null || description === undefined ? null : String(description).trim() || null,
        // Cadastral/registration anchor; money raws virtually never carry
        // it — stays null for 'novac' unless explicitly present.
        identifier: raw.identifier ?? null,
        value,
        currency,
        valueEur: eur.valueEur ?? null,
        valueEurSource: eur.valueEurSource ?? null,
        ...(eur.dualCurrency ? { dualCurrency: eur.dualCurrency } : {}),
        ...(eur.currencyNote ? { currencyNote: eur.currencyNote } : {}),
        // Canonical parties: union of both families' aliases. Precedence
        // keeps each family's own field first so historical mappings round-trip.
        transferor: cleanText(raw.transferor ?? raw.from ?? raw.payerName ?? raw.payer ?? raw.platitelj ?? raw.source ?? raw.ustupitelj),
        transferee: cleanText(raw.transferee ?? raw.to ?? raw.recipientName ?? raw.recipient ?? raw.primatelj ?? raw.target ?? raw.stjecatelj),
        transferorOib: normalizeOib(raw.transferorOib ?? raw.payerOib ?? raw.payer_oib ?? raw.oibPlatitelja),
        transfereeOib: normalizeOib(raw.transfereeOib ?? raw.recipientOib ?? raw.recipient_oib ?? raw.oibPrimatelja),
        // J-01 — claim/liability status. Only meaningful for novac/tra traces;
        // property never extracted it, so anything else stays null rather
        // than guessed.
        direction: (assetType === 'novac' || assetType === 'tražbina')
            ? normalizeDirection(raw.direction ?? raw.smjer ?? raw.outcome ?? raw.ishod)
            : null,
        // tražbina-lifecycle only; null otherwise.
        eventType,
        ...(supersedes ? { supersedes } : {}),
        // J-03/J-04 — stečaj registry identity, verbatim in both families.
        isplatniRed: cleanText(raw.isplatniRed ?? raw.isplatni_red ?? raw.paymentRank),
        claimRegistryNumber: cleanText(raw.claimRegistryNumber ?? raw.redniBroj ?? raw.redni_broj),
        filingReference: cleanText(raw.filingReference ?? raw.poslovniBroj ?? raw.poslovni_broj),
        // Fallback-only date contract (unchanged): extracted → entryDate.
        date: raw.date || raw.datum || analysis?.entryDate || null,
        quote: typeof raw.quote === 'string' ? raw.quote : null,
        grounded: raw.grounded === true,
        sourceId: analysis?.id || null,
        fileName: analysis?.fileName || null,
        caseNumber: analysis?.caseNumber || null,
        sourceEntryIndex: analysis?.sourceEntryIndex ?? null,
        sourceDocumentLinkId: analysis?.sourceDocumentLinkId ?? null,
        // Non-canonical money aliases (migration release only): money's exact
        // historical expressions, so deriveMoneyFlowView maps back
        // byte-identically. Invisible to the property view.
        payerName: cleanText(raw.payerName ?? raw.payer ?? raw.platitelj),
        payerOib: normalizeOib(raw.payerOib ?? raw.payer_oib ?? raw.oibPlatitelja),
        recipientName: cleanText(raw.recipientName ?? raw.recipient ?? raw.primatelj),
        recipientOib: normalizeOib(raw.recipientOib ?? raw.recipient_oib ?? raw.oibPrimatelja),
        from: raw.from || raw.source || raw.platitelj || cleanText(raw.payerName ?? raw.payer) || null,
        to: raw.to || raw.target || raw.primatelj || cleanText(raw.recipientName ?? raw.recipient) || null,
    };
}

// Legacy `prop-N` supersedes references name the old per-family id sequence.
// The unified sequence renumbers everything to `flow-N`, so exact `prop-N`
// references are rewritten to the corresponding unified id at collect time
// (ordinal among property-sourced entries). Descriptive-text references pass
// through untouched for resolveSupersedesTarget's other strategies.
function rewriteLegacySupersedes(entries) {
    const propIds = entries.filter((e) => e.__propertyOrdinal !== undefined);
    const byOrdinal = new Map(propIds.map((e) => [e.__propertyOrdinal, e.id]));
    for (const entry of entries) {
        if (typeof entry.supersedes !== 'string') continue;
        const match = entry.supersedes.trim().match(/^prop-(\d+)$/i);
        if (!match) continue;
        const target = byOrdinal.get(Number.parseInt(match[1], 10));
        if (target) entry.supersedes = target;
    }
    for (const entry of entries) delete entry.__propertyOrdinal;
    return entries;
}

/**
 * Collects both extraction arrays into one flow array through a single id
 * sequence: per analysis, `amounts[]` (hinted `novac`) first, then
 * `propertyFlow[]` (assetType inferred) — so each family's subsequence
 * preserves its historical relative order.
 * @param {Array<object>} analyses - Normalized analyses (amounts + propertyFlow).
 * @returns {{count: number, entries: Array<object>, currencyTotals: object, eurTotal?: number, hasFlows: boolean}}
 */
function collectFlows(analyses) {
    const entries = [];
    let propertyOrdinal = 0;
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        const rawAmounts = analysis?.amounts;
        if (Array.isArray(rawAmounts)) {
            for (const raw of rawAmounts) {
                const entry = normalizeFlowItem(raw, entries.length, analysis, { assetTypeHint: 'novac' });
                if (entry) entries.push(entry);
            }
        }
        const rawList = analysis?.propertyFlow;
        if (Array.isArray(rawList)) {
            for (const raw of rawList) {
                const entry = normalizeFlowItem(raw, entries.length, analysis);
                if (!entry) continue;
                propertyOrdinal += 1;
                entry.__propertyOrdinal = propertyOrdinal;
                entries.push(entry);
            }
        }
    }
    rewriteLegacySupersedes(entries);

    const currencyTotals = {};
    let eurTotal = 0;
    let hasEurTotal = false;
    for (const entry of entries) {
        const key = entry.currency || 'UNKNOWN';
        if (Number.isFinite(entry.value)) currencyTotals[key] = (currencyTotals[key] || 0) + entry.value;
        if (Number.isFinite(entry.valueEur)) {
            eurTotal += entry.valueEur;
            hasEurTotal = true;
        }
    }
    eurTotal = Math.round(eurTotal * 100) / 100;

    return {
        count: entries.length,
        entries,
        currencyTotals,
        ...(hasEurTotal ? { eurTotal } : {}),
        hasFlows: entries.length > 0
    };
}

/**
 * Backward-compatible derived views (flow-consolidation PR2): `pkg.moneyFlow`
 * / `pkg.propertyFlow` keep their exact current shapes so synthesizer,
 * frontend and persisted-run readers need zero changes. Each view filters
 * the unified array by `assetType` and renumbers its own id sequence in
 * historical order (which collectFlows preserves per family), renaming
 * fields back to the legacy vocabulary. Unified-only fields
 * (`transferor`/`transferee` canonicals, OIB unions, `direction` on property
 * entries) stay invisible to the views.
 */

/**
 * Money view: `novac` entries only, `value`→`amount` (+EUR fields), legacy
 * alias fields exposed, lifecycle fields omitted — byte-identical to the old
 * `collectMoneyFlows` output for the same input.
 */
function deriveMoneyFlowView(flows) {
    const entries = [];
    for (const flow of Array.isArray(flows?.entries) ? flows.entries : []) {
        if (flow?.assetType !== 'novac') continue;
        entries.push({
            id: `money-${entries.length + 1}`,
            amount: flow.value ?? null,
            currency: flow.currency ?? null,
            amountEur: flow.valueEur ?? null,
            amountEurSource: flow.valueEurSource ?? null,
            ...(flow.dualCurrency ? { dualCurrency: flow.dualCurrency } : {}),
            ...(flow.currencyNote ? { currencyNote: flow.currencyNote } : {}),
            description: flow.description ?? null,
            date: flow.date ?? null,
            direction: flow.direction ?? null,
            payerName: flow.payerName ?? null,
            payerOib: flow.payerOib ?? null,
            recipientName: flow.recipientName ?? null,
            recipientOib: flow.recipientOib ?? null,
            from: flow.from ?? null,
            to: flow.to ?? null,
            isplatniRed: flow.isplatniRed ?? null,
            claimRegistryNumber: flow.claimRegistryNumber ?? null,
            filingReference: flow.filingReference ?? null,
            quote: flow.quote ?? null,
            grounded: flow.grounded === true,
            sourceId: flow.sourceId ?? null,
            fileName: flow.fileName ?? null,
            caseNumber: flow.caseNumber ?? null,
            sourceEntryIndex: flow.sourceEntryIndex ?? null,
            sourceDocumentLinkId: flow.sourceDocumentLinkId ?? null,
        });
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

/**
 * Maps unified `flow-N` ids back to the legacy property-view `prop-N` ids
 * (renumbered in historical order). Migration shim: the legacy
 * `propertyReconciliation.valueChanges` surface keeps referencing the ids
 * its long-standing consumers (and persisted runs) know, while the unified
 * engine reasons in `flow-N` ids internally.
 */
function propertyIdByFlowId(flows) {
    const unified = (Array.isArray(flows?.entries) ? flows.entries : []).filter((flow) => flow && flow.assetType !== 'novac');
    return new Map(unified.map((flow, index) => [flow.id, `prop-${index + 1}`]));
}

/**
 * Property view: every non-`novac` entry, legacy vocabulary
 * (`value`/`valueEur`, `transferor`/`transferee`, conditional `eventType` /
 * `supersedes` / EUR keys exactly as the old spread behaved) — byte-identical
 * to the old `collectPropertyFlows` output for the same input. Legacy
 * `prop-N` supersedes references round-trip: the unified collector rewrites
 * them to `flow-N`, and this view maps exact `flow-N` references back to the
 * renumbered `prop-N` ids (descriptive-text references pass through).
 */
function derivePropertyFlowView(flows) {
    const propIdByFlowId = propertyIdByFlowId(flows);
    const unified = (Array.isArray(flows?.entries) ? flows.entries : []).filter((flow) => flow && flow.assetType !== 'novac');
    const entries = unified.map((flow, index) => ({
        id: `prop-${index + 1}`,
        description: flow.description,
        identifier: flow.identifier ?? null,
        assetType: flow.assetType,
        ...(flow.eventType ? { eventType: flow.eventType } : {}),
        transferor: flow.transferor ?? null,
        transferee: flow.transferee ?? null,
        value: flow.value ?? null,
        currency: flow.currency ?? null,
        ...(Number.isFinite(flow.valueEur)
            ? { valueEur: flow.valueEur, valueEurSource: flow.valueEurSource ?? null }
            : {}),
        ...(flow.dualCurrency ? { dualCurrency: flow.dualCurrency } : {}),
        ...(flow.currencyNote ? { currencyNote: flow.currencyNote } : {}),
        isplatniRed: flow.isplatniRed ?? null,
        claimRegistryNumber: flow.claimRegistryNumber ?? null,
        filingReference: flow.filingReference ?? null,
        date: flow.date ?? null,
        ...(flow.supersedes ? { supersedes: propIdByFlowId.get(flow.supersedes) ?? flow.supersedes } : {}),
        quote: flow.quote ?? null,
        grounded: flow.grounded === true,
        sourceId: flow.sourceId ?? null,
        fileName: flow.fileName ?? null,
        caseNumber: flow.caseNumber ?? null,
        sourceEntryIndex: flow.sourceEntryIndex ?? null,
        sourceDocumentLinkId: flow.sourceDocumentLinkId ?? null,
    }));
    return { count: entries.length, entries, hasPropertyFlow: entries.length > 0 };
}

module.exports = {
    collectFlows,
    normalizeFlowItem,
    inferAssetType,
    deriveMoneyFlowView,
    derivePropertyFlowView,
    propertyIdByFlowId,
    normalizeCurrency,
    parseAmount,
    parseDualFromQuote,
    normalizeDirection,
    normalizeOib,
    cleanText,
    VALID_ASSET_TYPES,
    VALID_EVENT_TYPES,
};
