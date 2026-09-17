const { buildDiscoveryResult } = require('../court-analysis/pipeline');

function makeEntry(caseNumber, { date = '2026-01-01', docs = true, sampling = null } = {}) {
    return {
        caseInfo: {
            caseNumber,
            date,
            participants: [],
            documentDownloadLink: docs ? `https://example.invalid/${caseNumber}` : ''
        },
        documentLinks: docs ? [{ url: `https://example.invalid/${caseNumber}/${date}` }] : [],
        acquisition: {
            mode: 'csv-export',
            currentPage: 1,
            ...(sampling ? { sampling } : {})
        }
    };
}

function datedEntries(caseNumber, dates, options = {}) {
    return dates.map((date) => makeEntry(caseNumber, { date, ...options }));
}

describe('buildDiscoveryResult shared primary selection (T0-1)', () => {
    test('case_number query rotates the queried case to primary even when scoring prefers another', () => {
        const entries = [
            ...datedEntries('ST-99/2020', ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05',
                '2026-01-06', '2026-02-06', '2026-03-06', '2026-04-06', '2026-05-06', '2026-06-06']),
            ...datedEntries('ST-2/2013', ['2020-01-05', '2020-01-15', '2020-02-05'])
        ];
        const result = buildDiscoveryResult(entries, {
            caseLimit: 5,
            query: { type: 'case_number', value: 'ST-2/2013' },
            discoveryMetadata: null
        });

        expect(result.primaryClusterId).toBe('ST-2/2013');
        expect(result.secondaryClusters.map((c) => c.clusterId)).toEqual(['ST-99/2020']);
        expect(result.discoverySummary.primarySelection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-2/2013',
            method: 'case-number-query',
            source: 'shared-selector'
        }));
        expect(result.discoverySummary.reasoningClusterId).toBe('ST-2/2013');
    });

    test('selected key cut by caseLimit is reinstated as the reasoning target', () => {
        const entries = [
            ...datedEntries('ST-99/2020', ['2026-01-05', '2026-06-05']),
            ...datedEntries('ST-2/2013', ['2020-01-05'])
        ];
        const result = buildDiscoveryResult(entries, {
            caseLimit: 1,
            query: { type: 'case_number', value: 'ST-2/2013' },
            discoveryMetadata: null
        });

        expect(result.primaryClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.primarySelection.source).toBe('shared-selector');
        // The evicted scored cluster is still visible as a secondary candidate.
        expect(result.secondaryClusters.map((c) => c.clusterId)).toContain('ST-99/2020');
    });

    test('unkeyed input falls back to scoring and records the fallback', () => {
        const entries = [makeEntry('N/A'), makeEntry('N/A')];
        const result = buildDiscoveryResult(entries, {
            caseLimit: 5,
            query: null,
            discoveryMetadata: null
        });

        // No key exists to select: scoring decides (first anonymous cluster),
        // and the record says so.
        expect(result.discoverySummary.primarySelection).toEqual(expect.objectContaining({
            selectedCaseKey: 'anonymous-1',
            method: 'coverage-scoring',
            source: 'scoring-fallback'
        }));
        expect(result.primaryClusterId).toBeTruthy();
    });

    test('agreeing discovery-provided selection needs no override', () => {        const entries = datedEntries('ST-2/2013', ['2026-01-05', '2026-02-05']);
        const result = buildDiscoveryResult(entries, {
            caseLimit: 5,
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata: {
                discoveryMode: 'csv-export',
                selection: { selectedCaseKey: 'ST-2/2013', method: 'document-coverage', rule: 'primary-case-balanced' }
            }
        });

        expect(result.primaryClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.primarySelection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-2/2013',
            source: 'shared-selector',
            discoveryProvidedKey: 'ST-2/2013'
        }));
    });

    test('discovery-provided key becomes primary without a query (CSV convergence)', () => {
        const entries = [
            ...datedEntries('ST-99/2020', ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05']),
            ...datedEntries('ST-2/2013', ['2020-01-05', '2020-02-05'])
        ];
        const result = buildDiscoveryResult(entries, {
            caseLimit: 5,
            query: null,
            discoveryMetadata: {
                discoveryMode: 'csv-export',
                selection: { selectedCaseKey: 'ST-2/2013', method: 'document-coverage', rule: 'global' }
            }
        });

        // Scoring alone would crown ST-99/2020 (dominance + recency); the shared
        // selector key that drove acquisition wins for reasoning instead.
        expect(result.primaryClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.primarySelection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-2/2013',
            method: 'document-coverage',
            source: 'shared-selector'
        }));
    });

    test('scoring stands when no tier fires; unresolvable keys fall back too', () => {
        const scored = buildDiscoveryResult(
            [
                ...datedEntries('ST-99/2020', ['2026-01-05', '2026-02-05']),
                ...datedEntries('ST-2/2013', ['2020-01-05'])
            ],
            { caseLimit: 5, query: null, discoveryMetadata: null }
        );
        expect(scored.primaryClusterId).toBe('ST-99/2020');
        expect(scored.discoverySummary.primarySelection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-99/2020',
            method: 'coverage-scoring',
            source: 'scoring-fallback'
        }));

        const stale = buildDiscoveryResult(
            datedEntries('ST-99/2020', ['2026-01-05']),
            {
                caseLimit: 5,
                query: null,
                discoveryMetadata: { selection: { selectedCaseKey: 'ST-0/2000', method: 'document-coverage' } }
            }
        );
        expect(stale.primaryClusterId).toBe('ST-99/2020');
        expect(stale.discoverySummary.primarySelection.source).toBe('scoring-fallback');
    });
});

