const { runCheckChanges, parseArgs } = require('../scripts/check-changes');

function makeService(resultOverrides = {}) {
    const calls = [];
    const service = {
        queryIdFor: (query) => `qid-${JSON.stringify(query)}`,
        runCheck: async (query) => {
            calls.push(query);
            return {
                query,
                queryId: 'q-123',
                baseline: false,
                snapshot: {
                    snapshotId: 'snap-2',
                    capturedAt: '2026-08-26T12:00:00.000Z',
                    sourceUrl: 'https://e-oglasna.pravosudje.hr/objave/izvoz/csv',
                    rowCount: 381,
                    entryCount: 381,
                    debtorOibs: ['66124057408']
                },
                previousSnapshotId: 'snap-1',
                diff: {
                    id: 'snap-1-snap-2',
                    baseline: false,
                    entityDrift: false,
                    counts: { added: 1, removed: 0, modified: 1, unchanged: 379 },
                    added: ['https://e-oglasna.pravosudje.hr/objave/added'],
                    removed: [],
                    modified: [{
                        guid: 'https://e-oglasna.pravosudje.hr/objave/mod',
                        changedFields: ['documentFiles', 'publicationEnd'],
                        before: { documentFiles: ['Podnesak.pdf P75P'], publicationEnd: null },
                        after: { documentFiles: ['Podnesak.pdf P76P'], publicationEnd: '30.06.2026.' }
                    }]
                },
                warnings: [],
                persisted: { ok: true, save: { ok: true }, append: { ok: true } },
                ...resultOverrides
            };
        }
    };
    return { service, calls };
}

describe('check-changes CLI (H-04)', () => {
    test('requires exactly one query flag', async () => {
        const none = await runCheckChanges([], {});
        expect(none.code).toBe(2);
        expect(none.output).toMatch(/Exactly one/);

        const both = await runCheckChanges(['--oib=66124057408', '--text=KERUM'], {});
        expect(both.code).toBe(2);
        expect(both.output).toMatch(/Only one query flag/);
    });

    test('rejects an empty flag value', async () => {
        const result = await runCheckChanges(['--oib='], {});
        expect(result.code).toBe(2);
    });

    test('prints a human-readable summary with per-field changes', async () => {
        const { service } = makeService();
        const { code, output } = await runCheckChanges(['--oib=66124057408'], { service });

        expect(code).toBe(1);
        expect(output).toContain('OIB: 66124057408');
        expect(output).toContain('+1 novo / -0 uklonjeno / ~1 izmijenjeno / =379 nepromijenjeno');
        expect(output).toContain('~ Izmijenjeno: https://e-oglasna.pravosudje.hr/objave/mod [documentFiles, publicationEnd]');
        expect(output).toContain('["Podnesak.pdf P75P"] -> ["Podnesak.pdf P76P"]');
        expect(output).toContain('+ Novo: https://e-oglasna.pravosudje.hr/objave/added');
    });

    test('--json emits the raw ChangeDiff', async () => {
        const { service } = makeService();
        const { code, output } = await runCheckChanges(['--text=KERUM', '--json'], { service });

        expect(code).toBe(1);
        const parsed = JSON.parse(output);
        expect(parsed.counts).toEqual({ added: 1, removed: 0, modified: 1, unchanged: 379 });
        expect(parsed.modified[0].changedFields).toEqual(['documentFiles', 'publicationEnd']);
    });

    test('exit 0 when nothing changed', async () => {
        const { service } = makeService({
            baseline: false,
            diff: {
                counts: { added: 0, removed: 0, modified: 0, unchanged: 381 },
                added: [], removed: [], modified: [], entityDrift: false
            }
        });
        const { code } = await runCheckChanges(['--oib=66124057408'], { service });
        expect(code).toBe(0);
    });

    test('baseline first run counts as "changes detected" (exit 1)', async () => {
        const { service } = makeService({
            baseline: true,
            previousSnapshotId: null,
            diff: {
                baseline: true,
                counts: { added: 5, removed: 0, modified: 0, unchanged: 0 },
                added: ['a', 'b', 'c', 'd', 'e'], removed: [], modified: [], entityDrift: false
            }
        });
        const { code, output } = await runCheckChanges(['--case=St-2/2013'], { service });
        expect(code).toBe(1);
        expect(output).toContain('PRVO SNIMANJE');
    });

    test('entity drift is surfaced in the summary without hiding the diff', async () => {
        const { service } = makeService({ diff: { entityDrift: true, counts: { added: 0, removed: 0, modified: 1, unchanged: 4 }, added: [], removed: [], modified: [] } });
        const { output } = await runCheckChanges(['--text=KERUM'], { service });
        expect(output).toMatch(/drift/);
    });

    test('CSV failures map to a friendly Croatian message with exit 2', async () => {
        const failing = {
            queryIdFor: () => 'x',
            runCheck: async () => {
                const err = new Error('CSV export fetch failed for "X": 503');
                err.name = 'CsvExportError';
                err.reason = 'http';
                throw err;
            }
        };

        const { code, output } = await runCheckChanges(['--oib=66124057408'], { service: failing });
        expect(code).toBe(2);
        expect(output).toContain('Došlo je do mrežne greške pri dohvaćanju sudskih zapisa');
        expect(output).not.toContain('CSV export fetch failed');
    });

    test('query resolution goes through the backend classifier contract', () => {
        const args = parseArgs(['--case=St-2/2013']);
        expect(args.query).toEqual({ type: 'case_number', value: 'St-2/2013' });

        const oibArgs = parseArgs(['--oib=66124057408']);
        expect(oibArgs.query.type).toBe('oib');
    });
});
