// court-analysis/utils/stratify.js
//
// Stratified budget allocation for bounded analysis depth (spec §6 / ticket
// TS-2). A fixed entry budget is ALLOCATED across meaningful dimensions —
// document roles (§6.2, `docRoles.js`) and time buckets (§6.3) — never sliced
// off the top. Pure function: no I/O, no model calls, fully deterministic.
//
// Pipeline position: AFTER grouping (operates on one analyzed cluster's
// entries), BEFORE download/reasoning. Track 0's 30-newest-plus-10-oldest is
// the two-strata special case of this allocator (recent + origin); the
// allocator additionally guarantees ledger documents, middle-year chain
// witnesses, and an explicit exploratory reserve.
//
// Every pick is tagged `{ sampling, stratum, stratumReason }` on a copied
// `acquisition` object. `sampling` reuses the forward/tail vocabulary
// (`origin` → tail, `recent` → forward, everything else null) so existing
// provenance consumers keep working.

const { parseCaseDateToTimestamp } = require('./caseDate');
const { classifyDocRole } = require('./docRoles');
const {
    SCAN_DEPTH_STANDARD_ENTRIES,
    SCAN_DEPTH_TAIL_ENTRIES
} = require('./scanDepth');

const STRAT_ORIGIN_KEEP = 8;
const STRAT_RECENT_KEEP = 22;
const STRAT_OTHER_FLOOR = 2;
const STRAT_ADMIN_CAP = 4;
const STRAT_BUDGET_DEFAULT = SCAN_DEPTH_STANDARD_ENTRIES + SCAN_DEPTH_TAIL_ENTRIES;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function entryTimestamp(entry) {
    const raw = entry?.caseInfo?.date || entry?.caseInfo?.datePublished || entry?.date || null;
    return parseCaseDateToTimestamp(raw);
}

function tag(entry, sampling, stratum, stratumReason) {
    return {
        ...entry,
        acquisition: {
            ...(entry?.acquisition || {}),
            sampling,
            stratum,
            stratumReason
        }
    };
}

/**
 * Allocates `budget` entry slots across role/time strata.
 *
 * @param {Array<object>} clusterEntries - One case's discovery entries (any order).
 * @param {object} [options] - `{ budget }` (default 40).
 * @returns {{ entries: Array, ledger: object, capped: boolean }}
 *   `entries` are tagged copies in pick order (ledger, origin, recent,
 *   exploratory, middle, spread, undated, admin, fill); `ledger` is the
 *   persisted coverage record; `capped` reports whether the budget bound.
 *   Under-budget pools return the same refs untagged.
 */
