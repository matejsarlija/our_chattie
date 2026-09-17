// change-detection/service.js
//
// Orchestrates the whole change check (spec §7 write policy):
//   fetch complete CSV export → reduce to snapshot → diff against the stored
//   latest → persist both → return the diff.
//
// Shared by the CLI (`scripts/check-changes.js`, B1) and the REST route
// (`/api/change-detection/*`, B2). Reuses the Phase A `CsvExportClient` for
// acquisition and the localStore-style JSON store for persistence.
//
// Error philosophy: a CSV fetch/parse failure propagates as the typed
// `CsvExportError` so callers map it through `friendlyAnalysisErrorMessage` —
// it must NEVER degrade into a diff that pretends everything was removed. A
// persistence problem, on the other hand, is reported as a warning and never
// fails the check.

const { CsvExportClient, CsvExportError } = require('../scraper/csvExportClient');
const { createChangeDetectionStore } = require('./store');
const { buildSnapshot, queryIdFor } = require('./snapshot');
const { diffSnapshots } = require('./diff');

/**
 * @param {object} [options]
 * @param {object} [options.client] - CsvExportClient-compatible (injected in tests).
 * @param {object} [options.store] - Change-detection store (injected in tests).
 * @param {string|Date} [options.now] - Injectable clock for deterministic tests.
 */
function createChangeCheckService(options = {}) {
    const client = options.client || new CsvExportClient();
    const store = options.store || createChangeDetectionStore();
    const now = options.now ? new Date(options.now) : null;

    /**
     * Runs one check for `{ type, value }`.
     *
     * @returns {{ query: object, queryId: string, baseline: boolean,
     *             snapshot: object, previousSnapshotId: string|null,
     *             diff: object, warnings: string[], persisted: object }}
     */
    async function runCheck(query) {
        const type = String((query && query.type) || '').trim().toLowerCase();
        const value = String((query && query.value) || '').trim();

        // 1. COMPLETE acquisition. The export endpoint returns the entire
        // result set in one GET; fetchRawRows applies no forward-window bound —
        // equivalent to maxPages: Infinity. A bounded snapshot would produce
        // false added/removed entries at the boundary (spec §4.3).
        const { rows, exportUrl } = await client.fetchRawRows(value);

        // 2. Reduce to the persisted snapshot shape.
        const snapshot = buildSnapshot(rows, { type, value }, {
            sourceUrl: exportUrl,
            capturedAt: now ? now.toISOString() : undefined
        });

        const warnings = [];

        // Entity-consistency guard (spec §9.5): an OIB query whose export does
        // not contain the queried debtor suggests drift/wrong entity. Warned,
        // never silently flattened.
        if (type === 'oib' && /^[0-9]{11}$/.test(value.replace(/\D+/g, ''))) {
            const normalizedOib = value.replace(/\D+/g, '');
            if (snapshot.debtorOibs.length > 0 && !snapshot.debtorOibs.includes(normalizedOib)) {
                warnings.push(`entity-mismatch: queried OIB ${normalizedOib} not among observed debtor OIBs (${snapshot.debtorOibs.join(', ')})`);
            }
        }

        // 3. Diff against the latest stored snapshot (null on first run →
        // baseline diff with everything added).
        const previous = store.getLatestSnapshot(snapshot.id);
        const diff = diffSnapshots(previous, snapshot);

        // 4. Persist both halves. Store errors are reported, never fatal.
        const persisted = store.recordCheck(snapshot, diff);
        if (!persisted.ok) {
            warnings.push('persistence-failed: the check result could not be saved locally');
        }

        return {
            query: { type: snapshot.query.type, value: snapshot.query.value },
            queryId: snapshot.id,
            baseline: diff.baseline === true,
            snapshot: {
                snapshotId: snapshot.snapshotId,
                capturedAt: snapshot.capturedAt,
                sourceUrl: snapshot.sourceUrl,
                rowCount: snapshot.rowCount,
                entryCount: Object.keys(snapshot.entries).length,
                debtorOibs: snapshot.debtorOibs
            },
            previousSnapshotId: previous ? previous.snapshotId : null,
            diff,
            warnings,
            persisted
        };
    }

    return {
        runCheck,
        queryIdFor,
        store,
        client
    };
}

module.exports = {
    createChangeCheckService,
    CsvExportError
};
