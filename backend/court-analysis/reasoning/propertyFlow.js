// backend/court-analysis/reasoning/propertyFlow.js
//
// Property-flow extraction surface: structural parallel to moneyFlow.js for
// real estate, movable assets, receivables/claims (tražbina) and other assets.
//
// assetType: "nekretnina" | "pokretnina" | "tražbina" | "drugo" (coarse, best-effort).
// eventType (tražbina lifecycle only): "prijava" | "ustup" | "namirenje" | "drugo".
// supersedes (tražbina only, optional): model-populated link to an earlier
// lifecycle entry for the SAME receivable. Resolved by stable per-run entry id
// first, then by normalized-description containment fallback; unresolvable
// references degrade to standalone treatment — never throw.
//
// Empty input → empty output, no errors (moneyFlow.js philosophy).

const { findCitationLinkedPairs } = require('./citationGraph');
const { normalizeText } = require('./indexer');
const { parseDate } = require('./timelineBuilder');

// Normalize + collect moved to flow.js (flow-consolidation PR2): the unified
// collector + property derived view reproduce this module's historical output
// exactly. This module keeps the tražbina-lifecycle vocabulary and algorithm
// (grouping, supersedes resolution, value-change timelines, reconciliation).

const VALID_ASSET_TYPES = ['nekretnina', 'pokretnina', 'tražbina', 'trazbina', 'drugo'];
const VALID_EVENT_TYPES = ['prijava', 'ustup', 'namirenje', 'drugo'];

function normalizeAssetType(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return 'drugo';
    const ascii = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    if (['nekretnina', 'pokretnina', 'trazbina', 'tražbina', 'drugo'].includes(raw) || ['nekretnina', 'pokretnina', 'trazbina', 'drugo'].includes(ascii)) {
        return raw === 'trazbina' ? 'tražbina' : raw;
    }
    return 'drugo';
}

function normalizeEventType(value) {
    const raw = String(value || '').trim().toLowerCase();
    return VALID_EVENT_TYPES.includes(raw) ? raw : null;
}

/**
 * Legacy entry point (flow-consolidation PR2): thin wrapper over the unified
 * collector + property derived view. Output is byte-identical to the old
 * implementation for the same input (verified by the eval-fixture diff).
 * @param {Array<object>} analyses
 * @returns {{count: number, entries: Array<object>, hasPropertyFlow: boolean}}
 */
function collectPropertyFlows(analyses) {
    const { collectFlows, derivePropertyFlowView } = require('./flow');
    return derivePropertyFlowView(collectFlows(analyses));
}

// Grouping key shared with reconcileMoneyFlows philosophy: normalized
// description tokens + assetType. Short/generic descriptions yield null and
// are never grouped (avoid over-merging distinct assets).
function propertyGroupKey(entry) {
    const tokens = normalizeText(entry?.description || '')
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3);
    if (tokens.length < 2) return null;
    return `${entry?.assetType || 'drugo'}::${tokens.sort().join('-')}`;
}

function formatValue(value, currency) {
    const num = Number.isFinite(value) ? value.toLocaleString('en-US') : String(value ?? '?');
    return currency ? `${num} ${currency}` : num;
}

