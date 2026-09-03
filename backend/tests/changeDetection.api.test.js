const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const express = require('express');

const { createChangeDetectionRouter } = require('../change-detection/api');
const { createChangeDetectionStore } = require('../change-detection/store');
const { buildSnapshot } = require('../change-detection/snapshot');
const { diffSnapshots } = require('../change-detection/diff');
const { CsvExportError } = require('../scraper/csvExportClient');
const { parseCsvExport } = require('../scraper/csvExportParser');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'change-detection');

function snapshotFromFixture(name, query, capturedAt) {
    const parsed = parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
    if (!parsed.ok) {
        throw new Error(`Fixture ${name} failed to parse: ${parsed.reason}`);
    }
    return buildSnapshot(parsed.rows, query, {
        sourceUrl: 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv',
        capturedAt
    });
}

function makeApp(service) {
    const app = express();
    app.use(express.json());
    app.use('/api/change-detection', createChangeDetectionRouter({ service }));
    return app;
}

describe('POST /api/change-detection/check (H-08)', () => {
    test('happy path returns the ChangeDiff plus context', async () => {
        const result = {
            query: { type: 'oib', value: '66124057408' },
            queryId: 'a'.repeat(40),
            baseline: false,
            snapshot: { snapshotId: 'snap-2', rowCount: 381, entryCount: 381, debtorOibs: ['66124057408'] },
            previousSnapshotId: 'snap-1',
            diff: { id: 'snap-1-snap-2', counts: { added: 2, removed: 1, modified: 1, unchanged: 377 }, added: [], removed: [], modified: [] },
            warnings: [],
            persisted: { ok: true }
        };
        const calls = [];
        const service = {
            store: createChangeDetectionStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cd-api-')) }),
            runCheck: async (query) => { calls.push(query); return result; }
        };

        const res = await request(makeApp(service))
            .post('/api/change-detection/check')
            .send({ query: { type: 'oib', value: '66124057408' } });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.queryId).toBe('a'.repeat(40));
        expect(res.body.baseline).toBe(false);
        expect(res.body.diff.counts.unchanged).toBe(377);
        expect(calls).toEqual([{ type: 'oib', value: '66124057408' }]);
    });

    test('invalid input returns 400', async () => {
        const service = { runCheck: async () => {}, store: {} };

        const missingQuery = await request(makeApp(service))
            .post('/api/change-detection/check').send({});
        expect(missingQuery.status).toBe(400);

        const badType = await request(makeApp(service))
            .post('/api/change-detection/check').send({ query: { type: 'regex', value: 'x' } });
        expect(badType.status).toBe(400);

        const missingValue = await request(makeApp(service))
            .post('/api/change-detection/check').send({ query: { type: 'oib' } });
        expect(missingValue.status).toBe(400);
    });

    test('CSV failure maps to a friendly Croatian error with 502', async () => {
        const service = {
            store: {},
            runCheck: async () => {
                throw new CsvExportError('http', 'CSV export fetch failed: 503', { status: 503 });
            }
        };

        const res = await request(makeApp(service))
            .post('/api/change-detection/check')
            .send({ query: { type: 'text', value: 'KERUM' } });

        expect(res.status).toBe(502);
        expect(res.body.error).toContain('Došlo je do mrežne greške pri dohvaćanju sudskih zapisa');
    });

    test('unexpected failures return 500 with a Croatian message', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const service = {
            store: {},
            runCheck: async () => { throw new Error('disk on fire'); }
        };

        const res = await request(makeApp(service))
            .post('/api/change-detection/check')
            .send({ query: { type: 'text', value: 'KERUM' } });

        expect(res.status).toBe(500);
        consoleSpy.mockRestore();
    });
});

describe('GET /api/change-detection/history/:queryId (H-08)', () => {
    test('returns persisted snapshots and diffs for a query', async () => {
        const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-api-history-'));
        const store = createChangeDetectionStore({ dataDir });

        const QUERY = { type: 'oib', value: '66124057408' };
        const oldSnapshot = snapshotFromFixture('oib-old.csv', QUERY, '2026-08-25T10:00:00.000Z');
        const newSnapshot = snapshotFromFixture('oib-new.csv', QUERY, '2026-08-26T10:00:00.000Z');
        const diff = diffSnapshots(oldSnapshot, newSnapshot, { now: '2026-08-26T10:00:01.000Z' });
        store.recordCheck(newSnapshot, diff);

        const service = { store, runCheck: async () => {} };
        const res = await request(makeApp(service))
            .get(`/api/change-detection/history/${oldSnapshot.id}`);

        expect(res.status).toBe(200);
        expect(res.body.queryId).toBe(oldSnapshot.id);
        expect(res.body.snapshots.map((s) => s.snapshotId)).toEqual([newSnapshot.snapshotId]);
        expect(res.body.diffs).toHaveLength(1);
        expect(res.body.diffs[0].counts.added).toBe(diff.counts.added);

        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('rejects malformed queryIds with 400', async () => {
        const service = { store: {}, runCheck: async () => {} };
        const res = await request(makeApp(service)).get('/api/change-detection/history/not-a-hash');
        expect(res.status).toBe(400);
    });
});

describe('router factory guards', () => {
    test('requires a change-check service', () => {
        expect(() => createChangeDetectionRouter({})).toThrow(/service/);
    });
});
