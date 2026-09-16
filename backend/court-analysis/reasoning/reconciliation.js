// backend/court-analysis/reasoning/reconciliation.js
//
// Purpose: Deterministic reconciliation over the unified `Flow` surface.
//          Cross-checks extracted figures for duplication and divergence
//          BEFORE any model sees them, so arithmetic facts that code can
//          prove never cost tokens — and never get softened by a model into
//          "possible inconsistencies".
//
// Ownership contract (Gap-1 fix): output lands in pkg.reconciliation and is
// seeded into the report by synthesizeReport; verifyReport then appends its
// own model-found conflicts on top. Reconciliation is never dropped because
// there is exactly one merge point per stage.
//
// Conservative by design: only flag what code can defend (duplicate
// descriptions with divergent figures, totals that don't match their parts).
// Everything softer stays an openQuestion, not a conflict.
//
// Flow-consolidation PR3: `reconcileFlows` is the one shared entry point
// over `pkg.flows`. The divergent-group check runs per kind (novac keeps
// money's ratio rule + texts, other asset types keep property's
// value-or-transferee rule + texts) so legacy outputs reproduce exactly;
// totals-vs-parts and dual-mismatch residue run once over the whole array;
// tražbina lifecycle delegates to propertyFlow's extracted implementation.

const { normalizeText } = require('./indexer');
const { reconcilePropertyFlows, reconcileTrazbinaLifecycle, formatValue } = require('./propertyFlow');

const DIVERGENCE_RATIO_THRESHOLD = 1.05;
// Description keys shorter than this are too generic to group safely
// ("iznos", "cijena" would collide across unrelated documents).
const MIN_KEY_TOKENS = 2;

function descriptionKey(description) {
    const tokens = normalizeText(description)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3);
    if (tokens.length < MIN_KEY_TOKENS) return null;
    return tokens.sort().join('-');
}

function formatAmount(value) {
    return Number.isFinite(value) ? value.toLocaleString('en-US') : String(value);
}

// Arithmetic is compared on a EUR-normalized scale, but a conflict must show
// the figures exactly as their source filings state them. Rendering a HRK
// source value only as EUR hides the discrepancy a reviewer needs to assess.
function formatSourceValue(entry) {
    const raw = formatAmount(entry?.value);
    const currency = entry?.currency || 'UNKNOWN';
    const effective = effectiveFlowValue(entry);
    const differsFromRaw = Number.isFinite(entry?.value)
        && Number.isFinite(effective)
        && Math.abs(entry.value - effective) > 0.01;

    if (currency !== 'EUR' && differsFromRaw) {
        return `${raw} ${currency} (≈ ${formatAmount(effective)} EUR)`;
    }
    return `${raw} ${currency}`;
}

