const { groupEntriesByCase } = require('../court-analysis/utils/grouping');

describe('groupEntriesByCase', () => {
    test('groups entries by case number', () => {
        const entries = [
            { caseNumber: 'ST-1/2023', title: 'A' },
            { caseNumber: 'ST-2/2023', title: 'B' },
            { caseNumber: 'ST-1/2023', title: 'C' },
        ];
        
        const clusters = groupEntriesByCase(entries);
        
        expect(clusters).toHaveLength(2);
        
        const cluster1 = clusters.find(c => c.caseNumber === 'ST-1/2023');
        expect(cluster1.entries).toHaveLength(2);
        expect(cluster1.entries[0].title).toBe('A');
        expect(cluster1.entries[1].title).toBe('C');

        const cluster2 = clusters.find(c => c.caseNumber === 'ST-2/2023');
        expect(cluster2.entries).toHaveLength(1);
        expect(cluster2.entries[0].title).toBe('B');
    });

    test('treats N/A case numbers as separate clusters', () => {
        const entries = [
            { caseNumber: 'N/A', title: 'A' },
            { caseNumber: 'ST-1/2023', title: 'B' },
            { caseNumber: 'N/A', title: 'C' },
        ];

        const clusters = groupEntriesByCase(entries);
        
        // Should have 1 cluster for ST-1/2023, and 2 separate clusters for the N/As (or 1 group of N/A?)
        // Spec implies we want to reason about *cases*. If case number is missing, we can't assume they are the same case.
        // So safe behavior is: N/A entries are NOT grouped together.
        
        expect(clusters).toHaveLength(3);
        
        const validCluster = clusters.find(c => c.caseNumber === 'ST-1/2023');
        expect(validCluster).toBeDefined();

        const naClusters = clusters.filter(c => c.caseNumber === 'N/A');
        expect(naClusters).toHaveLength(2);
    });

    test('handles empty input', () => {
        expect(groupEntriesByCase([])).toEqual([]);
        expect(groupEntriesByCase(null)).toEqual([]);
    });

    test('preserves entry order within cluster', () => {
        const entries = [
            { caseNumber: 'A', id: 1 },
            { caseNumber: 'A', id: 2 },
            { caseNumber: 'A', id: 3 },
        ];
        const clusters = groupEntriesByCase(entries);
        expect(clusters[0].entries.map(e => e.id)).toEqual([1, 2, 3]);
    });
});