function resolveSupersedesTarget(ref, entriesById, entries) {
    if (!ref) return null;
    const trimmed = String(ref).trim();
    if (!trimmed) return null;
    // 1. Stable per-run id match (prop-N).
    if (entriesById.has(trimmed)) return entriesById.get(trimmed);
    if (entriesById.has(trimmed.toLowerCase())) return entriesById.get(trimmed.toLowerCase());
    // L-01 — ID-first: real registry/filing identifiers (J-04) beat fuzzy
    // text. An explicit supersedes citing "106" or "St-2/2013-1196-1"
    // resolves by exact identifier equality before any prose guessing.
    const list = Array.isArray(entries) ? entries : [];
    const lowered = trimmed.toLowerCase();
    for (const entry of list) {
        if (typeof entry?.claimRegistryNumber === 'string'
            && entry.claimRegistryNumber.trim()
            && (entry.claimRegistryNumber.trim() === trimmed
                || entry.claimRegistryNumber.trim().toLowerCase() === lowered)) {
            return entry;
        }
    }
    for (const entry of list) {
        if (typeof entry?.filingReference === 'string'
            && entry.filingReference.trim()
            && (entry.filingReference.trim() === trimmed
                || entry.filingReference.trim().toLowerCase() === lowered)) {
            return entry;
        }
    }
    // 4. Normalized-description containment fallback: the model cites the
    // original claim explicitly (case number, filing date, original creditor)
    // but cannot know our generated ids — a reference containing (or contained
    // in) another entry's description resolves to that entry.
    const normalizedRef = normalizeText(trimmed);
    if (!normalizedRef) return null;
    for (const entry of list) {
        const normalizedDesc = normalizeText(entry?.description || '');
        if (!normalizedDesc) continue;
        if (normalizedDesc.includes(normalizedRef) || normalizedRef.includes(normalizedDesc)) {
            return entry;
        }
    }
    return null;
}

/**
 * Builds a value-change timeline finding from a fully-linked tražbina chain.
 * Extracted so registry-linked (L-01) and supersedes/citation-linked chains
 * share one math + shape implementation.
 */
function buildValueChangeTimeline(groupEntries, linkage, valueFn) {
    const effective = typeof valueFn === 'function'
        ? valueFn
        : (e) => (Number.isFinite(e.valueEur) ? e.valueEur : e.value);
    // Chronological order must use real date parsing (ISO + Croatian
    // `dd.mm.yyyy.` via parseDate), not string comparison — a Croatian
    // "15.06.2022." sorts *after* "2023-06-01" lexicographically.
    // Undated stages sort last, stable otherwise.
    const decorated = (Array.isArray(groupEntries) ? groupEntries : []).map((entry, index) => ({
        entry,
        index,
        ts: parseDate(entry?.date),
    }));
    decorated.sort((a, b) => {
        if (a.ts !== null && b.ts !== null && a.ts !== b.ts) return a.ts - b.ts;
        if (a.ts === null && b.ts !== null) return 1;
        if (a.ts !== null && b.ts === null) return -1;
        return a.index - b.index;
    });
    const sorted = decorated.map(({ entry }) => entry);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    // K-03: timeline math on the consolidated EUR scale when both ends
    // have one; otherwise the legacy raw values.
    const eurScale = Number.isFinite(first.valueEur) && Number.isFinite(last.valueEur);
    const originalValue = eurScale
        ? first.valueEur
        : (Number.isFinite(first.value) ? first.value : null);
    const latestValue = eurScale
        ? last.valueEur
        : (Number.isFinite(last.value) ? last.value : null);
    let delta = null;
    let discountPct = null;
    if (originalValue !== null && latestValue !== null) {
        delta = latestValue - originalValue;
        discountPct = originalValue !== 0 ? Number(((delta / originalValue) * 100).toFixed(2)) : null;
    }
    const currency = eurScale ? 'EUR' : (last.currency || first.currency || '');
    return {
        description: first.description,
        linkage,
        stages: sorted.map((e) => ({
            id: e.id,
            eventType: e.eventType || null,
            value: effective(e) ?? null,
            currency: eurScale ? 'EUR' : (e.currency || null),
            date: e.date || null,
            transferor: e.transferor || null,
            transferee: e.transferee || null,
            sourceId: e.sourceId || null,
            fileName: e.fileName || null,
        })),
        originalValue,
        latestValue,
        currency,
        delta,
        discountPct,
        finding: `Tražbina "${first.description}" u iznosu od ${formatValue(originalValue, currency)} ustupljena je za ${formatValue(latestValue, currency)}.`,
        sources: sorted.map((e) => e.sourceId).filter(Boolean),
    };
}

