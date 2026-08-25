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
 * @returns {{conflicts: Array<{finding: string, reason: string, sources: string[]}>, openQuestions: string[]}}
 */
function reconcileMoneyFlows(moneyFlow) {
    const conflicts = [];
    const openQuestions = [];
    const entries = Array.isArray(moneyFlow?.entries) ? moneyFlow.entries : [];

    // --- 1. Same-purpose amounts that diverge across documents -------------
    // Group by normalized description key + currency. A divergence here is
    // code-provable: two documents state different numbers for the same item.
    const groups = new Map();
    for (const entry of entries) {
        const key = descriptionKey(entry.description || '');
        if (!key) continue;
        const groupKey = `${entry.currency || 'UNKNOWN'}::${key}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(entry);
    }

    for (const [groupKey, groupEntries] of groups) {
        if (groupEntries.length < 2) continue;
        const amounts = groupEntries.map((entry) => entry.amount);
        const min = Math.min(...amounts);
        const max = Math.max(...amounts);
        const diverges = max > 0 && (max / min > DIVERGENCE_RATIO_THRESHOLD || Math.abs(max - min) > 0.01);
        if (!diverges) continue;

        const currency = groupKey.split('::')[0];
        conflicts.push({
            finding: `Različiti iznosi za istu namjenu (${currency}): ${[...new Set(amounts.map(formatAmount))].join(' vs ')}.`,
            reason: `Prijavljeni opis "${groupEntries[0].description}" nosi različite iznose u ${new Set(groupEntries.map((e) => e.fileName).filter(Boolean)).size} dokument(a).`,
            sources: groupEntries.map((entry) => entry.sourceId).filter(Boolean)
        });
    }

    // --- 2. Stated totals vs sum of parts ----------------------------------
    // Descriptions explicitly marked as totals are checked against the sum of
    // same-currency non-total entries. Mismatch is NOT auto-conflict: the
    // entry set may legitimately be a subset of what the total covers.
    const TOTAL_MARKERS = ['ukupno', 'ukupna', 'svega', 'total'];
    const totalEntries = entries.filter((entry) => {
        const normalized = normalizeText(entry.description || '');
        return TOTAL_MARKERS.some((marker) => normalized.includes(marker));
    });
    const partEntries = entries.filter((entry) => !TOTAL_MARKERS.some((marker) => normalizeText(entry.description || '').includes(marker)));

    for (const totalEntry of totalEntries) {
        const parts = partEntries.filter((part) => (part.currency || 'UNKNOWN') === (totalEntry.currency || 'UNKNOWN'));
        if (parts.length === 0) continue;
        const partsSum = parts.reduce((sum, part) => sum + part.amount, 0);
        if (Math.abs(partsSum - totalEntry.amount) <= 0.01) continue;

        openQuestions.push(
            `Navodni ukupni iznos ${formatAmount(totalEntry.amount)} ${totalEntry.currency || ''} (${totalEntry.fileName || 'nepoznat dokument'}) ne odgovara zbroju ostalih izdvojenih stavki (${formatAmount(partsSum)} ${totalEntry.currency || ''}). Je li ukupnost pokrivala i neprijavljene stavke?`
        );
    }

    return { conflicts, openQuestions };
}

module.exports = { reconcileMoneyFlows };
