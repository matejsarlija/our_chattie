const fs = require('fs');
const os = require('os');
const path = require('path');

const { createChangeDetectionStore } = require('../change-detection/store');
const { buildSnapshot } = require('../change-detection/snapshot');
const { diffSnapshots } = require('../change-detection/diff');
const { parseCsvExport } = require('../scraper/csvExportParser');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'change-detection');
const QUERY = { type: 'oib', value: '66124057408' };
const META = { sourceUrl: 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv', capturedAt: '2026-08-25T10:00:00.000Z' };

function snapshotFrom(name) {
    const parsed = parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
    if (!parsed.ok) {
        throw new Error(`Fixture ${name} failed to parse: ${parsed.reason}`);
    }
    return buildSnapshot(parsed.rows, QUERY, META);
}

describe('createChangeDetectionStore (H-03)', () => {
    let baseDir;

    beforeEach(() => {
        baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-detection-store-'));
    });

    afterEach(() => {
        fs.rmSync(baseDir, { recursive: true, force: true });
    });

    function makeStore() {
        return createChangeDetectionStore({ dataDir: baseDir });
    }

    test('reads return null cleanly when no prior snapshot exists', () => {
        expect(makeStore().getLatestSnapshot('nope')).toBeNull();
        expect(makeStore().getHistory('nope')).toEqual({ queryId: 'nope', snapshots: [], diffs: [] });
    });

    test('saves and reloads the latest snapshot under snapshots/<queryId>.json', () => {
        const store = makeStore();
        const snapshot = snapshotFrom('oib-old.csv');

        const result = store.saveSnapshot(snapshot);
        expect(result.ok).toBe(true);
        expect(result.archived).toBe(true);

        const loaded = store.getLatestSnapshot(snapshot.id);
        expect(loaded.entries).toEqual(snapshot.entries);
        expect(loaded.snapshotId).toBe(snapshot.snapshotId);

        expect(fs.existsSync(path.join(baseDir, 'snapshots', `${snapshot.id}.json`))).toBe(true);
        expect(fs.existsSync(path.join(baseDir, 'history', snapshot.id, `${snapshot.snapshotId}.json`))).toBe(true);
    });

    test('overwrites the latest file but archives each distinct snapshotId once', () => {
        const store = makeStore();
        const old = snapshotFrom('oib-old.csv');
        const next = snapshotFrom('oib-new.csv');
        expect(next.id).toBe(old.id); // same query identity

        store.saveSnapshot(old);
        store.saveSnapshot(next);

        expect(store.getLatestSnapshot(old.id).snapshotId).toBe(next.snapshotId);
        const history = store.getHistory(old.id);
        expect(history.snapshots.map((s) => s.snapshotId).sort())
            .toEqual([old.snapshotId, next.snapshotId].sort());

        // Re-saving an unchanged export must not duplicate history.
        store.saveSnapshot(next);
        expect(store.getHistory(old.id).snapshots).toHaveLength(2);
    });

    test('appends diffs to history/<queryId>/diffs.jsonl and reads them back', () => {
        const store = makeStore();
        const old = snapshotFrom('oib-old.csv');
        const next = snapshotFrom('oib-new.csv');
        const diff = diffSnapshots(old, next, { now: '2026-08-26T00:00:00.000Z' });

        expect(store.appendDiff(old.id, diff).ok).toBe(true);
        expect(store.appendDiff(old.id, { ...diff, id: `${diff.id}-again` }).ok).toBe(true);

        const diffs = store.getHistory(old.id).diffs;
        expect(diffs).toHaveLength(2);
        expect(diffs[0].counts.added).toBe(diff.counts.added);
        expect(diffs[0].computedAt).toBe('2026-08-26T00:00:00.000Z');
    });

    test('recordCheck persists both halves and reports success', () => {
        const store = makeStore();
        const snapshot = snapshotFrom('oib-old.csv');
        const diff = diffSnapshots(null, snapshot);

        const result = store.recordCheck(snapshot, diff);
        expect(result.ok).toBe(true);
        expect(store.getLatestSnapshot(snapshot.id)).not.toBeNull();
        expect(store.getHistory(snapshot.id).diffs).toHaveLength(1);
    });

    test('a corrupt latest-snapshot file reads as null instead of throwing', () => {
        const store = makeStore();
        const snapshot = snapshotFrom('oib-old.csv');
        store.saveSnapshot(snapshot);
        fs.writeFileSync(path.join(baseDir, 'snapshots', `${snapshot.id}.json`), '{not json');

        expect(store.getLatestSnapshot(snapshot.id)).toBeNull();
    });

    test('a corrupt diffs.jsonl line is skipped without hiding the rest', () => {
        const store = makeStore();
        const snapshot = snapshotFrom('oib-old.csv');
        store.saveSnapshot(snapshot);
        const diffsFile = path.join(baseDir, 'history', snapshot.id, 'diffs.jsonl');
        fs.writeFileSync(diffsFile, `${JSON.stringify({ id: 'good' })}\n{torn line\n`);

        const diffs = store.getHistory(snapshot.id).diffs;
        expect(diffs).toEqual([{ id: 'good' }]);
    });

    test('store failures are reported, never fatal (unwritable base dir)', () => {
        // A FILE used as the base dir makes every mkdir/write fail.
        const blocker = path.join(baseDir, 'blocker');
        fs.writeFileSync(blocker, 'not a directory');
        const store = createChangeDetectionStore({ dataDir: blocker });
        const snapshot = snapshotFrom('oib-old.csv');

        expect(() => store.recordCheck(snapshot, { id: 'x' })).not.toThrow();
        expect(store.saveSnapshot(snapshot)).toMatchObject({ ok: false });
        expect(store.getLatestSnapshot(snapshot.id)).toBeNull();
    });
});

describe('CHANGE_DETECTION_DATA_DIR override', () => {
    let overrideDir;
    const previousEnv = process.env.CHANGE_DETECTION_DATA_DIR;

    beforeEach(() => {
        overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-detection-env-'));
        process.env.CHANGE_DETECTION_DATA_DIR = overrideDir;
    });

    afterEach(() => {
        if (previousEnv === undefined) {
            delete process.env.CHANGE_DETECTION_DATA_DIR;
        } else {
            process.env.CHANGE_DETECTION_DATA_DIR = previousEnv;
        }
        fs.rmSync(overrideDir, { recursive: true, force: true });
    });

    test('store honors the env override for its base directory', () => {
        const store = createChangeDetectionStore();
        expect(store.baseDir).toBe(overrideDir);

        const parsed = parseCsvExport(
            fs.readFileSync(path.join(FIXTURES_DIR, 'oib-old.csv'), 'utf8')
        );
        const snapshot = buildSnapshot(parsed.rows, QUERY, META);
        expect(store.saveSnapshot(snapshot).ok).toBe(true);
        expect(fs.existsSync(path.join(overrideDir, 'snapshots', `${snapshot.id}.json`))).toBe(true);
    });
});
