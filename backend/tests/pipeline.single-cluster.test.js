const {
    buildDiscoveryResult,
    evaluateClusterExpansionEligibility,
    executeClusterExpansionSearches,
    resolveAutoExpansion,
} = require('../court-analysis/pipeline');

const SINGLE_CLUSTER_FIXTURE = '../fixtures/analysis-baselines/single-cluster-paginated.json';

describe('single-cluster paginated fixture (live-verified KERUM shape)', () => {
    test('buildDiscoveryResult yields one distinct case across a 5-page, 50-entry window', () => {
        const fixture = require(SINGLE_CLUSTER_FIXTURE);

        const result = buildDiscoveryResult(fixture.casesToProcess, {
            caseLimit: 5,
            query: fixture.query,
            discoveryMetadata: fixture.discoveryMetadata
        });

        const ds = result.discoverySummary;
        expect(fixture.casesToProcess).toHaveLength(50);
        expect(ds.rawEntryCount).toBe(50);
        expect(ds.pagesScanned).toBe(5);
        expect(ds.totalResults).toBe(381);
        expect(ds.totalPages).toBe(39);
        expect(ds.capturedDistinctCaseCount).toBe(1);
        expect(ds.reasoningClusterId).toBe('ST-2/2013');
        expect(ds.recommendedPrimaryClusterId).toBe('ST-2/2013');
        expect(ds.secondaryClusterIds).toEqual([]);

        const primary = ds.clusters[0];
        expect(primary.clusterId).toBe('ST-2/2013');
        expect(primary.entryCount).toBe(50);
        expect(primary.documentCount).toBe(50);
        expect(primary.acquisitionModes).toEqual(['search-window']);
        expect(primary.entryCountsByAcquisitionMode['search-window']).toBe(50);
        expect(primary.identityConsistency).toBe('consistent');
        expect(primary.participantOibs).toEqual(['66124057408']);
        expect(primary.selectedForReasoning).toBe(true);

        expect(result.primaryCluster.clusterId).toBe('ST-2/2013');
        expect(result.secondaryClusters).toHaveLength(0);
    });

    test('dense single cluster is already-sufficient: expansion is not eligible', () => {
        const fixture = require(SINGLE_CLUSTER_FIXTURE);

        const result = buildDiscoveryResult(fixture.casesToProcess, {
            caseLimit: 5,
            query: fixture.query,
            discoveryMetadata: fixture.discoveryMetadata
        });

        const primary = result.discoverySummary.clusters[0];
        const eligibility = evaluateClusterExpansionEligibility(
            primary,
            result.discoverySummary,
            fixture.query
        );

        expect(eligibility.eligible).toBe(false);
        expect(eligibility.triggerReasons).toEqual([]);
        expect(eligibility.blockerReasons).toEqual(['primary-cluster-already-sufficient']);
        expect(eligibility.metrics.primaryEntryCount).toBe(50);
        expect(result.discoverySummary.expansionPlan).toBeNull();
    });

    test('re-fetching the same case-number window appends zero duplicate entries (no-op path)', async () => {
        const fixture = require(SINGLE_CLUSTER_FIXTURE);
        // Use a sparse single-cluster subset so expansion is eligible and the
        // case-number follow-up actually runs against the dedupe guard.
        const sparse = {
            query: fixture.query,
            discoveryMetadata: {
                ...fixture.discoveryMetadata,
                pagesScanned: 1,
                currentPage: 1,
                searchWindows: [fixture.discoveryMetadata.searchWindows[0]],
                rawParsedEntryCount: 5
            },
            casesToProcess: fixture.casesToProcess.slice(0, 5)
        };

        const result = buildDiscoveryResult(sparse.casesToProcess, {
            caseLimit: 5,
            query: sparse.query,
            discoveryMetadata: sparse.discoveryMetadata
        });

        // A case-number follow-up search returns the exact same already-captured
        // detail links — the real production shape for a single-cluster OIB.
        const refetched = sparse.casesToProcess.map((entry) => ({
            ...entry,
            acquisition: {
                mode: 'cluster-expansion',
                sourceCaseNumber: 'ST-2/2013',
                pass: 1,
                strategy: 'case-number-follow-up-search'
            }
        }));
        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({ entries: refetched }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [] }),
        };

        const expansionResult = await executeClusterExpansionSearches(automator, result, {});

        expect(expansionResult.status).toBe('no-follow-up-found');
        expect(expansionResult.batches).toHaveLength(0);
        expect(automator.searchCaseNumberFollowUp).toHaveBeenCalledTimes(1);
        expect(automator.followDetailLinks).not.toHaveBeenCalled();
    });

    test('genuinely new same-case entries are appended exactly once across passes', async () => {
        const fixture = require(SINGLE_CLUSTER_FIXTURE);
        // Use a sparse single-cluster subset so expansion is eligible.
        const sparse = {
            query: fixture.query,
            discoveryMetadata: {
                ...fixture.discoveryMetadata,
                pagesScanned: 1,
                currentPage: 1,
                searchWindows: [fixture.discoveryMetadata.searchWindows[0]],
                rawParsedEntryCount: 5
            },
            casesToProcess: fixture.casesToProcess.slice(0, 5)
        };

        const result = buildDiscoveryResult(sparse.casesToProcess, {
            caseLimit: 5,
            query: sparse.query,
            discoveryMetadata: sparse.discoveryMetadata
        });

        const newEntries = sparse.casesToProcess.map((entry, index) => ({
            ...entry,
            caseInfo: { ...entry.caseInfo, detailLink: `http://brand-new-${index}` },
            acquisition: {
                mode: 'cluster-expansion',
                sourceCaseNumber: 'ST-2/2013',
                pass: 1,
                strategy: 'case-number-follow-up-search'
            }
        }));
        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({ entries: newEntries }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [] }),
        };

        const expansionResult = await executeClusterExpansionSearches(automator, result, {});

        expect(expansionResult.status).toBe('executed');
        expect(expansionResult.batches).toHaveLength(1);
        expect(expansionResult.batches[0].entries).toHaveLength(5);
        // Second pass runs as a verification no-op, then stops.
        expect(automator.searchCaseNumberFollowUp).toHaveBeenCalledTimes(2);
    });

    test('resolveAutoExpansion leaves options untouched for a sufficiently-covered single cluster', async () => {
        const fixture = require(SINGLE_CLUSTER_FIXTURE);

        const automator = {
            searchCaseNumberFollowUp: jest.fn(),
            followDetailLinks: jest.fn(),
        };

        const resolved = {
            caseLimit: 5,
            enableVisualizer: false,
            query: fixture.query,
            clusterExpansion: null,
            discoveryMetadata: fixture.discoveryMetadata
        };

        const progressCallback = jest.fn();
        const expanded = await resolveAutoExpansion(automator, fixture.casesToProcess, resolved, progressCallback);

        expect(expanded).toBe(resolved);
        expect(expanded.clusterExpansion).toBeNull();
        expect(automator.searchCaseNumberFollowUp).not.toHaveBeenCalled();
        // The internal eligibility-check discovery pass must be silent — it
        // used to emit duplicate grouping events into the run timeline.
        expect(progressCallback).not.toHaveBeenCalled();
    });

    test('discovery progress: emitProgress:false is silent; final pass emits grouping + primary-cluster summary', () => {
        const fixture = require(SINGLE_CLUSTER_FIXTURE);

        const silentEvents = [];
        buildDiscoveryResult(fixture.casesToProcess, {
            caseLimit: 5,
            query: fixture.query,
            discoveryMetadata: fixture.discoveryMetadata,
            emitProgress: false
        }, (event) => silentEvents.push(event));
        expect(silentEvents).toEqual([]);

        const events = [];
        buildDiscoveryResult(fixture.casesToProcess, {
            caseLimit: 5,
            query: fixture.query,
            discoveryMetadata: fixture.discoveryMetadata
        }, (event) => events.push(event));

        const groupingEvents = events.filter((event) => event.step === 'grouping');
        expect(groupingEvents.length).toBeGreaterThanOrEqual(2);
        expect(groupingEvents[0].message).toContain('Grupiram');

        const primaryMessage = events.map((event) => event.message).find((message) => String(message).includes('Glavni predmet'));
        expect(primaryMessage).toContain('ST-2/2013');
        expect(primaryMessage).toContain('50 objava');
        expect(primaryMessage).toContain('konzistentan');
    });
});