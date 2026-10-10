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
// `collectFlows` maps both into one array. Legacy money/property modules
// expose derived views over that collector.

const { convertToEur, dualMismatch } = require('./currencyConversion');
const { normalizeText } = require('./indexer');
const { normalizePaymentRank } = require('./paymentRank');
const { parseDate } = require('./timelineBuilder');
const { normalizeClaimRegistryNumber } = require('./claimRegistry');

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

// TL-2 — ledger role accessors. Strict enums with null fallback (never
// guessed): a present-but-invalid role is dropped to null here; the
// extraction-schema gap record (T1-3) is where its invalidity is kept.
const VALID_AMOUNT_ROLES = ['total', 'line_item', 'principal', 'cost', 'paid', 'fee'];
const VALID_LEGAL_EFFECTS = ['creates', 'modifies', 'supersedes', 'resolves', 'implements', 'unknown'];
const VALID_RELATIONSHIP_BASES = ['explicit_identifier', 'explicit_text', 'inferred'];

function normalizeAmountRole(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_AMOUNT_ROLES.includes(raw) ? raw : null;
}
const VALUE_ROLES = ['claim_balance', 'transfer_consideration', 'payment_amount', 'asset_value', 'unknown'];

function normalizeValueRole(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALUE_ROLES.includes(raw) ? raw : null;
}

function normalizeLegalEffect(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_LEGAL_EFFECTS.includes(raw) ? raw : null;
}

function normalizeRelationshipBasis(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_RELATIONSHIP_BASES.includes(raw) ? raw : null;
}

function normalizeReferences(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '').trim()).filter(Boolean);
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
        // TL-2 — ledger roles carried end to end (reconciliation matches on
        // them; derived views keep their legacy key sets and stay blind).
        // `amountRole` is meaningful on the amounts path; other families keep
        // the raw value when present so future matchers can use it.
        amountRole: normalizeAmountRole(raw.amountRole ?? raw.amount_role),
        valueRole: normalizeValueRole(raw.valueRole ?? raw.value_role),
        crossCategoryFactId: cleanText(raw.crossCategoryFactId),
        legalEffect: normalizeLegalEffect(raw.legalEffect ?? raw.legal_effect),
        references: normalizeReferences(raw.references),
        relationshipBasis: normalizeRelationshipBasis(raw.relationshipBasis ?? raw.relationship_basis),
        // TL-1 — stable document identity for byte-level dedupe. Entries
        // without a hash never merge (identity unprovable).
        contentHash: typeof analysis?.contentHash === 'string' && analysis.contentHash
            ? analysis.contentHash
            : null,
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
        // Ledger rows can represent a byte-identical attachment referenced by
        // several filings. Preserve that complete provenance through the
        // unified flow rather than reducing it to the first analysis record.
        filings: Array.isArray(raw.filings) ? raw.filings.map((filing) => ({ ...filing })) : null,
        sources: Array.isArray(raw.sources) ? [...raw.sources] : null,
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

