const fs = require('fs');
const path = require('path');
const { parseCsvExport } = require('../scraper/csvExportParser');
const { buildSnapshot } = require('../change-detection/snapshot');
const { diffSnapshots, hasChanges } = require('../change-detection/diff');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'change-detection');

function rowsFrom(name) {
    const parsed = parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));
    if (!parsed.ok) {
        throw new Error(`Fixture ${name} failed to parse: ${parsed.reason}`);
    }
    return parsed.rows;
}

const QUERY = { type: 'oib', value: '66124057408' };
const META = { sourceUrl: 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv', capturedAt: '2026-08-25T10:00:00.000Z' };

function entry(overrides = {}) {
    return {
        caseNumber: 'ST-2/2013',
        title: 'Podnesak od 17.06.2026.',
        date: '23.06.2026. 08:36:20',
        publicationEnd: null,
        documentFiles: ['Podnesak.pdf P75P'],
        debtorOib: '66124057408',
        ...overrides
    };
}

function makeSnapshot(entries, overrides = {}) {
    return buildSnapshot(
        Object.entries(entries).map(([link, value]) => ({
            'Vrsta objave': 'Stečaj',
            'Sud': 'Trgovački sud u Splitu',
            'Oznaka spisa': value.caseNumber,
            'Naslov': value.title,
            'Stečajni dužnik': 'KERUM d.o.o.',
            'Adresa stečajnog dužnika': 'Split',
            'OIB stečajnog dužnika': value.debtorOib,
            'Sudionici': 'KERUM d.o.o.',
            'Početni dan objave': value.date,
            'Posljednji dan objave': value.publicationEnd || '',
            'Oglas (link)': link,
            'Dokumenti (datoteke)': (value.documentFiles || []).join('; '),
            'Dokumenti (link)': `${link}/dokumenti/preuzimanje`,
            'e-Predmet (link)': ''
        })),
        QUERY,
        META
    );
}

const GUID_A = 'https://e-oglasna.pravosudje.hr/objave/a0000000-0000-4000-8000-00000000000a';
const GUID_B = 'https://e-oglasna.pravosudje.hr/objave/b0000000-0000-4000-8000-00000000000b';
const GUID_C = 'https://e-oglasna.pravosudje.hr/objave/c0000000-0000-4000-8000-00000000000c';

describe('diffSnapshots (H-02)', () => {
    test('first run (old = null) yields a baseline diff with everything added', () => {
        const next = makeSnapshot({ [GUID_A]: entry(), [GUID_B]: entry({ title: 'Žalba' }) });
        const diff = diffSnapshots(null, next);

        expect(diff.baseline).toBe(true);
        expect(diff.fromSnapshotId).toBeNull();
        expect(diff.counts).toEqual({ added: 2, removed: 0, modified: 0, unchanged: 0 });
        expect(diff.added.sort()).toEqual([GUID_A, GUID_B].sort());
        expect(diff.removed).toEqual([]);
        expect(diff.modified).toEqual([]);
        expect(diff.entityDrift).toBe(false);
        expect(diff.id).toBe(`baseline-${next.snapshotId}`);
        expect(hasChanges(diff)).toBe(true);
    });

    test('classifies added / removed / modified / unchanged', () => {
        const prev = makeSnapshot({
            [GUID_A]: entry(),                                        // stays unchanged
            [GUID_B]: entry({ documentFiles: ['Žalba.pdf P227P'] }), // removed
            [GUID_C]: entry({ title: 'Staro' })                       // modified
        });
        const next = makeSnapshot({
            [GUID_A]: entry(),
            [GUID_C]: entry({ title: 'Novo' }),
            [GUID_B.replace(/b0000/, 'd0000')]: entry()               // added
        });

        const diff = diffSnapshots(prev, next);

        expect(diff.baseline).toBe(false);
        expect(diff.counts).toEqual({ added: 1, removed: 1, modified: 1, unchanged: 1 });
        expect(diff.added).toEqual([GUID_B.replace(/b0000/, 'd0000')]);
        expect(diff.removed).toEqual([GUID_B]);
        expect(hasChanges(diff)).toBe(true);
    });

    test('modified entries carry changedFields plus per-field before/after only', () => {
        const prev = makeSnapshot({
            [GUID_A]: entry({
                documentFiles: ['Podnesak.pdf P75P'],
                publicationEnd: null,
                date: '23.06.2026. 08:36:20'
            })
        });
        const next = makeSnapshot({
            [GUID_A]: entry({
                documentFiles: ['Podnesak.pdf P76P'],
                publicationEnd: '30.06.2026.'
            })
        });

        const diff = diffSnapshots(prev, next);
        expect(diff.counts.modified).toBe(1);
        expect(diff.modified[0].guid).toBe(GUID_A);
        expect(diff.modified[0].changedFields).toEqual(['documentFiles', 'publicationEnd']);
        expect(diff.modified[0].before).toEqual({
            documentFiles: ['Podnesak.pdf P75P'],
            publicationEnd: null
        });
        expect(diff.modified[0].after).toEqual({
            documentFiles: ['Podnesak.pdf P76P'],
            publicationEnd: '30.06.2026.'
        });
        // Non-compared fields never leak into before/after.
        expect(diff.modified[0].before.date).toBeUndefined();
    });

    test('documentFiles compare as ORDERED arrays (rename and reorder are changes)', () => {
        const prev = makeSnapshot({ [GUID_A]: entry({ documentFiles: ['A.pdf P1P', 'B.pdf P2P'] }) });

        const reordered = diffSnapshots(prev, makeSnapshot({
            [GUID_A]: entry({ documentFiles: ['B.pdf P2P', 'A.pdf P1P'] })
        }));
        expect(reordered.counts.modified).toBe(1);

        const sameOrder = diffSnapshots(prev, makeSnapshot({
            [GUID_A]: entry({ documentFiles: ['A.pdf P1P', 'B.pdf P2P'] })
        }));
        expect(sameOrder.counts.unchanged).toBe(1);
    });

    test('publicationEnd treats empty string and null as equal', () => {
        const prev = makeSnapshot({ [GUID_A]: entry({ publicationEnd: null }) });
        const same = diffSnapshots(prev, makeSnapshot({ [GUID_A]: entry({ publicationEnd: '' }) }));
        expect(same.counts.unchanged).toBe(1);
        expect(same.counts.modified).toBe(0);
    });

    test('date and caseNumber are captured but NOT compared', () => {
        const prev = makeSnapshot({
            [GUID_A]: entry({ date: '01.01.2026. 00:00:00', caseNumber: 'ST-2/2013' })
        });
        const next = makeSnapshot({
            [GUID_A]: entry({ date: '02.02.2027. 12:34:56', caseNumber: 'ST-9/2099' })
        });
        const diff = diffSnapshots(prev, next);
        expect(diff.counts.unchanged).toBe(1);
        expect(diff.counts.modified).toBe(0);
        expect(hasChanges(diff)).toBe(false);
    });

    test('entityDrift is true when debtorOibs sets differ, without suppressing entries', () => {
        const prev = makeSnapshot({
            [GUID_A]: entry(),
            [GUID_B]: entry({ debtorOib: '11111111111' })
        });
        const next = makeSnapshot({
            [GUID_A]: entry({ title: 'Promijenjeno' }),
            [GUID_B]: entry({ debtorOib: '11111111111' }),
            [GUID_C]: entry({ debtorOib: '22222222222' })
        });

        const diff = diffSnapshots(prev, next);
        expect(diff.entityDrift).toBe(true);
        expect(diff.counts.added).toBe(1);      // GUID_C still classified normally
        expect(diff.counts.modified).toBe(1);
    });

    test('entityDrift is false when only order differs (sets are compared)', () => {
        const prevSnapshot = { ...makeSnapshot({ [GUID_A]: entry() }), debtorOibs: ['66124057408', '11111111111'] };
        const nextSnapshot = { ...makeSnapshot({ [GUID_A]: entry() }), debtorOibs: ['11111111111', '66124057408'] };
        expect(diffSnapshots(prevSnapshot, nextSnapshot).entityDrift).toBe(false);
    });

    test('identical snapshots produce an all-zero, no-change diff', () => {
        const snapshot = makeSnapshot({ [GUID_A]: entry(), [GUID_B]: entry({ title: 'X' }) });
        const diff = diffSnapshots(snapshot, snapshot);
        expect(diff.counts).toEqual({ added: 0, removed: 0, modified: 0, unchanged: 2 });
        expect(hasChanges(diff)).toBe(false);
        expect(diff.id).toBe(`${snapshot.snapshotId}-${snapshot.snapshotId}`);
    });

    test('output is deterministic across runs (sorted guids, injected clock)', () => {
        const prev = makeSnapshot({
            [GUID_C]: entry({ title: 'C' }),
            [GUID_A]: entry({ title: 'A' })
        });
        const next = makeSnapshot({
            [GUID_B]: entry({ title: 'B' }),
            [GUID_A]: entry({ title: 'A' })
        }, {});

        const a = diffSnapshots(prev, next, { now: '2026-08-25T00:00:00.000Z' });
        const b = diffSnapshots(prev, next, { now: '2026-08-25T00:00:00.000Z' });
        expect(a).toEqual(b);
        expect(a.computedAt).toBe('2026-08-25T00:00:00.000Z');
    });

    test('rejects a missing new snapshot', () => {
        expect(() => diffSnapshots(null, null)).toThrow(/newSnapshot/);
    });
});

describe('diff over the frozen oib fixture pair (H-06 manifest)', () => {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(FIXTURES_DIR, 'manifest.json'), 'utf8')
    );

    test('matches the documented expected diff for oib-old -> oib-new', () => {
        const oldSnapshot = buildSnapshot(rowsFrom('oib-old.csv'), QUERY, META);
        const newSnapshot = buildSnapshot(rowsFrom('oib-new.csv'), QUERY, META);
        const diff = diffSnapshots(oldSnapshot, newSnapshot, { now: '2026-08-26T00:00:00.000Z' });

        const expected = manifest.pairs['oib-old.csv -> oib-new.csv'].expected;
        expect(diff.counts).toEqual(expected.counts);
        expect(diff.added).toEqual(expected.addedGuids);
        expect(diff.removed).toEqual(expected.removedGuids);
        for (const mod of diff.modified) {
            expect(mod.changedFields).toEqual(expected.modifications[mod.guid].changedFields);
        }
        expect(diff.entityDrift).toBe(false);
    });

    test('matches the documented expected diff for edits-old -> edits-new (incl. entityDrift)', () => {
        const textQuery = { type: 'text', value: 'KERUM' };
        const oldSnapshot = buildSnapshot(rowsFrom('edits-old.csv'), textQuery, META);
        const newSnapshot = buildSnapshot(rowsFrom('edits-new.csv'), textQuery, META);
        const diff = diffSnapshots(oldSnapshot, newSnapshot, { now: '2026-08-26T00:00:00.000Z' });

        const expected = manifest.pairs['edits-old.csv -> edits-new.csv'].expected;
        expect(diff.counts).toEqual(expected.counts);
        expect(diff.added).toEqual(expected.addedGuids);
        expect(diff.removed).toEqual(expected.removedGuids);
        expect(diff.entityDrift).toBe(expected.entityDrift);
        for (const mod of diff.modified) {
            expect(mod.changedFields).toEqual(expected.modifications[mod.guid].changedFields);
        }
    });
});
