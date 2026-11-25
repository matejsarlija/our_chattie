const { buildDiscoveryResult } = require('../court-analysis/pipeline');

describe('buildDiscoveryResult primary selection', () => {
  test('places the selected primary cluster first and retains all scored clusters', () => {
    const entries = [
      { caseInfo: { caseNumber: 'SECOND', date: '2026-01-01' }, documentLinks: [] },
      { caseInfo: { caseNumber: 'PRIMARY', date: '2026-02-01' }, documentLinks: [] },
      { caseInfo: { caseNumber: 'SECOND', date: '2026-03-01' }, documentLinks: [] },
    ];
    const result = buildDiscoveryResult(entries, { query: { type: 'case_number', value: 'SECOND' } });
    expect(result.discoverySummary.clusters.map((cluster) => cluster.clusterId)).toContain('SECOND');
    expect(result.discoverySummary.clusters[0].clusterId).toBe(result.primaryCluster.clusterId);
    expect(result.discoverySummary.clusters).toHaveLength(2);
    expect(result.primaryCluster.clusterId).toBe('SECOND');
  });
});
