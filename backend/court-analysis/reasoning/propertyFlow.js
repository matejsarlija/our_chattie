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

const { normalizeCurrency, parseAmount, parseDualFromQuote, cleanText } = require('./moneyFlow');
const { convertToEur, dualMismatch } = require('./currencyConversion');
const { findCitationLinkedPairs } = require('./citationGraph');
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

// K-02/K-04 for property values: same consolidated-EUR + dual-preference
// semantics as moneyFlow's amountEur. No value → no EUR fields at all.
function buildValueEur(raw, value) {
    if (!Number.isFinite(value)) return {};
    const currency = normalizeCurrency(raw?.currency ?? raw?.valuta) || null;
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
    if (valueEur === null) return {};
    return { valueEur, valueEurSource: currency === 'EUR' ? 'as-is' : 'converted' };
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
        ...buildValueEur(raw, value),
        // J-03 — payment-priority rank (tražbina isplatni red).
        isplatniRed: cleanText(raw.isplatniRed ?? raw.isplatni_red ?? raw.paymentRank),
        // J-04 — real claim/filing identifiers (seed for Epic L ID-first resolution).
        claimRegistryNumber: cleanText(raw.claimRegistryNumber ?? raw.redniBroj ?? raw.redni_broj),
        filingReference: cleanText(raw.filingReference ?? raw.poslovniBroj ?? raw.poslovni_broj),
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
    const sorted = [...groupEntries].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
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
 * Deterministic property-flow reconciliation, mirroring reconcileMoneyFlows
 * grouping/conflict philosophy with a distinct tražbina lifecycle path.
 *
 * @param {object} propertyFlow - Output of collectPropertyFlows.
 * @param {object} [context] - Optional `{ analyses }` (normalized analyses
 * carrying `citedFilingReferences`); enables the L-02 citation-link signal.
 * @returns {{conflicts: Array, openQuestions: Array<{text: string, source: string, kind: string}>, valueChanges: Array<object>}}
 */
function reconcilePropertyFlows(propertyFlow, context = {}) {
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

    // K-03: value comparison runs on the consolidated EUR scale when both
    // sides have one (valueEur ?? value), mirroring reconcileMoneyFlows.
    const effectiveValue = (e) => (Number.isFinite(e.valueEur) ? e.valueEur : e.value);

    // --- 1. Non-tražbina: group by description + assetType; divergent
    // value/transferee → conflict (same shape as reconcileMoneyFlows). ---
    const groups = new Map();
    for (const entry of standardEntries) {
        const key = propertyGroupKey(entry);
        if (!key) continue;
        const scale = Number.isFinite(entry.valueEur) ? 'EUR' : (entry.currency || 'UNKNOWN');
        const groupKey = `${scale}::${key}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(entry);
    }
    for (const [groupKey, groupEntries] of groups) {
        if (groupEntries.length < 2) continue;
        const values = groupEntries.map(effectiveValue).filter((v) => Number.isFinite(v));
        const transferees = [...new Set(groupEntries.map((e) => String(e.transferee || '').trim()).filter(Boolean))];
        const valueDiverges = values.length >= 2 && Math.max(...values) !== Math.min(...values) && Math.abs(Math.max(...values) - Math.min(...values)) > 0.01;
        const transfereeDiverges = transferees.length > 1;
        if (!valueDiverges && !transfereeDiverges) continue;
        const currency = groupKey.split('::')[0];
        conflicts.push({
            finding: `Različiti podaci o istoj imovini (${currency}): ${groupEntries[0].description} — ${groupEntries.map((e) => formatValue(effectiveValue(e), Number.isFinite(e.valueEur) ? 'EUR' : e.currency)).join(' vs ')}.`,
            reason: `Opis "${groupEntries[0].description}" nosi različite podatke u ${new Set(groupEntries.map((e) => e.fileName).filter(Boolean)).size} dokument(a).`,
            sources: groupEntries.map((e) => e.sourceId).filter(Boolean),
            source: 'reconciliation',
            kind: 'property',
        });
    }

    // --- 2. Tražbina lifecycle: supersedes-linked chains are value-change
    // timelines, NOT conflicts. Unlinked competing claims on the same
    // receivable with different transferees ARE genuine conflicts. ---
    //
    // L-01 — ID-first: entries sharing a stable `claimRegistryNumber` (J-04)
    // are the SAME registered claim by definition and form a timeline
    // directly, without any fuzzy description grouping. Only entries without
    // a shared registry number fall through to the description path below.
    const registryClusters = new Map();
    const registryConsumed = new Set();
    for (const entry of trazbinaEntries) {
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
        trazbinaEntries.filter((e) => !registryConsumed.has(e.id)),
        context?.analyses
    );
    const citationKey = (a, b) => [String(a.id), String(b.id)].sort().join('::');

    const trazbinaGroups = new Map();
    const ungroupedTrazbina = [];
    for (const entry of trazbinaEntries) {
        if (registryConsumed.has(entry.id)) continue;
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

    // K-04 tie-break residue (property side): same semantics as the money-flow
    // section 3 — EUR won outright; flag the filing's own inconsistency.
    for (const entry of entries) {
        if (entry?.currencyNote !== 'dual-mismatch' || !entry?.dualCurrency) continue;
        const { statedEur, statedHrk, deviationPct } = entry.dualCurrency;
        openQuestions.push({
            text: `Dokument ${entry.fileName || 'nepoznat dokument'} navodi dvojni iznos ${formatValue(statedEur, 'EUR')} (${formatValue(statedHrk, 'HRK')}) koji ne odgovara fiksnom tečaju 7.53450 (odstupanje ${deviationPct ?? '?'}%). Za izračun je uzet iznos u EUR.`,
            source: 'reconciliation',
            kind: 'property',
        });
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
