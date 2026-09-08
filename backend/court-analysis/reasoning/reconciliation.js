// backend/court-analysis/reasoning/reconciliation.js
//
// Purpose: Deterministic who-owes-whom reconciliation over the structured
//          money-flow surface. Cross-checks extracted amounts for duplication
//          and divergence BEFORE any model sees them, so arithmetic facts that
//          code can prove never cost tokens — and never get softened by a
//          model into "possible inconsistencies".
//
// Ownership contract (Gap-1 fix): output lands in pkg.reconciliation and is
// seeded into the report by synthesizeReport; verifyReport then appends its
// own model-found conflicts on top. Reconciliation is never dropped because
// there is exactly one merge point per stage.
//
// Conservative by design: only flag what code can defend (duplicate
// descriptions with divergent amounts, totals that don't match their parts).
// Everything softer stays an openQuestion, not a conflict.

const { normalizeText } = require('./indexer');
const { reconcilePropertyFlows } = require('./propertyFlow');

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
 * Detects deterministic money-flow inconsistencies.
 * @param {object} moneyFlow - Output of collectMoneyFlows (entries carry
 *        {amount, currency, description, fileName, sourceId}).
 * @returns {{conflicts: Array<{finding: string, reason: string, sources: string[], source: string, kind: string}>, openQuestions: Array<{text: string, source: string, kind: string}>}}
 * M-05: conflicts/openQuestions carry `source: 'reconciliation'` + a `kind`
 * so the UI can group code-proven arithmetic mismatches apart from
 * model-speculative questions instead of one flat list.
 */
function reconcileMoneyFlows(moneyFlow) {
    const conflicts = [];
    const openQuestions = [];
    const entries = Array.isArray(moneyFlow?.entries) ? moneyFlow.entries : [];

    // K-03 — all math below runs on the consolidated EUR field, never raw
    // mixed-currency values. Convertible entries (amountEur finite) group by
    // description key on the EUR scale, so an HRK filing and its EUR
    // restatement actually meet; legacy entries without a determinable EUR
    // value keep the old currency-split path instead of being forced into a
    // wrong comparison. (Legacy EUR entries merge with the EUR group — same
    // scale, since amountEur == amount for EUR.)

    // --- 1. Same-purpose amounts that diverge across documents -------------
    // Group by normalized description key + currency. A divergence here is
    // code-provable: two documents state different numbers for the same item.
    const groups = new Map();
    const groupKeyOf = (entry) => {
        const key = descriptionKey(entry.description || '');
        if (!key) return null;
        return Number.isFinite(entry.amountEur) ? `EUR::${key}` : `${entry.currency || 'UNKNOWN'}::${key}`;
    };
    const valueOf = (entry) => (Number.isFinite(entry.amountEur) ? entry.amountEur : entry.amount);
    for (const entry of entries) {
        const key = groupKeyOf(entry);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }

    for (const [groupKey, groupEntries] of groups) {
        if (groupEntries.length < 2) continue;
        const amounts = groupEntries.map(valueOf);
        const min = Math.min(...amounts);
        const max = Math.max(...amounts);
        const diverges = max > 0 && (max / min > DIVERGENCE_RATIO_THRESHOLD || Math.abs(max - min) > 0.01);
        if (!diverges) continue;

        const currency = groupKey.split('::')[0];
        conflicts.push({
            finding: `Različiti iznosi za istu namjenu (${currency}): ${[...new Set(amounts.map(formatAmount))].join(' vs ')}.`,
            reason: `Prijavljeni opis "${groupEntries[0].description}" nosi različite iznose u ${new Set(groupEntries.map((e) => e.fileName).filter(Boolean)).size} dokument(a).`,
            sources: groupEntries.map((entry) => entry.sourceId).filter(Boolean),
            source: 'reconciliation',
            kind: 'arithmetic'
        });
    }

    // --- 2. Stated totals vs sum of parts ----------------------------------
    // Descriptions explicitly marked as totals are checked against the sum of
    // same-currency non-total entries FROM THE SAME DOCUMENT ONLY. A "total"
    // line only ever claims to summarize the other line items in the same
    // filing — comparing it against every non-total entry across the entire
    // case (potentially hundreds of unrelated documents spanning years)
    // produces a meaningless, wildly inflated "sum of parts" and a nonsense
    // openQuestion. Mismatch is still NOT auto-conflict: the entry set may
    // legitimately be a subset of what the total covers.
    const TOTAL_MARKERS = ['ukupno', 'ukupna', 'svega', 'total'];
    const totalEntries = entries.filter((entry) => {
        const normalized = normalizeText(entry.description || '');
        return TOTAL_MARKERS.some((marker) => normalized.includes(marker));
    });
    const partEntries = entries.filter((entry) => !TOTAL_MARKERS.some((marker) => normalizeText(entry.description || '').includes(marker)));

    for (const totalEntry of totalEntries) {
        // K-03: compare on the consolidated EUR scale when the total has one —
        // parts contribute their amountEur; parts without a determinable EUR
        // value cannot join a EUR-scale sum and are skipped for this total.
        // Legacy totals (no amountEur) keep the old same-currency raw path.
        const totalEur = Number.isFinite(totalEntry.amountEur) ? totalEntry.amountEur : null;
        const parts = partEntries.filter((part) =>
            totalEur !== null
                ? Number.isFinite(part.amountEur) && (part.fileName || null) === (totalEntry.fileName || null)
                : (part.currency || 'UNKNOWN') === (totalEntry.currency || 'UNKNOWN') &&
                  (part.fileName || null) === (totalEntry.fileName || null)
        );
        if (parts.length === 0) continue;
        const partsSum = totalEur !== null
            ? parts.reduce((sum, part) => sum + part.amountEur, 0)
            : parts.reduce((sum, part) => sum + part.amount, 0);
        const totalValue = totalEur !== null ? totalEur : totalEntry.amount;
        if (Math.abs(partsSum - totalValue) <= 0.01) continue;

        const shownCurrency = totalEur !== null ? 'EUR' : (totalEntry.currency || '');
        openQuestions.push({
            text: `Navodni ukupni iznos ${formatAmount(totalValue)} ${shownCurrency} (${totalEntry.fileName || 'nepoznat dokument'}) ne odgovara zbroju ostalih izdvojenih stavki iz istog dokumenta (${formatAmount(partsSum)} ${shownCurrency}). Je li ukupnost pokrivala i neprijavljene stavke?`,
            source: 'reconciliation',
            kind: 'arithmetic'
        });
    }

    // --- 3. K-04 tie-break residue: source-stated dual figures that do NOT
    // match the fixed rate. The EUR figure already won outright for all math
    // above; this flags the filing's own inconsistency as its own question.
    for (const entry of entries) {
        if (entry?.currencyNote !== 'dual-mismatch' || !entry?.dualCurrency) continue;
        const { statedEur, statedHrk, deviationPct } = entry.dualCurrency;
        openQuestions.push({
            text: `Dokument ${entry.fileName || 'nepoznat dokument'} navodi dvojni iznos ${formatAmount(statedEur)} EUR (${formatAmount(statedHrk)} HRK) koji ne odgovara fiksnom tečaju 7.53450 (odstupanje ${deviationPct ?? '?'}%). Za izračun je uzet iznos u EUR.`,
            source: 'reconciliation',
            kind: 'arithmetic'
        });
    }

    return { conflicts, openQuestions };
}

module.exports = { reconcileMoneyFlows, reconcilePropertyFlows };
