const {
    evaluateDiscoveryHeuristics,
    evaluateClusterExpansionEligibility,
    buildClusterExpansionPlan
} = require('../court-analysis/pipeline');

describe('evaluateDiscoveryHeuristics', () => {
    test('stops when maxPagesScanned is reached', () => {
        const summary = {
            pagesScanned: 5,
            hasNextPage: true,
            capturedDistinctCaseCount: 1,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 1, entryDateSpanDays: 1 }],
            dominantClusterRatio: 1
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('max-pages-reached');
    });

    test('paginates if no primary cluster is found but pages exist', () => {
        const summary = {
            pagesScanned: 1,
            hasNextPage: true,
            capturedDistinctCaseCount: 0,
            recommendedPrimaryClusterId: null,
            clusters: [],
            dominantClusterRatio: 0
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('paginate');
        expect(result.reason).toBe('no-primary-cluster-found-yet');
    });

    test('stops if single cluster has sufficient coverage', () => {
        const summary = {
            pagesScanned: 1,
            hasNextPage: true,
            capturedDistinctCaseCount: 1,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 12, entryDateSpanDays: 400 }],
            dominantClusterRatio: 1
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('single-cluster-sufficient-coverage');
    });

    test('paginates if single cluster is under-covered and pages exist', () => {
        const summary = {
            pagesScanned: 1,
            hasNextPage: true,
            capturedDistinctCaseCount: 1,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 5, entryDateSpanDays: 100 }],
            dominantClusterRatio: 1
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('paginate');
        expect(result.reason).toBe('single-cluster-under-covered');
    });

    test('stops if dominant cluster has strong coverage (multiple clusters)', () => {
        const summary = {
            pagesScanned: 2,
            hasNextPage: true,
            capturedDistinctCaseCount: 3,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 15, entryDateSpanDays: 800 }],
            dominantClusterRatio: 0.8
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('dominant-cluster-strong-coverage');
    });

    test('expands if promising cluster is under-covered after search-window exhausted', () => {
        const summary = {
            pagesScanned: 2,
            hasNextPage: false, // search window exhausted
            capturedDistinctCaseCount: 2,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 8, entryDateSpanDays: 200 }],
            dominantClusterRatio: 0.9
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('expand');
        expect(result.reason).toBe('promising-cluster-under-covered-after-search-window');
    });

    test('paginates if not exhausted and no rule forced stop/expand', () => {
        const summary = {
            pagesScanned: 2,
            hasNextPage: true,
            capturedDistinctCaseCount: 3,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 5, entryDateSpanDays: 200 }],
            dominantClusterRatio: 0.4
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('paginate');
        expect(result.reason).toBe('continue-search-window');
    });

    test('stops when search window exhausted and cluster is fully covered', () => {
        const summary = {
            pagesScanned: 2,
            hasNextPage: false,
            capturedDistinctCaseCount: 3,
            recommendedPrimaryClusterId: 'c1',
            clusters: [{ clusterId: 'c1', entryCount: 15, entryDateSpanDays: 800 }],
            dominantClusterRatio: 0.8
        };
        const result = evaluateDiscoveryHeuristics(summary, {});
        expect(result.action).toBe('stop');
        expect(result.reason).toBe('dominant-cluster-strong-coverage');
    });
});

