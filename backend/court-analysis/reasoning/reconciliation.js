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
            const diverges = max > 0 && (max / min > DIVERGENCE_RATIO_THRESHOLD || Math.abs(max - min) > 0.01);
            if (!diverges) continue;
            conflicts.push({
                finding: `Različiti iznosi za istu namjenu (${currency}): ${[...new Set(values.map(formatAmount))].join(' vs ')}.`,
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
    const entries = Array.isArray(flows?.entries) ? flows.entries : [];
    if (entries.length === 0) return { conflicts, openQuestions, valueChanges: [] };

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
    const totalEntries = entries.filter((entry) => {
        const normalized = normalizeText(entry.description || '');
        return TOTAL_MARKERS.some((marker) => normalized.includes(marker));
    });
    const partEntries = entries.filter((entry) => !TOTAL_MARKERS.some((marker) => normalizeText(entry.description || '').includes(marker)));

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
        openQuestions.push({
            text: `Navodni ukupni iznos ${formatAmount(totalValue)} ${shownCurrency} (${totalEntry.fileName || 'nepoznat dokument'}) ne odgovara zbroju ostalih izdvojenih stavki iz istog dokumenta (${formatAmount(partsSum)} ${shownCurrency}). Je li ukupnost pokrivala i neprijavljene stavke?`,
            source: 'reconciliation',
            kind: totalIsNovac ? 'arithmetic' : 'property'
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

    return { conflicts, openQuestions, valueChanges: lifecycle.valueChanges };
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
    return { conflicts: result.conflicts, openQuestions: result.openQuestions };
}

module.exports = { reconcileFlows, reconcileMoneyFlows, reconcilePropertyFlows, isSameDocument, descriptionKey };