/**
 * Same-document identity for the totals-vs-parts check. `sourceId` is the
 * stable per-run file identity (analysis.id = the downloaded filePath);
 * `fileName` is display text and collides across unrelated filings (many
 * literal `Podnesak.pdf` on real e-Oglasna data). When both entries carry a
 * sourceId, it decides — fileName equality alone must not group two
 * different files. Legacy entries without a sourceId keep the old
 * fileName-equality path instead of being forced into a wrong comparison.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function isSameDocument(a, b) {
    const aSrc = a?.sourceId || null;
    const bSrc = b?.sourceId || null;
    if (aSrc && bSrc) {
        if (aSrc !== bSrc) return false;
        const aName = a?.fileName || null;
        const bName = b?.fileName || null;
        // Same stable id but different display names (e.g. a test mixing
        // fixtures, or a renamed re-download) is not the same document.
        if (aName && bName) return aName === bName;
        return true;
    }
    return (a?.fileName || null) === (b?.fileName || null);
}

// K-03 — all math below runs on the consolidated EUR field, never raw
// mixed-currency values.
const effectiveFlowValue = (entry) => (Number.isFinite(entry?.valueEur) ? entry.valueEur : entry?.value);

// Legacy money-view entries speak the amount vocabulary; map them onto the
// flow shape (ids and provenance preserved) so the shared checks apply.
function asNovacFlow(entry) {
    if (!entry || typeof entry !== 'object') return null;
    return {
        ...entry,
        assetType: entry.assetType || 'novac',
        value: entry.value ?? entry.amount ?? null,
        valueEur: entry.valueEur ?? entry.amountEur ?? null,
    };
}

function flowGroupKey(entry) {
    const key = descriptionKey(entry?.description || '');
    if (!key) return null;
    const scale = Number.isFinite(entry?.valueEur) ? 'EUR' : (entry?.currency || 'UNKNOWN');
    return `${scale}::${entry?.assetType || 'drugo'}::${key}`;
}

// TD-3 — collapse structurally identical questions (same underlying pair,
// different filings) into one entry with merged document provenance. The
// dominant source is the totals-vs-parts loop, which emits one question per
// document for the same (total, parts-sum) pair. The key strips document-name
// segments so repeats across filings collapse; amounts are already canonical
// (`formatAmount` en-US), so equal pairs key equally. Pure function: no
// question is ever dropped, only folded with its provenance retained.
const QUESTION_DOCUMENT_SEGMENT_RE = /\([^()]*?\.pdf[^()]*?\)/gi;

function dedupeQuestionKey(question) {
    const kind = (question && typeof question === 'object' && question.kind) || '';
    const text = question && typeof question === 'object' && typeof question.text === 'string'
        ? question.text
        : String(question || '');
    return `${kind}::${normalizeText(text.replace(QUESTION_DOCUMENT_SEGMENT_RE, '(dokument)'))}`;
}

function extractQuestionDocuments(question) {
    const docs = [];
    const text = question && typeof question === 'object' && typeof question.text === 'string'
        ? question.text
        : '';
    const segment = /\(([^()]*?\.pdf)\)/gi;
    let match;
    while ((match = segment.exec(text)) !== null) {
        const name = match[1].trim();
        if (name && !docs.includes(name)) docs.push(name);
    }
    for (const known of (question && Array.isArray(question.documents) ? question.documents : [])) {
        if (typeof known === 'string' && known && !docs.includes(known)) docs.push(known);
    }
    return docs;
}

function dedupeQuestions(openQuestions) {
    const list = Array.isArray(openQuestions) ? openQuestions : [];
    const byKey = new Map();
    for (const question of list) {
        if (!question) continue;
        const key = dedupeQuestionKey(question);
        const docs = extractQuestionDocuments(question);
        if (!byKey.has(key)) {
            const first = (question && typeof question === 'object') ? { ...question } : { text: String(question), source: 'reconciliation', kind: 'arithmetic' };
            first.documents = docs;
            first.occurrences = 1;
            byKey.set(key, first);
            continue;
        }
        const kept = byKey.get(key);
        kept.occurrences += 1;
        for (const doc of docs) {
            if (!kept.documents.includes(doc)) kept.documents.push(doc);
        }
    }
    return [...byKey.values()].map((entry) => {
        if (entry.occurrences <= 1) {
            const { occurrences, ...single } = entry;
            return single;
        }
        return entry;
    });
}

// TR-2 — same-source dual-statement collapse (spec §4.4.2). A dual-currency
// figure stated twice in ONE filing (once HRK, once EUR) converts to two
// EUR-scale entries that "diverge" by construction. When every entry shares a
// single source AND the raw currencies mix HRK/EUR AND the effective values
// have a ratio of ≈1 (conversion dust) or ≈7.53450 (the fixed rate), this is
// one dual-stated figure — not a conflict. Anything else (single currency,
// multiple sources, any other ratio) keeps the normal divergence path, so a
// coincidentally 7.5× pair of genuine EUR figures still flags.
const DUAL_RATE = 7.5345;
const DUAL_REL_TOL = 0.002;

function sameFigureRatio(values) {
    const finite = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v) && v > 0);
    if (finite.length === 0) return false;
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const ratio = hi / lo;
    return [1, DUAL_RATE].some((target) => Math.abs(ratio - target) <= DUAL_REL_TOL * target);
}

function filingProvenanceId(entry) {
    // `analysis.id` is usually a local path, but it is not filing provenance:
    // generic court attachments (for example, Podnesak.pdf) can share that
    // path across different filings. Only the document-link id survives that
    // collision and identifies the source filing unambiguously.
    const linkId = entry?.sourceDocumentLinkId;
    return typeof linkId === 'string' && linkId.trim() ? linkId.trim() : null;
}

function isSameSourceDualStatement(groupEntries) {
    if (!Array.isArray(groupEntries) || groupEntries.length < 2) return false;
    // Be conservative: without filing-level provenance, keep the pair
    // reviewable. Suppressing a genuine cross-filing discrepancy is worse
    // than showing a routine dual-currency pair for review.
    const sources = new Set(groupEntries.map(filingProvenanceId));
    if (sources.size !== 1 || sources.has(null)) return false;
    const rawCurrencies = new Set(groupEntries.map((entry) => entry?.currency || 'UNKNOWN'));
    if (!rawCurrencies.has('HRK') || !rawCurrencies.has('EUR')) return false;
    return sameFigureRatio(groupEntries.map(effectiveFlowValue));
}

// Shared divergent-group check, parameterized by kind so each family keeps
// its historical rule + finding text: novac uses money's ratio rule and
// arithmetic texts; other asset types use property's value-or-transferee
// rule and property texts.
function flagDivergentGroups(entries, { novac }) {
    const conflicts = [];
    const groups = new Map();
    for (const entry of entries) {
        if (!entry) continue;
        if (novac && entry.assetType !== 'novac') continue;
        if (!novac && (entry.assetType === 'novac' || entry.assetType === 'tražbina')) continue;
        const key = flowGroupKey(entry);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }

    for (const [groupKey, groupEntries] of groups) {
        if (groupEntries.length < 2) continue;
        const values = groupEntries.map(effectiveFlowValue).filter((v) => Number.isFinite(v));
        const currency = groupKey.split('::')[0];
        if (novac) {
            const min = Math.min(...values);
            const max = Math.max(...values);
            // Same filing stating one figure in both currencies (§4.4.2).
            if (isSameSourceDualStatement(groupEntries)) continue;
            const diverges = max > 0 && (max / min > DIVERGENCE_RATIO_THRESHOLD || Math.abs(max - min) > 0.01);
            if (!diverges) continue;
            conflicts.push({
                finding: `Različiti iznosi za istu namjenu (usporedba u ${currency}): ${[...new Set(groupEntries.map(formatSourceValue))].join(' vs ')}.`,
                reason: `Prijavljeni opis "${groupEntries[0].description}" nosi različite iznose u ${new Set(groupEntries.map((e) => e.fileName).filter(Boolean)).size} dokument(a).`,
                sources: groupEntries.map((entry) => entry.sourceId).filter(Boolean),
                source: 'reconciliation',
                kind: 'arithmetic'
            });
        } else {
            const transferees = [...new Set(groupEntries.map((e) => String(e.transferee || '').trim()).filter(Boolean))];
            const valueDiverges = values.length >= 2 && Math.max(...values) !== Math.min(...values) && Math.abs(Math.max(...values) - Math.min(...values)) > 0.01;
            const transfereeDiverges = transferees.length > 1;
            if (!valueDiverges && !transfereeDiverges) continue;
            conflicts.push({
                finding: `Različiti podaci o istoj imovini (${currency}): ${groupEntries[0].description} — ${groupEntries.map((e) => formatValue(effectiveFlowValue(e), Number.isFinite(e.valueEur) ? 'EUR' : e.currency)).join(' vs ')}.`,
                reason: `Opis "${groupEntries[0].description}" nosi različite podatke u ${new Set(groupEntries.map((e) => e.fileName).filter(Boolean)).size} dokument(a).`,
                sources: groupEntries.map((e) => e.sourceId).filter(Boolean),
                source: 'reconciliation',
                kind: 'property',
            });
        }
    }
    return conflicts;
}

/**
 * Unified reconciliation over a `collectFlows` array.
 * @param {object} flows - Output of collectFlows (entries carry the unified shape).
 * @param {object} [context] - Optional `{ analyses }` for the L-02 citation signal.
 * @returns {{conflicts: Array, openQuestions: Array<{text: string, source: string, kind: string}>, valueChanges: Array<object>}}
 * Findings carry `source: 'reconciliation'` + a `kind` (`arithmetic` for
 * novac-origin checks, `property` for other-asset checks, `lifecycle` for
 * tražbina chains) so consumers can partition legacy views back out.
 */
