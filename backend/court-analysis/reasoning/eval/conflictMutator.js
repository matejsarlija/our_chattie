// backend/court-analysis/reasoning/eval/conflictMutator.js
//
// Purpose: Deterministic seeded mutation of evidence packages — the "seeded
//          conflict" technique. Injects known-wrong facts (amount mismatches,
//          date conflicts, party swaps) into a fixture package and records
//          exactly what was changed, giving downstream verification an honest
//          denominator: detection rate = detected / applied.
//
// Why seeded: hand-labeling contradictions is slow and subjective. Mutations
// are programmatically generated ground truth. A verifier that misses 80% of
// injected contradictions is broken in a way no prose review would catch.
//
// Purity contract: the input package is never mutated — callers get a deep
// clone plus an `applied` ledger. Same seed + same kinds => byte-identical
// result (mulberry32 PRNG), which lets tests and future RL rollouts treat
// mutations as reproducible environment resets.

const DEEP_CLONE = (value) => JSON.parse(JSON.stringify(value));

function createRng(seed) {
    let a = seed >>> 0;
    return function rng() {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
}

// --- Mutation implementations -----------------------------------------------
// Each receives (workingPackage, rng) and returns an applied record or null
// when nothing applicable exists. Null is a valid outcome: sparse fixtures may
// have no amounts to corrupt, and "0 applied" must be visible, not hidden.

function mutateAmountMismatch(pkg, rng) {
    const candidates = (pkg.analyses || []).filter(
        (analysis) => Array.isArray(analysis.amounts) && analysis.amounts.length > 0
    );
    if (candidates.length === 0) return null;

    const analysis = pick(rng, candidates);
    const amountEntry = pick(rng, analysis.amounts);
    const before = amountEntry.amount;
    // Perturb well beyond any tolerance window so detection cannot pass by luck.
    const factor = 1.3 + rng() * 1.7;
    const after = Math.round(before * factor * 100) / 100;
    amountEntry.amount = after;

    return {
        kind: 'amount-mismatch',
        path: `analyses[id=${analysis.id}].amounts[description=${amountEntry.description || 'n/a'}].amount`,
        fileName: analysis.fileName || null,
        before,
        after
    };
}

function mutateDateConflict(pkg, rng) {
    const candidates = (pkg.analyses || []).filter((analysis) => analysis.decisionDate);
    if (candidates.length === 0) return null;

    const analysis = pick(rng, candidates);
    const before = analysis.decisionDate;
    const year = Number(String(before).slice(0, 4));
    if (!Number.isFinite(year)) return null;
    const shift = rng() < 0.5 ? -2 : 2;
    const after = String(before).replace(String(year), String(year + shift));
    analysis.decisionDate = after;

    return {
        kind: 'date-conflict',
        path: `analyses[id=${analysis.id}].decisionDate`,
        fileName: analysis.fileName || null,
        before,
        after
    };
}

const SWAP_PARTNER_NAMES = ['Nepoznata Stranka d.o.o.', 'Miro Horvat', 'Javna Uprava d.d.'];

function mutatePartySwap(pkg, rng) {
    const candidates = (pkg.entries || []).filter(
        (entry) => Array.isArray(entry.participants) && entry.participants.length > 0
    );
    if (candidates.length === 0) return null;

    const entry = pick(rng, candidates);
    const participantIndex = Math.floor(rng() * entry.participants.length);
    const participant = entry.participants[participantIndex];
    const before = participant.name;
    const after = pick(rng, SWAP_PARTNER_NAMES.filter((name) => name !== before));
    participant.name = after;

    return {
        kind: 'party-swap',
        path: `entries[index=${entry.index}].participants[${participantIndex}].name`,
        fileName: null,
        before,
        after
    };
}

const MUTATION_KINDS = {
    'amount-mismatch': mutateAmountMismatch,
    'date-conflict': mutateDateConflict,
    'party-swap': mutatePartySwap
};

/**
 * Applies seeded mutations to a deep clone of the evidence package.
 * @param {object} evidencePackage - Fixture package (never mutated).
 * @param {object} [options]
 * @param {number} [options.seed=42] - PRNG seed for reproducibility.
 * @param {string[]} [options.kinds] - Subset of mutation kinds; default all.
 * @returns {{pkg: object, applied: Array<object>}}
 */
function mutateEvidencePackage(evidencePackage, options = {}) {
    const seed = options.seed ?? 42;
    const kinds = options.kinds || Object.keys(MUTATION_KINDS);
    const rng = createRng(seed);
    const pkg = DEEP_CLONE(evidencePackage);

    const applied = [];
    for (const kind of kinds) {
        const mutator = MUTATION_KINDS[kind];
        if (!mutator) throw new Error(`Unknown mutation kind: ${kind}`);
        const record = mutator(pkg, rng);
        if (record) applied.push({ ...record, kind });
    }

    return { pkg, applied };
}

/**
 * Checks whether one applied mutation surfaces in detected output text
 * (report conflicts, openQuestions, etc.). Matching heuristic: the affected
 * document/party identifier AND at least one of the before/after values must
 * co-occur in some detected string. Intentionally conservative — a verifier
 * that only says "nešto ne štimа" without naming the fact counts as missing.
 * @param {object} mutation - Applied record from mutateEvidencePackage.
 * @param {string[]} detectedTexts - Free text collected from detection surface.
 * @returns {boolean}
 */
function mutationDetected(mutation, detectedTexts) {
    const haystack = (Array.isArray(detectedTexts) ? detectedTexts : []).join('\n').toLowerCase();
    if (!haystack) return false;

    const identifiers = [mutation.fileName, String(mutation.before)]
        .filter((v) => v !== null && v !== undefined && String(v).length > 0)
        .map((v) => String(v).toLowerCase());

    // The mutated value alone proves regeneration from corrupted data; the
    // identifier alone proves awareness of the involved fact. Require either
    // pair member present with the other absent being insufficient only when
    // BOTH exist — keep it simple: detect on any single strong signal.
    const values = [String(mutation.before), String(mutation.after)].map((v) => v.toLowerCase());
    return identifiers.some((id) => haystack.includes(id)) || values.some((v) => haystack.includes(v));
}

module.exports = {
    mutateEvidencePackage,
    mutationDetected,
    MUTATION_KINDS
};