function stratifyClusterEntries(clusterEntries, options = {}) {
    const budget = Number.isFinite(options.budget) && options.budget >= 0
        ? Math.floor(options.budget)
        : STRAT_BUDGET_DEFAULT;
    const pool = Array.isArray(clusterEntries) ? clusterEntries : [];
    const taken = new Set();
    const picks = [];

    const dated = [];
    const undated = [];
    pool.forEach((entry, position) => {
        const timestamp = entryTimestamp(entry);
        const item = { entry, position, timestamp, role: classifyDocRole(entry) };
        (timestamp === null ? undated : dated).push(item);
    });
    dated.sort((a, b) => a.timestamp - b.timestamp);

    // Under budget the full pool passes through UNTOUCHED (same refs, no
    // tags); the ledger still records complete coverage.
    if (pool.length <= budget) {
        const allPicks = [...dated, ...undated].map((item) => ({
            item,
            stratum: 'pool',
            reason: 'under budget: full pool passes through'
        }));
        return {
            entries: pool,
            ledger: buildCoverageLedger(pool, dated, undated, allPicks, budget, null),
            capped: false
        };
    }

    const take = (item, stratum, reason) => {
        if (taken.has(item.position)) return false;
        if (picks.length >= budget) return false;
        taken.add(item.position);
        picks.push({ item, stratum, reason });
        return true;
    };
    const remaining = () => budget - picks.length;
    const isAdmin = (item) => item.role === 'admin';

    // 1. Ledger documents that fit. Overflow names every excluded vital
    // document instead of silently dropping it (§6.4 vital-overflow contract).
    const ledger = dated.filter((item) => item.role === 'ledger')
        .concat(undated.filter((item) => item.role === 'ledger'));
    let vitalOverflow = null;
    if (ledger.length > budget) {
        const kept = [...ledger]
            .sort((a, b) => (b.timestamp ?? -Infinity) - (a.timestamp ?? -Infinity))
            .slice(0, budget);
        for (const item of kept) take(item, 'ledger', 'vital document (overflow priority: newest first)');
        vitalOverflow = {
            insufficient: true,
            excludedVital: ledger
                .filter((item) => !taken.has(item.position))
                .map((item) => describeEntry(item))
        };
    } else {
        for (const item of ledger) take(item, 'ledger', 'vital document: register, distribution list, or final account');
    }

    // 2. Origin: oldest dated entries (the Track-0 tail, now explicit).
    // Ambiguous `other` entries are skipped here and in recent: the
    // exploratory floor below owns them, otherwise recent windows swallow
    // them and the floor starves exactly when ambiguous titles are newest.
    for (const item of dated) {
        if (remaining() <= 0 || originTaken(picks) >= STRAT_ORIGIN_KEEP) break;
        if (item.role === 'other' || isAdmin(item)) continue;
        take(item, 'origin', 'origin context: oldest filings of the case');
    }

    // 3. Recent: newest dated entries (current-state lens).
    for (const item of [...dated].reverse()) {
        if (remaining() <= 0 || recentTaken(picks) >= STRAT_RECENT_KEEP) break;
        if (item.role === 'other' || isAdmin(item)) continue;
        take(item, 'recent', 'current state: newest filings of the case');
    }

    // 4. Exploratory reserve floor: ambiguous `other` entries, newest + oldest
    // first for spread. Post-acquisition excerpt classification spends
    // against this reserve (seam documented in docRoles.js).
    const others = dated.filter((item) => item.role === 'other' && !taken.has(item.position));
    if (others.length > 0 && remaining() > 0) {
        const candidates = [others[others.length - 1], others[0]].filter(Boolean);
        for (const item of candidates.slice(0, STRAT_OTHER_FLOOR)) {
            if (remaining() <= 0) break;
            take(item, 'exploratory', 'exploratory reserve: ambiguous metadata, pending excerpt classification');
        }
    }

    // 5. Middle round-robin: decisions + transfers per calendar year, no
    // empty year while slots last (chain-link witnesses).
    const middlePool = dated.filter((item) =>
        !taken.has(item.position) && (item.role === 'decision' || item.role === 'transfer')
    );
    const byYear = new Map();
    for (const item of middlePool) {
        const year = new Date(item.timestamp).getUTCFullYear();
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(item);
    }
    const years = [...byYear.keys()].sort((a, b) => a - b);
    let progressed = true;
    while (remaining() > 0 && progressed) {
        progressed = false;
        for (const year of years) {
            if (remaining() <= 0) break;
            const next = (byYear.get(year) || []).find((item) => !taken.has(item.position));
            if (next && take(next, 'middle', `chain witness: ${next.role} from ${year}`)) progressed = true;
        }
    }

    // 6. Spread fill: evenly spaced picks across untaken dated entries.
    spreadFill(
        dated.filter((item) => !isAdmin(item)),
        taken,
        picks,
        budget,
        'spread',
        'chronological spread across uncovered spans',
        take
    );

    // 7. Undated entries in pool order (unorderable, but acquired).
    for (const item of undated) {
        if (remaining() <= 0) break;
        if (isAdmin(item)) continue;
        take(item, 'spread', 'undated entry: unorderable, included for coverage');
    }

    // 8. Admin cap, then anything left newest-first.
    const admins = pool
        .map((entry, position) => ({ entry, position, timestamp: entryTimestamp(entry), role: classifyDocRole(entry) }))
        .filter((item) => item.role === 'admin' && !taken.has(item.position));
    let adminTakenCount = 0;
    for (const item of admins) {
        if (remaining() <= 0 || adminTakenCount >= STRAT_ADMIN_CAP) break;
        if (take(item, 'admin', 'administrative filing within cap')) adminTakenCount += 1;
    }
    const poolNewestFirst = pool
        .map((entry, position) => position)
        .filter((position) => !taken.has(position) && classifyDocRole(pool[position]) !== 'admin')
        .sort((a, b) => {
            const ta = entryTimestamp(pool[a]);
            const tb = entryTimestamp(pool[b]);
            if (ta === null && tb === null) return a - b;
            if (ta === null) return 1;
            if (tb === null) return -1;
            return tb - ta;
        });
    for (const position of poolNewestFirst) {
        if (remaining() <= 0) break;
        const timestamp = entryTimestamp(pool[position]);
        take(
            { entry: pool[position], position, timestamp, role: classifyDocRole(pool[position]) },
            'fill',
            'budget remainder: newest untaken entry'
        );
    }

    const entries = picks.map(({ item, stratum, reason }) => tag(
        item.entry,
        stratum === 'origin' ? 'tail' : stratum === 'recent' ? 'forward' : (item.entry?.acquisition?.sampling ?? null),
        stratum,
        reason
    ));

    return { entries, ledger: buildCoverageLedger(pool, dated, undated, picks, budget, vitalOverflow), capped: pool.length > budget };
}

