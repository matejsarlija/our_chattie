const fs = require('fs');
const path = require('path');
const { parseCsvExport } = require('../scraper/csvExportParser');
const { buildSnapshot, queryIdFor, snapshotIdFor, normalizeQueryValue } = require('../change-detection/snapshot');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'change-detection');

function rowsFrom(name) {
    const parsed = parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
    if (!parsed.ok) {
        throw new Error(`Fixture ${name} failed to parse: ${parsed.reason}`);
    }
    return parsed.rows;
}

function capture(rows, overrides = {}) {
    return buildSnapshot(rows, { type: 'oib', value: '66124057408' }, {
        sourceUrl: 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv?text=66124057408&sort=datePublished%2Cdesc',
        capturedAt: '2026-08-25T10:00:00.000Z',
        ...overrides
    });
}

describe('buildSnapshot (H-01)', () => {
    const rows = rowsFrom('oib-old.csv');

    test('returns the full persisted shape', () => {
        const snapshot = capture(rows);
        expect(Object.keys(snapshot).sort()).toEqual(
            ['capturedAt', 'debtorOibs', 'entries', 'id', 'query', 'rowCount', 'snapshotId', 'sourceUrl'].sort()
        );
        expect(snapshot.rowCount).toBe(rows.length);
        expect(snapshot.capturedAt).toBe('2026-08-25T10:00:00.000Z');
        expect(snapshot.query).toEqual({ type: 'oib', value: '66124057408' });
    });

    test('keys entries by the Oglas (link) GUID URL and carries the compared fields', () => {
        const snapshot = capture(rowsFrom('oib-new.csv'));
        const guids = Object.keys(snapshot.entries);

        expect(guids).toHaveLength(5); // 4 carried-over + 1 added publication
        expect(guids.every((guid) => /^https:\/\/e-oglasna\.pravosudje\.hr\/objave\/[0-9a-f-]+$/.test(guid))).toBe(true);

        const first = snapshot.entries[
            'https://e-oglasna.pravosudje.hr/objave/75527c14-9d85-48be-b997-eb2fa4c94298'
        ];
        expect(first.caseNumber).toBe('ST-2/2013');
        expect(first.title).toContain('Podnesak od 17.06.2026.');
        expect(first.date).toBe('23.06.2026. 08:36:20');
        // Raw tokens WITH page-count suffixes preserved.
        expect(first.documentFiles).toEqual(['Podnesak.pdf P76P']);
    });

    test('stores an empty Posljednji dan objave as null (still published)', () => {
        const snapshot = capture(rows);
        const entry = Object.values(snapshot.entries)[0];
        expect(entry.publicationEnd).toBeNull();
    });

    test('collects the deduped set of debtor OIBs', () => {
        const snapshot = capture(rows);
        expect(snapshot.debtorOibs).toEqual(['66124057408']);

        const drifted = capture(rowsFrom('edits-new.csv'), {});
        expect(drifted.debtorOibs).toEqual(['12345678901', '66124057408']);
    });

    test('id is a stable hash of query.type + normalized query.value', () => {
        const snapshot = capture(rows);
        const reformatted = buildSnapshot(rows, { type: 'oib', value: '6612 4057-408' }, {
            sourceUrl: 'x', capturedAt: '2026-08-26T00:00:00.000Z'
        });
        expect(reformatted.id).toBe(snapshot.id);
        expect(snapshot.id).toMatch(/^[0-9a-f]{40}$/);
    });

    test('snapshotId is a stable content hash that ignores capture metadata', () => {
        const a = capture(rows, { capturedAt: '2026-08-25T10:00:00.000Z' });
        const b = capture(rows, { capturedAt: '2026-08-26T22:42:00.000Z' });
        expect(a.snapshotId).toBe(b.snapshotId);
        expect(a.snapshotId).toMatch(/^[0-9a-f]{40}$/);

        const changed = capture(rowsFrom('oib-new.csv'));
        expect(changed.snapshotId).not.toBe(a.snapshotId);
        expect(snapshotIdFor(changed)).toBe(changed.snapshotId);
    });

    test('counts every parsed row in rowCount even when the GUID is missing', () => {
        const rowsNoGuid = rows.map((row, index) => (
            index === 0 ? { ...row, 'Oglas (link)': '' } : row
        ));
        const snapshot = capture(rowsNoGuid);
        expect(snapshot.rowCount).toBe(rows.length);
        expect(Object.keys(snapshot.entries)).toHaveLength(rows.length - 1);
    });
});

describe('normalizeQueryValue', () => {
    test('oib collapses to digits only', () => {
        expect(normalizeQueryValue('oib', ' 6612 4057-408 ')).toBe('66124057408');
    });

    test('case numbers collapse case and whitespace', () => {
        expect(normalizeQueryValue('case_number', '  St-2   / 2013')).toBe('st-2 / 2013');
    });
});
