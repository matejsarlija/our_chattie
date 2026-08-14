const {
    executeClusterExpansionSearches,
    resolveAutoExpansion,
    buildDiscoveryResult,
} = require('../court-analysis/pipeline');

describe('Track 2: cluster expansion searches (2b)', () => {
    test('executeClusterExpansionSearches is a no-op when the automator lacks follow-up methods', async () => {
        const automator = {};
        const result = await executeClusterExpansionSearches(automator, { discoverySummary: {} }, {});

        expect(result).toEqual({ batches: [], status: 'no-automator', appliedPasses: 0 });
    });

    test('executeClusterExpansionSearches runs case-number + detail-link strategies for an eligible cluster', async () => {
        const discoveryResult = {
            primaryClusterId: 'ST-700/2024',
            discoverySummary: {
                recommendedPrimaryClusterId: 'ST-700/2024',
                expansionPlan: {
                    executable: true,
                    maxPasses: 2,
                    reasonCodes: ['entry-count-below-target'],
                    strategies: ['case-number-follow-up-search', 'detail-link-follow-up']
                },
                expansionEligibility: { eligible: true, blockerReasons: [] },
                clusters: [{
                    clusterId: 'ST-700/2024',
                    primaryCaseNumber: 'ST-700/2024',
                    acquisitionProvenance: [
                        { mode: 'search-window', entryDetailLink: 'http://detail1' },
                        { mode: 'search-window', entryDetailLink: 'http://detail1' },
                        { mode: 'search-window', entryDetailLink: 'http://detail2' },
                    ]
                }]
            }
        };

        const searchFollowUp = jest.fn().mockResolvedValue({
            entries: [
                {
                    caseInfo: { caseNumber: 'ST-700/2024', detailLink: 'http://case-number-follow-up-1' },
                    acquisition: { mode: 'cluster-expansion' }
                }
            ]
        });
        const detailFollowUp = jest.fn().mockResolvedValue({
            entries: [
                {
                    caseInfo: { caseNumber: 'ST-700/2024', detailLink: 'http://detail-follow-up-1' },
                    acquisition: { mode: 'cluster-expansion' },
                    documentLinks: [{ url: 'http://detail-follow-up-1.pdf', text: 'detail document' }]
                }
            ]
        });

        const automator = {
            searchCaseNumberFollowUp: searchFollowUp,
            followDetailLinks: detailFollowUp,
        };

        const result = await executeClusterExpansionSearches(automator, discoveryResult, {});

        expect(result.status).toBe('executed');
        expect(result.batches).toHaveLength(2);
        expect(result.batches[0]).toEqual(expect.objectContaining({
            clusterId: 'ST-700/2024',
            pass: 1,
            strategy: 'case-number-follow-up-search'
        }));
        expect(result.batches[1]).toEqual(expect.objectContaining({
            clusterId: 'ST-700/2024',
            pass: 1,
            strategy: 'detail-link-follow-up'
        }));
        expect(searchFollowUp).toHaveBeenCalledWith('ST-700/2024', expect.objectContaining({ pass: 1 }));
        // Detail links are deduplicated.
        expect(detailFollowUp).toHaveBeenCalledWith(
            expect.arrayContaining(['http://detail1', 'http://detail2']),
            expect.objectContaining({ pass: 1 })
        );
        expect(detailFollowUp.mock.calls[0][0]).toHaveLength(2);
        expect(detailFollowUp).toHaveBeenCalledWith(
            expect.any(Array),
            expect.objectContaining({ sourceCaseNumber: 'ST-700/2024' })
        );
    });

    test('retains detail-page documents under the originating cluster even when the detail link was already discovered', async () => {
        const discoveryResult = {
            primaryClusterId: 'ST-700/2024',
            clusters: [{
                clusterId: 'ST-700/2024',
                entries: [{
                    caseInfo: { caseNumber: 'ST-700/2024', detailLink: 'http://detail1' },
                    documentLinks: [{ url: 'http://known.pdf', text: 'known' }]
                }]
            }],
            discoverySummary: {
                recommendedPrimaryClusterId: 'ST-700/2024',
                expansionPlan: { executable: true, maxPasses: 1, reasonCodes: ['document-count-below-target'] },
                expansionEligibility: { eligible: true, blockerReasons: [] },
                clusters: [{
                    clusterId: 'ST-700/2024', primaryCaseNumber: 'ST-700/2024',
                    acquisitionProvenance: [{ mode: 'search-window', entryDetailLink: 'http://detail1' }]
                }]
            }
        };
        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({ entries: [] }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [{
                caseInfo: { caseNumber: 'ST-700/2024', detailLink: 'http://detail1' },
                documentLinks: [
                    { url: 'http://known.pdf', text: 'known' },
                    { url: 'http://new.pdf', text: 'new' }
                ]
            }] })
        };

        const result = await executeClusterExpansionSearches(automator, discoveryResult, {});

        expect(result.batches).toHaveLength(1);
        expect(result.batches[0].entries[0].caseInfo.caseNumber).toBe('ST-700/2024');
        expect(result.batches[0].entries[0].documentLinks).toEqual([{ url: 'http://new.pdf', text: 'new' }]);
    });

    test('executeClusterExpansionSearches stops early when a pass finds nothing new', async () => {
        const discoveryResult = {
            primaryClusterId: 'ST-700/2024',
            discoverySummary: {
                recommendedPrimaryClusterId: 'ST-700/2024',
                expansionPlan: { executable: true, maxPasses: 2, reasonCodes: ['entry-count-below-target'] },
                expansionEligibility: { eligible: true, blockerReasons: [] },
                clusters: [{
                    clusterId: 'ST-700/2024',
                    primaryCaseNumber: 'ST-700/2024',
                    acquisitionProvenance: []
                }]
            }
        };

        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({ entries: [] }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [] }),
        };

        const result = await executeClusterExpansionSearches(automator, discoveryResult, {});

        expect(result.status).toBe('no-follow-up-found');
        expect(result.batches).toHaveLength(0);
        expect(automator.searchCaseNumberFollowUp).toHaveBeenCalledTimes(1);
        expect(automator.followDetailLinks).not.toHaveBeenCalled();
    });

    test('executeClusterExpansionSearches respects maxPasses from the plan', async () => {
        const discoveryResult = {
            primaryClusterId: 'ST-700/2024',
            discoverySummary: {
                recommendedPrimaryClusterId: 'ST-700/2024',
                expansionPlan: { executable: true, maxPasses: 1, reasonCodes: ['entry-count-below-target'] },
                expansionEligibility: { eligible: true, blockerReasons: [] },
                clusters: [{
                    clusterId: 'ST-700/2024',
                    primaryCaseNumber: 'ST-700/2024',
                    acquisitionProvenance: []
                }]
            }
        };

        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({
                entries: [{ caseInfo: { caseNumber: 'ST-700/2024' } }]
            }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [] }),
        };

        const result = await executeClusterExpansionSearches(automator, discoveryResult, {});

        expect(result.status).toBe('executed');
        expect(automator.searchCaseNumberFollowUp).toHaveBeenCalledTimes(1);
        expect(automator.searchCaseNumberFollowUp).toHaveBeenCalledWith('ST-700/2024', expect.objectContaining({ pass: 1 }));
    });
});

