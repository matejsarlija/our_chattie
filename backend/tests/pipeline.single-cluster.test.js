const { buildDiscoveryResult } = require('../court-analysis/pipeline');

const SINGLE_CLUSTER_FIXTURE = '../fixtures/analysis-baselines/single-cluster-paginated.json';

describe('single-cluster paginated fixture', () => {
  test('buildDiscoveryResult preserves all entries and selects the primary cluster', () => {
    const fixture = require(SINGLE_CLUSTER_FIXTURE);
    const result = buildDiscoveryResult(fixture.casesToProcess, {
      query: fixture.query,
      discoveryMetadata: fixture.discoveryMetadata,
    });
    expect(result.discoverySummary.rawEntryCount).toBe(50);
    expect(result.discoverySummary.clusters[0].clusterId).toBe(result.primaryCluster.clusterId);
    expect(result.primaryCluster.clusterId).toBe('ST-2/2013');
    expect(result.secondaryClusters).toHaveLength(0);
  });
});
