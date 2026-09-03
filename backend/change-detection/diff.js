// change-detection/diff.js
//
// Deterministic snapshot comparison: classifies every stable `Oglas (link)`
// GUID across two ChangeSnapshots as added / removed / modified / unchanged,
// with per-field before/after for modifications and an entityDrift guard when
// the observed debtor OIB sets disagree. PURE: no I/O, no model calls — this is
// the unit-test anchor of Phase B (spec §4.4/§6).

const COMPARED_FIELDS = ['documentFiles', 'title', 'publicationEnd'];

function normalizePublicationEnd(value) {
    const text = String(value == null ? '' : value).trim();
    return text === '' ? null : text;
}

function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    return a.every((item, index) => item === b[index]);
}

/**
 * Field-level comparison. Returns the list of fields whose values differ.
 * - documentFiles: ordered array comparison (a rename or page-count change IS
 *   a change).
 * - publicationEnd: empty string and null are equivalent after trimming.
 * - title: trimmed string comparison.
 * - date/caseNumber are deliberately NOT compared: immutable for a GUID in
 *   practice, so comparing them would only produce noise (spec §6).
 */
function changedFieldsBetween(before, after) {
    const changed = [];
    if (!arraysEqual(before.documentFiles, after.documentFiles)) {
        changed.push('documentFiles');
    }
    if (String(before.title || '').trim() !== String(after.title || '').trim()) {
        changed.push('title');
    }
    if (normalizePublicationEnd(before.publicationEnd) !== normalizePublicationEnd(after.publicationEnd)) {
        changed.push('publicationEnd');
    }
    return changed;
}

function sameDebtorOibs(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        return false;
    }
    const left = [...a].sort();
    const right = [...b].sort();
    return left.every((oib, index) => oib === right[index]);
}

function sortedKeys(entries) {
    return Object.keys(entries || {}).sort();
}

/**
 * Diffs two snapshots.
 *
 * @param {object|null} oldSnapshot - The stored latest snapshot (null on first run).
 * @param {object} newSnapshot - The freshly captured snapshot.
 * @param {{ now?: Date|string }} [options] - Injectable clock for tests.
 * @returns {ChangeDiff}
 */
function diffSnapshots(oldSnapshot, newSnapshot, options = {}) {
    if (!newSnapshot || typeof newSnapshot !== 'object' || !newSnapshot.entries) {
        throw new Error('diffSnapshots requires a newSnapshot with an entries map.');
    }

    const computedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();

    // First run: there is no prior state to compare against, so the result is
    // flagged `baseline` instead of pretending "everything was removed".
    if (!oldSnapshot || typeof oldSnapshot !== 'object' || !oldSnapshot.entries) {
        const addedGuids = sortedKeys(newSnapshot.entries);
        return {
            id: `baseline-${newSnapshot.snapshotId || 'unknown'}`,
            query: newSnapshot.query,
            fromSnapshotId: null,
            toSnapshotId: newSnapshot.snapshotId || null,
            computedAt,
            baseline: true,
            entityDrift: false,
            counts: { added: addedGuids.length, removed: 0, modified: 0, unchanged: 0 },
            added: addedGuids,
            removed: [],
            modified: []
        };
    }

    const oldEntries = oldSnapshot.entries;
    const newEntries = newSnapshot.entries;

    const added = [];
    const removed = [];
    const modified = [];
    let unchangedCount = 0;

    for (const guid of sortedKeys(oldEntries)) {
        if (!Object.prototype.hasOwnProperty.call(newEntries, guid)) {
            removed.push(guid);
        }
    }

    for (const guid of sortedKeys(newEntries)) {
        const after = newEntries[guid];
        const before = oldEntries[guid];
        if (!Object.prototype.hasOwnProperty.call(oldEntries, guid)) {
            added.push(guid);
            continue;
        }

        const changedFields = changedFieldsBetween(before, after);
        if (changedFields.length === 0) {
            unchangedCount += 1;
            continue;
        }

        const beforeView = {};
        const afterView = {};
        for (const field of changedFields) {
            beforeView[field] = before[field];
            afterView[field] = after[field];
        }
        modified.push({ guid, changedFields, before: beforeView, after: afterView });
    }

    const fromSnapshotId = oldSnapshot.snapshotId || null;
    const toSnapshotId = newSnapshot.snapshotId || null;

    return {
        id: `${fromSnapshotId || 'unknown'}-${toSnapshotId || 'unknown'}`,
        query: newSnapshot.query,
        fromSnapshotId,
        toSnapshotId,
        computedAt,
        baseline: false,
        // Entity drift rides alongside the entry-level results — it warns that
        // the two snapshots may describe different entities (query drift /
        // wrong entity), it never suppresses the diff.
        entityDrift: !sameDebtorOibs(oldSnapshot.debtorOibs, newSnapshot.debtorOibs),
        counts: {
            added: added.length,
            removed: removed.length,
            modified: modified.length,
            unchanged: unchangedCount
        },
        added,
        removed,
        modified
    };
}

/** True when the diff reports any change at all (added/removed/modified). */
function hasChanges(diff) {
    return Boolean(
        diff
        && (
            diff.baseline === true
            || diff.counts.added > 0
            || diff.counts.removed > 0
            || diff.counts.modified > 0
        )
    );
}

module.exports = {
    diffSnapshots,
    hasChanges,
    changedFieldsBetween,
    COMPARED_FIELDS
};
