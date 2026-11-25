const fs = require('fs');
const os = require('os');
const path = require('path');

const { createSqliteStore } = require('../../services/sqliteStore');
const { buildSnapshot, normalizeQueryValue } = require('../../change-detection/snapshot');
const { diffSnapshots } = require('../../change-detection/diff');
const { parseCsvExport } = require('../../scraper/csvExportParser');

const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'change-detection');
const QUERY = { type: 'oib', value: '6612 4057 408' };
const META = { sourceUrl: 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv', capturedAt: '2026-08-25T10:00:00.000Z' };

function snapshotFrom(name, query = QUERY, capturedAt = META.capturedAt) {
    const parsed = parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
    if (!parsed.ok) throw new Error(`Fixture ${name} failed to parse: ${parsed.reason}`);
    return buildSnapshot(parsed.rows, query, { ...META, capturedAt });
}

describe('SQLite change-detection persistence', () => {
    let dataDir;
    let store;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-detection-sqlite-'));
        store = createSqliteStore({ dataDir });
    });

    afterEach(() => {
        store?.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('returns empty history and no baseline snapshot for an unknown query', () => {
        expect(store.getLatestSnapshot('missing')).toBeNull();
        expect(store.getHistory('missing')).toEqual({ queryId: 'missing', snapshots: [], diffs: [] });
    });

    test('stores latest snapshot and diff history transactionally with normalized query_value', () => {
        const oldSnapshot = snapshotFrom('oib-old.csv');
        const newSnapshot = snapshotFrom('oib-new.csv', QUERY, '2026-08-26T10:00:00.000Z');
        const oldDiff = diffSnapshots(null, oldSnapshot);
        const newDiff = diffSnapshots(oldSnapshot, newSnapshot);

        expect(store.recordCheck(oldSnapshot, oldDiff).ok).toBe(true);
        expect(store.recordCheck(newSnapshot, newDiff).ok).toBe(true);
        expect(store.getLatestSnapshot(oldSnapshot.id)).toMatchObject({
            snapshotId: newSnapshot.snapshotId,
            query: { value: QUERY.value },
        });
        expect(store.getHistory(oldSnapshot.id).snapshots.map((item) => item.snapshotId).sort())
            .toEqual([oldSnapshot.snapshotId, newSnapshot.snapshotId].sort());
        expect(store.getHistory(oldSnapshot.id).diffs).toHaveLength(2);
        expect(store.getHistoryByQueryValue('66124057408').queryId).toBe(oldSnapshot.id);
        expect(store.db.prepare('SELECT DISTINCT query_value FROM change_diffs').pluck().get()).toBe('66124057408');
    });

    test('normalizes case-number query values for indexed history lookups', () => {
        const snapshot = snapshotFrom('oib-old.csv', { type: 'case_number', value: ' ST-2 / 2013 ' });
        store.recordCheck(snapshot, diffSnapshots(null, snapshot));

        const normalized = normalizeQueryValue('case_number', 'st-2 / 2013');
        expect(store.db.prepare('SELECT query_value FROM change_snapshots WHERE query_id = ?').pluck().get(snapshot.id))
            .toBe(normalized);
        expect(store.getHistoryByQueryValue(normalized).queryId).toBe(snapshot.id);
    });

    test('returns a persistence error without throwing when a transaction is invalid', () => {
        expect(() => store.recordCheck({}, {})).not.toThrow();
        expect(store.recordCheck({}, {}).ok).toBe(false);
    });
    test('migrates legacy JSON snapshots and diffs into SQLite without deleting source files', () => {
        const legacyDir = path.join(dataDir, 'legacy-change-detection');
        const snapshot = snapshotFrom('oib-old.csv');
        const diff = diffSnapshots(null, snapshot);
        const archiveDir = path.join(legacyDir, 'history', snapshot.id);
        fs.mkdirSync(path.join(legacyDir, 'snapshots'), { recursive: true });
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'snapshots', `${snapshot.id}.json`), JSON.stringify(snapshot));
        fs.writeFileSync(path.join(archiveDir, 'diffs.jsonl'), `${JSON.stringify(diff)}\n`);

        store.close();
        for (const file of ['analysis.db', 'analysis.db-shm', 'analysis.db-wal']) {
            fs.rmSync(path.join(dataDir, file), { force: true });
        }
        store = createSqliteStore({ dataDir, legacyChangeDetectionDir: legacyDir });

        expect(store.getLatestSnapshot(snapshot.id)).toMatchObject({ snapshotId: snapshot.snapshotId });
        expect(store.getHistory(snapshot.id).diffs).toEqual([diff]);
        expect(fs.existsSync(path.join(legacyDir, 'snapshots', `${snapshot.id}.json`))).toBe(true);
    });

    test('persists registry payloads with an explicit expiration', () => {
        store.putRegistryCache('oib:66124057408', { enrichmentStatus: 'not_found' }, 60_000);
        expect(store.getRegistryCache('oib:66124057408')).toEqual({ enrichmentStatus: 'not_found' });
        expect(store.db.prepare('SELECT expires_at FROM registry_cache WHERE oib_or_key = ?').get('oib:66124057408').expires_at)
            .toBeTruthy();
    });
});