function originTaken(picks) {
    return picks.filter((p) => p.stratum === 'origin').length;
}

function recentTaken(picks) {
    return picks.filter((p) => p.stratum === 'recent').length;
}

function spreadFill(dated, taken, picks, budget, stratum, reason, take) {
    const untaken = dated.filter((item) => !taken.has(item.position));
    if (untaken.length === 0) return;
    const slots = budget - picks.length;
    if (slots <= 0) return;
    if (untaken.length <= slots) {
        for (const item of untaken) take(item, stratum, reason);
        return;
    }
    const step = untaken.length / slots;
    const chosen = new Set();
    for (let i = 0; i < slots; i += 1) {
        chosen.add(Math.floor(i * step));
    }
    untaken.forEach((item, index) => {
        if (chosen.has(index)) take(item, stratum, reason);
    });
}

function describeEntry(item) {
    const links = Array.isArray(item.entry?.documentLinks) ? item.entry.documentLinks : [];
    return {
        date: item.entry?.caseInfo?.date || item.entry?.caseInfo?.datePublished || null,
        title: item.entry?.caseInfo?.title || null,
        fileNames: links.map((link) => link?.text).filter((text) => typeof text === 'string' && text)
    };
}

function buildCoverageLedger(pool, dated, undated, picks, budget, vitalOverflow) {
    const takenPositions = new Set(picks.map((p) => p.item.position));
    const perRole = {};
    const register = (role, selected) => {
        if (!perRole[role]) perRole[role] = { available: 0, selected: 0 };
        perRole[role].available += 1;
        if (selected) perRole[role].selected += 1;
    };
    const allItems = [
        ...dated.map((item) => ({ ...item, undated: false })),
        ...undated.map((item) => ({ ...item, undated: true }))
    ];
    for (const item of allItems) register(item.role, takenPositions.has(item.position));

    const perYear = {};
    const yearOf = (timestamp) => new Date(timestamp).getUTCFullYear();
    for (const item of dated) {
        const year = yearOf(item.timestamp);
        if (!perYear[year]) perYear[year] = { available: 0, selected: 0 };
        perYear[year].available += 1;
        if (takenPositions.has(item.position)) perYear[year].selected += 1;
    }
    const undatedAvailable = undated.length;
    const undatedSelected = undated.filter((item) => takenPositions.has(item.position)).length;

    const gaps = [];
    for (const year of Object.keys(perYear).sort()) {
        if (perYear[year].selected === 0 && perYear[year].available > 0) {
            gaps.push(`${year}: 0/${perYear[year].available} selected`);
        }
    }
    if (undatedAvailable > 0 && undatedSelected === 0) {
        gaps.push(`undated: 0/${undatedAvailable} selected`);
    }

    // Chain-link candidates: transfer-role entries imply lifecycle links may
    // exist. The unresolved-supersedes RATE itself is computed
    // post-reconciliation (entries carry no supersedes references at
    // discovery); the ledger records only that candidates are in scope.
    const transferEntries = allItems.filter((item) => item.role === 'transfer').length;

    return {
        budget,
        available: pool.length,
        selected: picks.length,
        insufficient: vitalOverflow ? vitalOverflow.insufficient : false,
        excludedVital: vitalOverflow ? vitalOverflow.excludedVital : [],
        perRole,
        perYear,
        undated: { available: undatedAvailable, selected: undatedSelected },
        gaps,
        chainCandidates: {
            transferEntries,
            note: 'discovery entries carry no supersedes references; the unresolved-link rate resolves post-reconciliation'
        }
    };
}

module.exports = {
    stratifyClusterEntries,
    STRAT_ORIGIN_KEEP,
    STRAT_RECENT_KEEP,
    STRAT_OTHER_FLOOR,
    STRAT_ADMIN_CAP,
    STRAT_BUDGET_DEFAULT
};
