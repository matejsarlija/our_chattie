const { evaluateDiscoveryHeuristics } = require('../court-analysis/pipeline');

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