function reconcileFlows(flows, context = {}) {
    const conflicts = [];
    const openQuestions = [];
    // TR-1 — extraction-validation warnings: same-document total-vs-parts
    // mismatches are evidence-quality signals (partial extraction, missing
    // rows), not user-facing case conflicts. They stay inspectable here with
    // recovery pointers (which total, which parts, what is missing) for the
    // targeted row-recovery pass, and never seed report.openQuestions.
    const validationWarnings = [];
    const entries = Array.isArray(flows?.entries) ? flows.entries : [];
    if (entries.length === 0) return { conflicts, openQuestions, validationWarnings, valueChanges: [] };

    // --- 1. Divergent same-key groups (per kind, novac first: legacy order).
    conflicts.push(...flagDivergentGroups(entries, { novac: true }));
    conflicts.push(...flagDivergentGroups(entries, { novac: false }));

    // --- 2. Stated totals vs sum of parts ----------------------------------
    // Descriptions explicitly marked as totals are checked against the sum of
    // same-currency non-total entries FROM THE SAME DOCUMENT ONLY. A "total"
    // line only ever claims to summarize the other line items in the same
    // filing — comparing it against every non-total entry across the entire
    // case (potentially hundreds of unrelated documents spanning years)
    // produces a meaningless, wildly inflated "sum of parts" and a nonsense
    // openQuestion. Mismatch is still NOT auto-conflict: the entry set may
    // legitimately be a subset of what the total covers.
    // Runs over the whole array (not just novac): a filing stating an
    // asset-value total against itemized assets is caught too.
    const TOTAL_MARKERS = ['ukupno', 'ukupna', 'svega', 'total'];
    // TL-2 — role-first totals: an explicit model-stated `amountRole`
    // overrides keyword guessing entirely for that entry. Entries without a
    // role keep the legacy keyword path, so pre-ledger extractions behave
    // exactly as before.
    const isRoleTotal = (entry) => entry?.amountRole === 'total';
    const hasRole = (entry) => typeof entry?.amountRole === 'string' && entry.amountRole !== '';
    const isKeywordTotal = (entry) => {
        const normalized = normalizeText(entry.description || '');
        return TOTAL_MARKERS.some((marker) => normalized.includes(marker));
    };
    const isTotal = (entry) => (hasRole(entry) ? isRoleTotal(entry) : isKeywordTotal(entry));
    const totalEntries = entries.filter((entry) => isTotal(entry));
    const partEntries = entries.filter((entry) => !isTotal(entry));

    for (const totalEntry of totalEntries) {
        // K-03: compare on the consolidated EUR scale when the total has one —
        // parts contribute their valueEur; parts without a determinable EUR
        // value cannot join a EUR-scale sum and are skipped for this total.
        // Legacy totals (no valueEur) keep the old same-currency raw path.
        // Vocabulary-partitioned (documented deviation from the "whole array"
        // sketch): a novac total compares against novac parts only, an asset
        // total against asset parts only. The same underlying fact is
        // routinely extracted into BOTH vocabularies (a sale is a money
        // amount and a property value), so cross-vocabulary summation would
        // double-count it. Partitioning keeps money behavior byte-identical
        // while still catching asset-value-total mismatches (new).
        const totalIsNovac = totalEntry?.assetType === 'novac';
        const totalEur = Number.isFinite(totalEntry.valueEur) ? totalEntry.valueEur : null;
        const parts = partEntries.filter((part) =>
            (totalIsNovac ? part?.assetType === 'novac' : part?.assetType !== 'novac') && (
                totalEur !== null
                    ? Number.isFinite(part.valueEur) && isSameDocument(part, totalEntry)
                    : (part.currency || 'UNKNOWN') === (totalEntry.currency || 'UNKNOWN') &&
                      isSameDocument(part, totalEntry)
            )
        );
        if (parts.length === 0) continue;
        const partsSum = totalEur !== null
            ? parts.reduce((sum, part) => sum + part.valueEur, 0)
            : parts.reduce((sum, part) => sum + part.value, 0);
        const totalValue = totalEur !== null ? totalEur : totalEntry.value;
        if (Math.abs(partsSum - totalValue) <= 0.01) continue;

        const shownCurrency = totalEur !== null ? 'EUR' : (totalEntry.currency || '');
        validationWarnings.push({
            text: `Navodni ukupni iznos ${formatAmount(totalValue)} ${shownCurrency} (${totalEntry.fileName || 'nepoznat dokument'}) ne odgovara zbroju ostalih izdvojenih stavki iz istog dokumenta (${formatAmount(partsSum)} ${shownCurrency}). Moguće su neprijavljene stavke ili nepotpuna ekstrakcija redaka.`,
            source: 'reconciliation',
            kind: totalIsNovac ? 'arithmetic' : 'property',
            check: 'total-vs-parts',
            total: {
                description: totalEntry.description || null,
                value: totalValue,
                currency: shownCurrency || null,
                sourceId: totalEntry.sourceId || null,
                fileName: totalEntry.fileName || null
            },
            parts: parts.map((part) => ({
                description: part.description || null,
                value: totalEur !== null ? part.valueEur : part.value,
                sourceId: part.sourceId || null
            })),
            documents: [...new Set([totalEntry.fileName, ...parts.map((part) => part.fileName)].filter(Boolean))]
        });
    }

    // --- 3. Tražbina lifecycle (assetType-gated, algorithm unchanged). ------
    const lifecycle = reconcileTrazbinaLifecycle(
        entries.filter((e) => e?.assetType === 'tražbina'),
        entries,
        context
    );
    conflicts.push(...lifecycle.conflicts);
    openQuestions.push(...lifecycle.openQuestions);

    // --- 4. K-04 tie-break residue: source-stated dual figures that do NOT
    // match the fixed rate. The EUR figure already won outright for all math
    // above; this flags the filing's own inconsistency as its own question.
    // Tagged by origin kind so legacy views partition back out.
    for (const entry of entries) {
        if (entry?.currencyNote !== 'dual-mismatch' || !entry?.dualCurrency) continue;
        const { statedEur, statedHrk, deviationPct } = entry.dualCurrency;
        openQuestions.push({
            text: `Dokument ${entry.fileName || 'nepoznat dokument'} navodi dvojni iznos ${formatAmount(statedEur)} EUR (${formatAmount(statedHrk)} HRK) koji ne odgovara fiksnom tečaju 7.53450 (odstupanje ${deviationPct ?? '?'}%). Za izračun je uzet iznos u EUR.`,
            source: 'reconciliation',
            kind: entry.assetType === 'novac' ? 'arithmetic' : 'property'
        });
    }

    return { conflicts, openQuestions: dedupeQuestions(openQuestions), validationWarnings: dedupeQuestions(validationWarnings), valueChanges: lifecycle.valueChanges };
}

/**
 * Legacy entry point (flow-consolidation PR3): thin wrapper over the unified
 * engine. For money-vocabulary input the shared checks reproduce the
 * historical output exactly.
 * @param {object} moneyFlow - Output of collectMoneyFlows / deriveMoneyFlowView.
 * @returns {{conflicts: Array, openQuestions: Array}}
 */
function reconcileMoneyFlows(moneyFlow) {
    const entries = (Array.isArray(moneyFlow?.entries) ? moneyFlow.entries : [])
        .map(asNovacFlow)
        .filter(Boolean);
    const result = reconcileFlows({ entries }, {});
    return { conflicts: result.conflicts, openQuestions: result.openQuestions, validationWarnings: result.validationWarnings };
}

module.exports = { reconcileFlows, reconcileMoneyFlows, reconcilePropertyFlows, isSameDocument, descriptionKey, formatSourceValue, dedupeQuestions };
