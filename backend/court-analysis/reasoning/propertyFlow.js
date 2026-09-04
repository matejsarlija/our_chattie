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

const { normalizeCurrency, parseAmount } = require('./moneyFlow');
const { normalizeText } = require('./indexer');

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

function normalizePropertyItem(raw, index, analysis) {
    if (!raw || typeof raw !== 'object') return null;
    const description = raw.description || raw.text || raw.opis || null;
    if (!description || typeof description !== 'string' || !description.trim()) return null;

    const value = raw.value !== undefined && raw.value !== null
        ? parseAmount(raw.value ?? raw.amount ?? raw.iznos)
        : null;
    // Value is optional for property entries (e.g. prijava without stated value
    // yet); only reject when a value was provided but unparseable AND no
    // parties/identifier anchor the entry. Keep permissive: description alone suffices.
    if (raw.value !== undefined && raw.value !== null && raw.amount !== undefined && value === null && raw.value !== null) {
        // Provided value unparseable — keep entry with null value rather than dropping.
    }

    const assetType = normalizeAssetType(raw.assetType ?? raw.asset_type ?? raw.vrsta);
    const eventType = assetType === 'tražbina' ? (normalizeEventType(raw.eventType ?? raw.event_type) || null) : null;
    const supersedes = assetType === 'tražbina' && raw.supersedes !== undefined && raw.supersedes !== null
        ? String(raw.supersedes).trim() || null
        : null;

    return {
        id: `prop-${index + 1}`,
        description: String(description).trim(),
        identifier: raw.identifier ?? null,
        assetType,
        ...(eventType ? { eventType } : {}),
        transferor: raw.transferor || raw.from || raw.ustupitelj || null,
        transferee: raw.transferee || raw.to || raw.stjecatelj || null,
        value: value,
        currency: normalizeCurrency(raw.currency ?? raw.valuta) || null,
        date: raw.date || raw.datum || null,
        ...(supersedes ? { supersedes } : {}),
        quote: typeof raw.quote === 'string' ? raw.quote : null,
        grounded: raw.grounded === true,
        sourceId: analysis?.id || null,
        fileName: analysis?.fileName || null,
        caseNumber: analysis?.caseNumber || null,
    };
}

/**
 * Aggregates structured property movements across all successful analyses.
 * @param {Array<object>} analyses
 * @returns {{count: number, entries: Array<object>, hasPropertyFlow: boolean}}
 */
function collectPropertyFlows(analyses) {
    const entries = [];
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        const rawList = analysis?.propertyFlow;
        if (!Array.isArray(rawList)) continue;
        for (const raw of rawList) {
            const entry = normalizePropertyItem(raw, entries.length, analysis);
            if (entry) entries.push(entry);
        }
    }
    return { count: entries.length, entries, hasPropertyFlow: entries.length > 0 };
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
    // 2. Normalized-description containment fallback: the model cites the
    // original claim explicitly (case number, filing date, original creditor)
    // but cannot know our generated ids — a reference containing (or contained
    // in) another entry's description resolves to that entry.
    const normalizedRef = normalizeText(trimmed);
    if (!normalizedRef) return null;
    for (const entry of entries) {
        const normalizedDesc = normalizeText(entry?.description || '');
        if (!normalizedDesc) continue;
        if (normalizedDesc.includes(normalizedRef) || normalizedRef.includes(normalizedDesc)) {
            return entry;
        }
    }
    return null;
}

/**
 * Deterministic property-flow reconciliation, mirroring reconcileMoneyFlows
 * grouping/conflict philosophy with a distinct tražbina lifecycle path.
 *
 * @param {object} propertyFlow - Output of collectPropertyFlows.
 * @returns {{conflicts: Array, openQuestions: Array<string>, valueChanges: Array<object>}}
 */