/**
 * Tražbina lifecycle reconciliation (registry/citation-linked chains,
 * `resolveSupersedesTarget`, value-change timelines). Extracted so the
 * unified `reconcileFlows` (reconciliation.js) and the legacy
 * `reconcilePropertyFlows` share one implementation: algorithm untouched,
 * only re-sourced.
 *
 * @param {Array<object>} trazbinaEntries - Entries with assetType 'tražbina'.
 * @param {Array<object>} allEntries - Full entry set for stable-id scoping.
 * @param {object} [context] - Optional `{ analyses }` for the L-02 citation signal.
 * @param {(entry: object) => number|null} [valueFn] - EUR-consolidated value accessor.
 * @returns {{conflicts: Array, openQuestions: Array, valueChanges: Array<object>}}
 */
function reconcileTrazbinaLifecycle(trazbinaEntries, allEntries, context = {}, valueFn = null) {
    const conflicts = [];
    const openQuestions = [];
    const valueChanges = [];
    const trazbina = Array.isArray(trazbinaEntries) ? trazbinaEntries : [];
    if (trazbina.length === 0) return { conflicts, openQuestions, valueChanges };

    const scope = Array.isArray(allEntries) ? allEntries : trazbina;
    const entriesById = new Map(scope.map((e) => [String(e?.id), e]));

    // K-03: value comparison runs on the consolidated EUR scale when both
    // sides have one, mirroring reconcileMoneyFlows.
    const effectiveValue = typeof valueFn === 'function'
        ? valueFn
        : (e) => (Number.isFinite(e.valueEur) ? e.valueEur : e.value);

    // L-01 — ID-first: entries sharing a stable `claimRegistryNumber` (J-04)
    // are the SAME registered claim by definition and form a timeline
    // directly, without any fuzzy description grouping. Only entries without
    // a shared registry number fall through to the description path below.
    const registryClusters = new Map();
    const registryConsumed = new Set();
    for (const entry of trazbina) {
        const reg = typeof entry?.claimRegistryNumber === 'string' ? entry.claimRegistryNumber.trim() : '';
        if (!reg) continue;
        if (!registryClusters.has(reg)) registryClusters.set(reg, []);
        registryClusters.get(reg).push(entry);
    }
    for (const [reg, clusterEntries] of registryClusters) {
        if (clusterEntries.length < 2) continue;
        for (const entry of clusterEntries) registryConsumed.add(entry.id);
        valueChanges.push(buildValueChangeTimeline(clusterEntries, 'claimRegistryNumber', effectiveValue));
    }

    // L-02 — citation edges are a second explicit link signal: entries whose
    // documents directly cite each other's filing references join the same
    // chain instead of being guessed from prose.
    const citationPairs = findCitationLinkedPairs(
        trazbina.filter((e) => !registryConsumed.has(e.id)),
        context?.analyses
    );
    const citationKey = (a, b) => [String(a.id), String(b.id)].sort().join('::');

    const trazbinaGroups = new Map();
    for (const entry of trazbina) {
        if (registryConsumed.has(entry.id)) continue;
        const key = propertyGroupKey(entry);
        if (!key) continue; // Ungroupable (too-generic description): standalone, never a conflict source.
        const groupKey = `${entry.assetType}::${key}`;
        if (!trazbinaGroups.has(groupKey)) trazbinaGroups.set(groupKey, []);
        trazbinaGroups.get(groupKey).push(entry);
    }

    for (const groupEntries of trazbinaGroups.values()) {
        if (groupEntries.length === 1) continue; // standalone, no comparison possible
        // Resolve chains within the group.
        const linked = new Set(); // entry ids participating in a resolved chain
        const chainEdges = []; // {from, to}
        for (const entry of groupEntries) {
            if (!entry.supersedes) continue;
            const target = resolveSupersedesTarget(entry.supersedes, entriesById, groupEntries);
            if (target && groupEntries.includes(target)) {
                linked.add(entry.id);
                linked.add(target.id);
                chainEdges.push({ from: target, to: entry });
            }
            // Unresolvable supersedes → standalone treatment (graceful, no error).
        }
        // L-02: direct citation links join the chain on equal footing.
        for (let i = 0; i < groupEntries.length; i++) {
            for (let j = i + 1; j < groupEntries.length; j++) {
                if (!citationPairs.has(citationKey(groupEntries[i], groupEntries[j]))) continue;
                linked.add(groupEntries[i].id);
                linked.add(groupEntries[j].id);
                chainEdges.push({ from: groupEntries[i], to: groupEntries[j] });
            }
        }

        if (linked.size === groupEntries.length && chainEdges.length > 0) {
            // Fully chained: surface as a value-change timeline finding.
            valueChanges.push(buildValueChangeTimeline(groupEntries, 'supersedes', effectiveValue));
        } else {
            // Not fully chained: competing claims. Flag genuine conflict only
            // when transferees genuinely differ (same receivable, different
            // assignees, no resolving chain).
            const transferees = [...new Set(groupEntries.map((e) => String(e.transferee || '').trim()).filter(Boolean))];
            if (transferees.length > 1) {
                conflicts.push({
                    finding: `Konkurentske tvrdnje o istoj tražbini: ${groupEntries[0].description} — stjecatelji ${transferees.join(' vs ')}.`,
                    reason: `Tražbina "${groupEntries[0].description}" prenesena je na različite stjecatelje bez lanca koji bi razriješio koja je tvrdnja mjerodavna.`,
                    sources: groupEntries.map((e) => e.sourceId).filter(Boolean),
                    source: 'reconciliation',
                    kind: 'lifecycle',
                });
            } else {
                openQuestions.push({
                    text: `Tražbina "${groupEntries[0].description}" pojavljuje se u ${groupEntries.length} dokument(a) bez povezujućeg lanca — je li riječ o istom potraživanju u različitim fazama?`,
                    source: 'reconciliation',
                    kind: 'lifecycle',
                });
            }
        }
    }

    return { conflicts, openQuestions, valueChanges };
}