// Entry-level extraction dedupe. Byte-identical documents may merge across
// filings; when bytes are unavailable, merging is limited to rows from the
// same identified source document. The fact key excludes model prose, but
// requires stable claim/asset identity plus the same value, date, parties and
// event. Conflicting explicit filing references remain separate.
function mergeIdenticalEntries(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const filingOf = (entry) => ({
        sourceId: entry.sourceId || null,
        fileName: entry.fileName || null,
        sourceEntryIndex: entry.sourceEntryIndex ?? null,
        sourceDocumentLinkId: entry.sourceDocumentLinkId ?? null
    });
    const filingsOf = (entry) => Array.isArray(entry?.filings) && entry.filings.length > 0
        ? entry.filings.map((filing) => ({ ...filing }))
        : [filingOf(entry)];
    const sourcesOf = (entry) => {
        const sources = Array.isArray(entry?.sources) ? entry.sources.filter(Boolean) : [];
        for (const filing of filingsOf(entry)) {
            if (filing.sourceId && !sources.includes(filing.sourceId)) sources.push(filing.sourceId);
        }
        return sources;
    };
    const normalizedRegistry = (value) => normalizeText(normalizeClaimRegistryNumber(value));
    const normalizedReference = (value) => normalizeText(value)
        .replace(/[–—−]/g, '-')
        .replace(/\s+/g, '');
    const stableIdentity = (entry) => {
        const registry = normalizedRegistry(entry?.claimRegistryNumber);
        const identifier = normalizeText(entry?.identifier || '').trim();
        const filingReference = normalizedReference(entry?.filingReference || '');
        return registry || identifier || filingReference;
    };
    const sourceScope = (entry) => {
        if (!entry?.sourceId) return null;
        if (entry.sourceDocumentLinkId) {
            return `${entry.sourceId}::link:${entry.sourceDocumentLinkId}`;
        }
        if (Number.isInteger(entry.sourceEntryIndex)) {
            return `${entry.sourceId}::entry:${entry.sourceEntryIndex}`;
        }
        return null;
    };
    const keyOf = (entry) => {
        const timestamp = parseDate(String(entry?.date || ''));
        const date = timestamp === null ? normalizeText(entry?.date || '') : String(timestamp);
        const rank = normalizePaymentRank(entry?.isplatniRed || '');
        return [
            entry?.contentHash || sourceScope(entry) || '',
            entry?.assetType || '',
            String(entry?.value ?? ''),
            entry?.currency || '',
            date,
            normalizeText(entry?.identifier || ''),
            normalizeText(entry?.transferorOib || entry?.transferor || ''),
            normalizeText(entry?.transfereeOib || entry?.transferee || ''),
            entry?.eventType || '',
            entry?.amountRole || '',
            normalizeText(entry?.legalEffect || ''),
            entry?.valueRole || ''
        ].join('::');
    };
    const identifiersCompatible = (left, right) => {
        const leftRegistry = normalizedRegistry(left?.claimRegistryNumber);
        const rightRegistry = normalizedRegistry(right?.claimRegistryNumber);
        const leftIdentifier = normalizeText(left?.identifier || '').trim();
        const rightIdentifier = normalizeText(right?.identifier || '').trim();
        return (!leftRegistry || !rightRegistry || leftRegistry === rightRegistry)
            && (!leftIdentifier || !rightIdentifier || leftIdentifier === rightIdentifier);
    };
    const hasMergeScope = (entry) => Boolean(entry?.contentHash || sourceScope(entry));
    const referencesCompatible = (left, right) => {
        const leftReference = normalizedReference(left?.filingReference || '');
        const rightReference = normalizedReference(right?.filingReference || '');
        return (!leftReference || !rightReference || leftReference === rightReference)
            && identifiersCompatible(left, right)
            && Boolean(left?.contentHash || right?.contentHash || stableIdentity(left) || stableIdentity(right));
    };
    const stringsOf = (entry, field, variantsField) => {
        const values = Array.isArray(entry?.[variantsField]) ? [...entry[variantsField]] : [];
        if (typeof entry?.[field] === 'string' && entry[field].trim()) values.unshift(entry[field].trim());
        return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
    };
    const byKey = new Map();
    const merged = [];
    for (const entry of list) {
        const filings = filingsOf(entry);
        const sources = sourcesOf(entry);
        if (!hasMergeScope(entry)) {
            merged.push({
                ...entry,
                duplicateCount: Math.max(1, Number(entry?.duplicateCount) || 1),
                descriptionVariants: stringsOf(entry, 'description', 'descriptionVariants'),
                quoteVariants: stringsOf(entry, 'quote', 'quoteVariants'),
                sources,
                filings
            });
            continue;
        }
        const key = keyOf(entry);
        const candidates = byKey.get(key) || [];
        const kept = candidates.find((candidate) => referencesCompatible(candidate, entry));
        if (!kept) {
            const added = {
                ...entry,
                duplicateCount: Math.max(1, Number(entry?.duplicateCount) || 1),
                descriptionVariants: stringsOf(entry, 'description', 'descriptionVariants'),
                quoteVariants: stringsOf(entry, 'quote', 'quoteVariants'),
                sources,
                filings
            };
            candidates.push(added);
            byKey.set(key, candidates);
            merged.push(added);
            continue;
        }
        kept.duplicateCount += Math.max(1, Number(entry?.duplicateCount) || 1);
        for (const field of ['claimRegistryNumber', 'identifier', 'filingReference', 'isplatniRed']) {
            if (!kept[field] && entry[field]) kept[field] = entry[field];
        }
        for (const value of stringsOf(entry, 'description', 'descriptionVariants')) {
            if (!kept.descriptionVariants.includes(value)) kept.descriptionVariants.push(value);
        }
        for (const value of stringsOf(entry, 'quote', 'quoteVariants')) {
            if (!kept.quoteVariants.includes(value)) kept.quoteVariants.push(value);
        }
        for (const source of sources) {
            if (!kept.sources.includes(source)) kept.sources.push(source);
        }
        for (const filing of filings) {
            if (!kept.filings.some((f) =>
                f.sourceId === filing.sourceId && f.sourceEntryIndex === filing.sourceEntryIndex && f.sourceDocumentLinkId === filing.sourceDocumentLinkId
            )) kept.filings.push(filing);
        }
    }
    let propertyOrdinal = 0;
    merged.forEach((entry, index) => {
        entry.id = `flow-${index + 1}`;
        if (entry.assetType !== 'novac') {
            propertyOrdinal += 1;
            entry.__propertyOrdinal = propertyOrdinal;
        } else {
            delete entry.__propertyOrdinal;
        }
    });
    return merged;
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
    // Collapse repeated extraction of a stable fact within one source, and
    // byte-identical cross-filing attachments. Distinct source files without
    // byte hashes are never matched by filename or fact similarity.
    const mergedEntries = mergeIdenticalEntries(entries);
    entries.length = 0;
    entries.push(...mergedEntries);
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
 * / `pkg.propertyFlow` retain their legacy fields and conditionally add
 * duplicate provenance (`duplicateCount`, source filings and description
 * variants) for entries collapsed by the unified collector.
 * Each view filters the unified array by `assetType` and renumbers its own id
 * sequence in historical order, renaming fields back to legacy vocabulary.
 */

/**
 * Money view: `novac` entries only, `value`→`amount` (+EUR fields), legacy
 * aliases exposed and lifecycle fields omitted. Unmerged output retains the
 * prior shape; merged rows include the duplicate provenance documented above.
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
            ...(flow.eventType ? { eventType: flow.eventType } : {}),
            ...(flow.amountRole ? { amountRole: flow.amountRole } : {}),
            ...(flow.crossCategoryFactId ? { crossCategoryFactId: flow.crossCategoryFactId } : {}),
            ...(flow.duplicateCount > 1 ? {
                duplicateCount: flow.duplicateCount,
                descriptionVariants: [...(flow.descriptionVariants || [])],
                sources: [...(flow.sources || [])],
                filings: (flow.filings || []).map((filing) => ({ ...filing })),
            } : {}),
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
 * Property view: every non-`novac` entry, legacy vocabulary, with property
 * ids mapped back from unified `flow-N` references. Unmerged output retains
 * the prior shape; merged rows include duplicate provenance.
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
        ...(flow.valueRole ? { valueRole: flow.valueRole } : {}),
        ...(flow.crossCategoryFactId ? { crossCategoryFactId: flow.crossCategoryFactId } : {}),
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
        ...(flow.duplicateCount > 1 ? {
            duplicateCount: flow.duplicateCount,
            descriptionVariants: [...(flow.descriptionVariants || [])],
            sources: [...(flow.sources || [])],
            filings: (flow.filings || []).map((filing) => ({ ...filing })),
        } : {}),
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
    normalizeValueRole,
    VALUE_ROLES,
};