describe('buildClusterExpansionPlan', () => {
    test('creates an executable plan for an under-covered text-query primary cluster', () => {
        const eligibility = evaluateClusterExpansionEligibility(
            { clusterId: 'ST-700/2024', entryCount: 2, entryDateSpanDays: 29, identityConsistency: 'consistent' },
            { dominantClusterRatio: 0.9, capturedDistinctCaseCount: 2 },
            { type: 'text', value: 'JADRAN' }
        );

        const plan = buildClusterExpansionPlan(
            { clusterId: 'ST-700/2024', identityConsistency: 'consistent', identityNotes: [] },
            eligibility,
            { type: 'text', value: 'JADRAN' }
        );

        expect(plan).toEqual(expect.objectContaining({
            targetClusterId: 'ST-700/2024',
            executable: true,
            maxPasses: 2,
            strategies: ['case-number-follow-up-search', 'detail-link-follow-up'],
            reasonCodes: expect.arrayContaining([
                'entry-count-below-target',
                'date-span-below-sufficient',
                'dominant-cluster-under-covered'
            ]),
            blockedReasonCodes: []
        }));
        expect(plan.identityGuard).toEqual(expect.objectContaining({
            mode: 'advisory',
            status: 'consistent'
        }));
    });

    test('returns no execution plan when the primary cluster is already sufficient', () => {
        const eligibility = evaluateClusterExpansionEligibility(
            { clusterId: 'ST-1/2020', entryCount: 12, entryDateSpanDays: 500 },
            { dominantClusterRatio: 1, capturedDistinctCaseCount: 1 },
            { type: 'case_number', value: 'ST-1/2020' }
        );

        expect(buildClusterExpansionPlan(
            { clusterId: 'ST-1/2020', identityConsistency: 'consistent' },
            eligibility,
            { type: 'case_number', value: 'ST-1/2020' }
        )).toBeNull();
    });

    test('blocks OIB expansion when the selected cluster identity is ambiguous', () => {
        const primaryCluster = {
            clusterId: 'ST-901/2023',
            entryCount: 2,
            entryDateSpanDays: 20,
            identityConsistency: 'ambiguous',
            identityNotes: ['Captured participant OIBs do not cleanly match queried OIB.']
        };
        const query = { type: 'oib', value: '33333333333' };
        const eligibility = evaluateClusterExpansionEligibility(
            primaryCluster,
            { dominantClusterRatio: 0.8, capturedDistinctCaseCount: 2 },
            query
        );

        const plan = buildClusterExpansionPlan(primaryCluster, eligibility, query);

        expect(plan).toEqual(expect.objectContaining({
            targetClusterId: 'ST-901/2023',
            executable: false,
            blockedReasonCodes: ['oib-identity-guard-not-satisfied']
        }));
        expect(plan.identityGuard).toEqual(expect.objectContaining({
            mode: 'required',
            status: 'ambiguous',
            requiredOib: '33333333333'
        }));
    });
});

describe('evaluateClusterExpansionEligibility', () => {
    test('exposes rule-driven trigger reasons for an under-covered dominant primary cluster', () => {
        const primaryCluster = {
            clusterId: 'ST-700/2024',
            entryCount: 2,
            entryDateSpanDays: 29
        };
        const summary = {
            dominantClusterRatio: 0.9,
            capturedDistinctCaseCount: 2,
            hasNextPage: true
        };

        const result = evaluateClusterExpansionEligibility(primaryCluster, summary, { type: 'text', value: 'JADRAN' });

        expect(result.eligible).toBe(true);
        expect(result.triggerReasons).toEqual([
            'entry-count-below-target',
            'date-span-below-sufficient',
            'dominant-cluster-under-covered'
        ]);
        expect(result.blockerReasons).toEqual([]);
        expect(result.metrics).toEqual(expect.objectContaining({
            primaryEntryCount: 2,
            primarySpanDays: 29,
            dominantClusterRatio: 0.9,
            queryType: 'text'
        }));
        expect(result.thresholds).toEqual(expect.objectContaining({
            targetPrimaryClusterEntries: 10,
            sufficientPrimaryClusterSpanDays: 365
        }));
    });

    test('marks sufficient primary clusters as blocked from expansion', () => {
        const result = evaluateClusterExpansionEligibility(
            { clusterId: 'ST-1/2020', entryCount: 12, entryDateSpanDays: 500 },
            { dominantClusterRatio: 1, capturedDistinctCaseCount: 1 },
            { type: 'case_number', value: 'ST-1/2020' }
        );

        expect(result.eligible).toBe(false);
        expect(result.triggerReasons).toEqual([]);
        expect(result.blockerReasons).toEqual(['primary-cluster-already-sufficient']);
    });

    test('adds a case-number-specific trigger for sparse searched case clusters', () => {
        const result = evaluateClusterExpansionEligibility(
            { clusterId: 'ST-2/2013', entryCount: 1, entryDateSpanDays: 0 },
            { dominantClusterRatio: 1, capturedDistinctCaseCount: 1 },
            { type: 'case_number', value: 'ST-2/2013' }
        );

        expect(result.eligible).toBe(true);
        expect(result.triggerReasons).toEqual(expect.arrayContaining([
            'entry-count-below-target',
            'date-span-below-sufficient',
            'dominant-cluster-under-covered',
            'case-number-query-under-covered'
        ]));
    });
});