function reconcilePropertyFlows(propertyFlow) {
    const conflicts = [];
    const openQuestions = [];
    const valueChanges = [];
    const entries = Array.isArray(propertyFlow?.entries) ? propertyFlow.entries : [];
    if (entries.length === 0) return { conflicts, openQuestions, valueChanges };

    const entriesById = new Map(entries.map((e) => [String(e.id), e]));

    // Partition: tražbina entries go through lifecycle handling; everything
    // else mirrors money-flow grouping.
    const standardEntries = entries.filter((e) => e.assetType !== 'tražbina');
    const trazbinaEntries = entries.filter((e) => e.assetType === 'tražbina');

    // --- 1. Non-tražbina: group by description + assetType; divergent
    // value/transferee → conflict (same shape as reconcileMoneyFlows). ---
    const groups = new Map();
    for (const entry of standardEntries) {
        const key = propertyGroupKey(entry);
        if (!key) continue;
        const groupKey = `${entry.currency || 'UNKNOWN'}::${key}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(entry);
    }
    for (const [groupKey, groupEntries] of groups) {
        if (groupEntries.length < 2) continue;
        const values = groupEntries.map((e) => e.value).filter((v) => Number.isFinite(v));
        const transferees = [...new Set(groupEntries.map((e) => String(e.transferee || '').trim()).filter(Boolean))];
        const valueDiverges = values.length >= 2 && Math.max(...values) !== Math.min(...values) && Math.abs(Math.max(...values) - Math.min(...values)) > 0.01;
        const transfereeDiverges = transferees.length > 1;
        if (!valueDiverges && !transfereeDiverges) continue;
        const currency = groupKey.split('::')[0];
        conflicts.push({
            finding: `Različiti podaci o istoj imovini (${currency}): ${groupEntries[0].description} — ${groupEntries.map((e) => formatValue(e.value, e.currency)).join(' vs ')}.`,
            reason: `Opis "${groupEntries[0].description}" nosi različite podatke u ${new Set(groupEntries.map((e) => e.fileName).filter(Boolean)).size} dokument(a).`,
            sources: groupEntries.map((e) => e.sourceId).filter(Boolean),
        });
    }

    // --- 2. Tražbina lifecycle: supersedes-linked chains are value-change
    // timelines, NOT conflicts. Unlinked competing claims on the same
    // receivable with different transferees ARE genuine conflicts. ---
    const trazbinaGroups = new Map();
    const ungroupedTrazbina = [];
    for (const entry of trazbinaEntries) {
        const key = propertyGroupKey(entry);
        if (!key) {
            ungroupedTrazbina.push(entry);
            continue;
        }
        const groupKey = `${entry.assetType}::${key}`;
        if (!trazbinaGroups.has(groupKey)) trazbinaGroups.set(groupKey, []);
        trazbinaGroups.get(groupKey).push(entry);
    }

    // Ungroupable (too-generic description) tražbina entries: standalone, never
    // a conflict source on their own.
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

        if (linked.size === groupEntries.length && chainEdges.length > 0) {
            // Fully chained: surface as a value-change timeline finding.
            const sorted = [...groupEntries].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
            const first = sorted[0];
            const last = sorted[sorted.length - 1];
            const originalValue = Number.isFinite(first.value) ? first.value : null;
            const latestValue = Number.isFinite(last.value) ? last.value : null;
            let delta = null;
            let discountPct = null;
            if (originalValue !== null && latestValue !== null) {
                delta = latestValue - originalValue;
                discountPct = originalValue !== 0 ? Number(((delta / originalValue) * 100).toFixed(2)) : null;
            }
            const currency = last.currency || first.currency || '';
            valueChanges.push({
                description: first.description,
                stages: sorted.map((e) => ({
                    id: e.id,
                    eventType: e.eventType || null,
                    value: e.value ?? null,
                    currency: e.currency || null,
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
            });
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
                });
            } else {
                openQuestions.push(
                    `Tražbina "${groupEntries[0].description}" pojavljuje se u ${groupEntries.length} dokument(a) bez povezujućeg lanca — je li riječ o istom potraživanju u različitim fazama?`
                );
            }
        }
    }

    return { conflicts, openQuestions, valueChanges };
}

module.exports = {
    collectPropertyFlows,
    reconcilePropertyFlows,
    normalizeAssetType,
    normalizeEventType,
    VALID_ASSET_TYPES: ['nekretnina', 'pokretnina', 'tražbina', 'drugo'],
    VALID_EVENT_TYPES,
};