describe('stratified reasoning input (TS-2)', () => {
    function poolEntry(index, date, title) {
        return {
            caseInfo: { caseNumber: 'ST-2/2013', title, date, participants: [] },
            documentLinks: [{ url: `https://x/${index}`, text: `${title}.pdf` }],
            acquisition: { mode: 'csv-export', currentPage: 1 }
        };
    }

    test('analysisBudget bounds the reasoning input after grouping; the summary keeps pool counts', () => {
        const pool = [
            ...Array.from({ length: 30 }, (_, i) => poolEntry(i, `2025-${String((i % 12) + 1).padStart(2, '0')}-15`, `Podnesak ${i}`)),
            ...Array.from({ length: 10 }, (_, i) => poolEntry(30 + i, `2020-${String((i % 12) + 1).padStart(2, '0')}-15`, `Rješenje ${i}`)),
            poolEntry(40, '2026-06-23', 'Diobeni popis')
        ];
        const result = buildDiscoveryResult(pool, {
            caseLimit: 5,
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata: {
                discoveryMode: 'csv-export',
                rawParsedEntryCount: pool.length,
                selection: { selectedCaseKey: 'ST-2/2013', method: 'document-coverage', rule: 'primary-case-pool', analysisBudget: 12 }
            }
        });

        // Reasoning input is bounded; discovery reporting is not.
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0].entries).toHaveLength(12);
        expect(result.primaryClusterId).toBe('ST-2/2013');
        const summary = result.discoverySummary;
        expect(summary.rawEntryCount).toBe(pool.length);
        expect(summary.clusters[0].entryCount).toBe(pool.length);
        expect(summary.coverageLedger).toEqual(expect.objectContaining({
            budget: 12,
            available: pool.length,
            selected: 12
        }));
        // The vital distribution statement survives the bound.
        expect(result.clusters[0].entries.map((e) => e.caseInfo.title)).toContain('Diobeni popis');
        // Strata are tagged for provenance consumers.
        expect(result.clusters[0].entries.every((e) => typeof e.acquisition.stratum === 'string')).toBe(true);
    });

    test('no budget means no stratification (legacy paths pass through)', () => {
        const pool = Array.from({ length: 10 }, (_, i) => poolEntry(i, `2025-0${(i % 9) + 1}-15`, `Podnesak ${i}`));
        const result = buildDiscoveryResult(pool, {
            caseLimit: 5,
            query: null,
            discoveryMetadata: { discoveryMode: 'search-window' }
        });

        expect(result.clusters[0].entries).toHaveLength(10);
        expect(result.discoverySummary.coverageLedger).toBeNull();
    });
});

describe('acquisition sampling propagation (T0-2)', () => {
    test('forward/tail markers survive grouping into cluster provenance', () => {
        const entries = [
            makeEntry('ST-2/2013', { date: '2026-06-23', sampling: 'forward' }),
            makeEntry('ST-2/2013', { date: '2026-06-22', sampling: 'forward' }),
            makeEntry('ST-2/2013', { date: '2013-05-05', sampling: 'tail' })
        ];
        const result = buildDiscoveryResult(entries, {
            caseLimit: 5,
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata: null
        });
        const [cluster] = result.discoverySummary.clusters;

        expect(cluster.acquisitionProvenance).toEqual(expect.arrayContaining([
            expect.objectContaining({ mode: 'csv-export', sampling: 'forward' }),
            expect.objectContaining({ mode: 'csv-export', sampling: 'tail' })
        ]));
    });

    test('entries without markers report sampling null (backwards compatible)', () => {
        const entries = [makeEntry('ST-2/2013', { date: '2026-06-23' })];
        const result = buildDiscoveryResult(entries, {
            caseLimit: 5,
            query: null,
            discoveryMetadata: null
        });
        const [cluster] = result.discoverySummary.clusters;

        expect(cluster.acquisitionProvenance).toEqual([
            expect.objectContaining({ mode: 'csv-export', sampling: null })
        ]);
    });

    test('discovery selection (with candidate case counts) survives into the persisted summary', () => {
        const selection = {
            selectedCaseKey: 'ST-2/2013',
            method: 'document-coverage',
            rule: 'primary-case-balanced',
            candidates: [
                { key: 'ST-2/2013', entryCount: 343, documentCount: 343, newestTimestamp: 1782163200000 },
                { key: 'ST-357/2013', entryCount: 4, documentCount: 4, newestTimestamp: 1533513600000 }
            ],
            unkeyedEntries: 0,
            unboundedEntryCount: 347,
            primaryEntryCount: 343
        };
        const result = buildDiscoveryResult(datedEntries('ST-2/2013', ['2026-01-05']), {
            caseLimit: 5,
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata: { discoveryMode: 'csv-export', selection }
        });

        // The analyzed clusters list is single-case, but the summary still
        // knows the full multi-case discovery picture.
        expect(result.discoverySummary.clusters).toHaveLength(1);
        expect(result.discoverySummary.selection).toEqual(selection);
        expect(result.discoverySummary.selection.candidates).toHaveLength(2);
    });
});