describe('Track 2: resolveAutoExpansion (2b orchestration)', () => {
    test('passes clusterExpansion batches into the returned options only when executed', async () => {
        const casesToProcess = [
            {
                caseInfo: {
                    caseNumber: 'ST-700/2024',
                    title: 'T1',
                    participants: [{ name: 'KERUM d.o.o.', oib: '66124057408' }]
                },
                acquisition: { mode: 'search-window', currentPage: 1 },
                documentLinks: [{ url: 'http://d1', text: 'doc1' }]
            },
        ];

        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({
                entries: [
                    {
                        caseInfo: { caseNumber: 'ST-700/2024', title: 'Expanded entry' },
                        acquisition: { mode: 'cluster-expansion', sourceCaseNumber: 'ST-700/2024', pass: 1, strategy: 'case-number-follow-up-search' },
                        documentLinks: [{ url: 'http://d2', text: 'doc2' }]
                    }
                ]
            }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [] }),
        };

        const resolved = {
            caseLimit: 1,
            enableVisualizer: false,
            query: { type: 'oib', value: '66124057408' },
            clusterExpansion: null,
            discoveryMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false }
        };

        const expanded = await resolveAutoExpansion(automator, casesToProcess, resolved, jest.fn());

        expect(expanded.clusterExpansion).toBeDefined();
        expect(expanded.clusterExpansion.batches).toHaveLength(1);
        expect(expanded.clusterExpansion.batches[0]).toEqual(expect.objectContaining({
            clusterId: 'ST-700/2024',
            strategy: 'case-number-follow-up-search'
        }));
    });

    test('returns original options when the automator finds no follow-up entries', async () => {
        const casesToProcess = [
            {
                caseInfo: { caseNumber: 'ST-700/2024', title: 'T1', participants: [] },
                acquisition: { mode: 'search-window', currentPage: 1 },
                documentLinks: [{ url: 'http://d1', text: 'doc1' }]
            },
        ];

        const automator = {
            searchCaseNumberFollowUp: jest.fn().mockResolvedValue({ entries: [] }),
            followDetailLinks: jest.fn().mockResolvedValue({ entries: [] }),
        };

        const resolved = {
            caseLimit: 1,
            enableVisualizer: false,
            query: { type: 'text', value: 'KERUM' },
            clusterExpansion: null,
            discoveryMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false }
        };

        const expanded = await resolveAutoExpansion(automator, casesToProcess, resolved, jest.fn());

        expect(expanded.clusterExpansion).toBeNull();
    });

    test('appends expansion batches through buildDiscoveryResult with cluster-expansion provenance', () => {
        const casesToProcess = [
            {
                caseInfo: { caseNumber: 'ST-700/2024', title: 'T1', participants: [{ name: 'KERUM d.o.o.', oib: '66124057408' }] },
                acquisition: { mode: 'search-window', currentPage: 1 },
                documentLinks: [{ url: 'http://d1', text: 'doc1' }]
            },
        ];

        const result = buildDiscoveryResult(casesToProcess, {
            caseLimit: 1,
            query: { type: 'oib', value: '66124057408' },
            clusterExpansion: {
                maxPasses: 1,
                batches: [{
                    clusterId: 'ST-700/2024',
                    pass: 1,
                    strategy: 'case-number-follow-up-search',
                    reason: 'entry-count-below-target',
                    entries: [
                        {
                            caseInfo: { caseNumber: 'ST-700/2024', title: 'Expanded entry' },
                            acquisition: { mode: 'cluster-expansion', sourceCaseNumber: 'ST-700/2024', pass: 1, strategy: 'case-number-follow-up-search' },
                            documentLinks: [{ url: 'http://d2', text: 'doc2' }]
                        }
                    ]
                }]
            },
            discoveryMetadata: { pagesScanned: 1, currentPage: 1, hasNextPage: false }
        });

        expect(result.discoverySummary.expansion).toEqual(expect.objectContaining({
            status: 'applied',
            expandedClusterId: 'ST-700/2024',
            appendedEntryCount: 1
        }));
        const primary = result.discoverySummary.clusters.find(c => c.clusterId === 'ST-700/2024');
        expect(primary.acquisitionModes).toEqual(['search-window', 'cluster-expansion']);
        expect(primary.entryCount).toBe(2);
        expect(primary.acquisitionProvenance).toEqual(expect.arrayContaining([
            expect.objectContaining({ mode: 'cluster-expansion', pass: 1, strategy: 'case-number-follow-up-search' })
        ]));
    });
});
