const fs = require('fs');
const os = require('os');
const path = require('path');

const { createChangeCheckService } = require('../change-detection/service');
const { createChangeDetectionStore } = require('../change-detection/store');
const { CsvExportClient, CsvExportError } = require('../scraper/csvExportClient');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'change-detection');
const EXPORT_URL = 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv?text=66124057408&sort=datePublished%2Cdesc';

function makeService(fixtureName, overrides = {}) {
    const dataDir = overrides.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'change-detection-svc-'));
    const fetchCalls = [];
    const client = new CsvExportClient({
        fetcher: async (url) => {
            fetchCalls.push(url);
            if (overrides.fetchError) {
                throw overrides.fetchError;
            }
            return fs.readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8');
        }
    });
    const store = createChangeDetectionStore({ dataDir });
    const service = createChangeCheckService({
        client,
        store,
        now: overrides.now || '2026-08-26T12:00:00.000Z'
    });
    return { service, fetchCalls, store, dataDir };
}

afterEach(() => {
    for (const dir of fs.readdirSync(os.tmpdir())) {
        if (dir.startsWith('change-detection-svc-')) {
            fs.rmSync(path.join(os.tmpdir(), dir), { recursive: true, force: true });
        }
    }
});

describe('change-check service over frozen fixtures (H-05/H-07)', () => {
    test('first run persists the snapshot and returns a baseline diff', async () => {
        const { service } = makeService('oib-old.csv');
        const result = await service.runCheck({ type: 'oib', value: '66124057408' });

        expect(result.baseline).toBe(true);
        expect(result.previousSnapshotId).toBeNull();
        expect(result.diff.baseline).toBe(true);
        expect(result.diff.counts.added).toBe(5);
        expect(result.snapshot.rowCount).toBe(5);
        expect(result.warnings).toEqual([]);
        expect(result.persisted.ok).toBe(true);

        // Both halves persisted: latest snapshot + diff history.
        expect(service.store.getLatestSnapshot(result.queryId)).not.toBeNull();
        expect(service.store.getHistory(result.queryId).diffs).toHaveLength(1);
    });

    test('second run over the "new" export yields the manifest diff end-to-end', async () => {
        const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-detection-svc-'));
        const oldRun = makeService('oib-old.csv', { dataDir: sharedDir });
        const newRun = makeService('oib-new.csv', { dataDir: sharedDir });

        await oldRun.service.runCheck({ type: 'oib', value: '66124057408' });
        const result = await newRun.service.runCheck({ type: 'oib', value: '66124057408' });

        const manifest = JSON.parse(
            fs.readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8')
        );
        const expected = manifest.pairs['oib-old.csv -> oib-new.csv'].expected;

        expect(result.baseline).toBe(false);
        expect(result.diff.counts).toEqual(expected.counts);
        expect(result.diff.added).toEqual(expected.addedGuids);
        expect(result.diff.removed).toEqual(expected.removedGuids);
        for (const mod of result.diff.modified) {
            expect(mod.changedFields).toEqual(expected.modifications[mod.guid].changedFields);
        }

        // Same query identity across runs → same queryId/history folder.
        expect(newRun.service.queryIdFor({ type: 'oib', value: '66124057408' }))
            .toBe(result.queryId);
        expect(newRun.store.getHistory(result.queryId).diffs).toHaveLength(2);

        // Re-checking an unchanged export produces a no-change diff and does
        // not duplicate archived history.
        const again = await newRun.service.runCheck({ type: 'oib', value: '66124057408' });
        expect(again.baseline).toBe(false);
        expect(again.diff.counts.unchanged).toBe(expected.counts.added
            + expected.counts.modified + expected.counts.unchanged);
        expect(again.diff.counts.added + again.diff.counts.removed + again.diff.counts.modified).toBe(0);
    });

    test('acquisition is COMPLETE — every row of the export enters the snapshot', async () => {
        // Regression guard (spec §9.3): the check path must capture the full
        // row set, never a bounded forward window. The dense Phase A export
        // has 381 rows — far beyond the default 5-page (50 entry) window.
        const { service } = makeService('../csv-export/oib-66124057408.csv');
        const result = await service.runCheck({ type: 'oib', value: '66124057408' });

        expect(result.snapshot.rowCount).toBe(381);
        expect(result.snapshot.entryCount).toBe(381);
        // Baseline added count equals ALL entries: nothing was dropped.
        expect(result.diff.counts.added).toBe(381);
    });

    test('the check path never applies forward-window bounding to the export', async () => {
        // The single-GET export IS the complete scan (equivalent to
        // maxPages: Infinity); assert the raw-row path is used directly.
        const { service, fetchCalls } = makeService('oib-old.csv');
        const spy = jest.spyOn(service.client, 'searchAndGetLatestCases');

        await service.runCheck({ type: 'oib', value: '66124057408' });

        expect(fetchCalls).toEqual([EXPORT_URL]);
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    test('CSV failures surface as typed CsvExportError, not a bogus diff', async () => {
        const { service } = makeService('oib-old.csv', {
            fetchError: Object.assign(new Error('boom'), { response: { status: 503 } })
        });

        await expect(service.runCheck({ type: 'oib', value: '66124057408' }))
            .rejects.toBeInstanceOf(CsvExportError);

        // Nothing was persisted, so no false "everything removed" can exist.
        expect(service.store.getLatestSnapshot(service.queryIdFor({ type: 'oib', value: '66124057408' })))
            .toBeNull();
    });

    test('entity mismatch between an OIB query and observed debtors is warned', async () => {
        const { service } = makeService('oib-old.csv');
        const result = await service.runCheck({ type: 'oib', value: '11111111111' });

        expect(result.query.value).toBe('11111111111');
        expect(result.warnings.some((w) => w.startsWith('entity-mismatch'))).toBe(true);
    });

    test('a persistence failure warns but the check still returns the diff', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'change-detection-svc-'));
        // A file where the snapshots directory must live → all writes fail.
        fs.writeFileSync(path.join(dataDir, 'snapshots'), 'blocker');

        const { service } = makeService('oib-new.csv', { dataDir });
        const result = await service.runCheck({ type: 'oib', value: '66124057408' });

        expect(result.persisted.ok).toBe(false);
        expect(result.warnings).toContain('persistence-failed: the check result could not be saved locally');
        expect(result.diff.counts.added).toBeGreaterThan(0);
    });
});