/**
 * Deterministic property-flow reconciliation, mirroring reconcileMoneyFlows
 * grouping/conflict philosophy with a distinct tražbina lifecycle path.
 *
 * Legacy entry point (flow-consolidation PR3): thin wrapper over the unified
 * `reconcileFlows`. Output matches the historical implementation for the
 * same input (verified by the eval-fixture diff + lifecycle tests).
 *
 * @param {object} propertyFlow - Output of collectPropertyFlows.
 * @param {object} [context] - Optional `{ analyses }` (normalized analyses
 * carrying `citedFilingReferences`); enables the L-02 citation-link signal.
 * @returns {{conflicts: Array, openQuestions: Array<{text: string, source: string, kind: string}>, valueChanges: Array<object>}}
 */
function reconcilePropertyFlows(propertyFlow, context = {}) {
    // Lazy require: reconciliation.js loads this module at its top level,
    // so an eager require back would cycle.
    const { reconcileFlows } = require('./reconciliation');
    const flows = {
        entries: (Array.isArray(propertyFlow?.entries) ? propertyFlow.entries : []).map(asLegacyPropertyFlow),
    };
    const result = reconcileFlows(flows, context);
    return { conflicts: result.conflicts, openQuestions: result.openQuestions, valueChanges: result.valueChanges };
}

// Legacy property-view entries already speak the value vocabulary; the
// shared engine only needs the `assetType` discriminant guaranteed.
function asLegacyPropertyFlow(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    return { ...entry, assetType: entry.assetType || 'drugo' };
}

module.exports = {
    collectPropertyFlows,
    reconcilePropertyFlows,
    reconcileTrazbinaLifecycle,
    buildValueChangeTimeline,
    formatValue,
    propertyGroupKey,
    normalizeAssetType,
    normalizeEventType,
    VALID_ASSET_TYPES: ['nekretnina', 'pokretnina', 'tražbina', 'drugo'],
    VALID_EVENT_TYPES,
};
