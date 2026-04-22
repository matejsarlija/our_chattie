const { processScrapedCases } = require('../court-analysis/pipeline');

// Mock dependencies
const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockVisualizerCall = jest.fn();

jest.mock('../court-analysis/agents/download-agent', () => ({
    DownloadDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockDownloadCall
    }))
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
    AnalyzeDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockAnalyzeCall
    })),
    generateComparativeAnalysis: jest.fn().mockResolvedValue('Comparative Analysis')
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation(p => Promise.resolve(p))
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
    VisualizerTool: jest.fn().mockImplementation(() => ({
        _call: mockVisualizerCall
    }))
}));

jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(() => ({
        getEntries: jest.fn().mockReturnValue([]),
        extractEntryTo: jest.fn()
    }));
});

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    unlink: jest.fn((path, cb) => cb && cb(null))
}));

describe('processScrapedCases Selection Policy', () => {
    beforeEach(() => {
        mockDownloadCall.mockReset();
        mockAnalyzeCall.mockReset();
        mockVisualizerCall.mockReset();
        
        mockDownloadCall.mockImplementation(({ documentLinks }) => {
            return Promise.resolve(documentLinks.map((l, i) => ({ 
                filePath: `/tmp/fake_${i}.pdf`, 
                url: l.url 
            })));
        });
        
        mockAnalyzeCall.mockResolvedValue({ individualAnalyses: [], finalSummary: 'Analysis' });
        mockVisualizerCall.mockResolvedValue('graph TD; A-->B');
    });

    test('respects caseLimit by processing only top N clusters', async () => {
        // Create 5 distinct cases
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2' }, documentLinks: [{ url: 'u2' }] },
            { caseInfo: { caseNumber: 'C3', title: 'T3' }, documentLinks: [{ url: 'u3' }] },
            { caseInfo: { caseNumber: 'C4', title: 'T4' }, documentLinks: [{ url: 'u4' }] },
            { caseInfo: { caseNumber: 'C5', title: 'T5' }, documentLinks: [{ url: 'u5' }] },
        ];

        const progressCallback = jest.fn();
        const options = { caseLimit: 3, enableVisualizer: false };
        
        const result = await processScrapedCases(casesToProcess, progressCallback, options);
        
        expect(result.processedCases).toHaveLength(3);
        expect(result.processedCases[0].caseResult.caseNumber).toBe('C1');
        expect(result.processedCases[2].caseResult.caseNumber).toBe('C3');
        
        // Verify we didn't analyze C4 or C5
        const c4 = result.processedCases.find(c => c.caseResult.caseNumber === 'C4');
        expect(c4).toBeUndefined();
    });

    test('returns requested unique-case count when scraped input contains duplicates', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1-A' }, documentLinks: [{ url: 'u1a' }] },
            { caseInfo: { caseNumber: 'C1', title: 'T1-B' }, documentLinks: [{ url: 'u1b' }] },
            { caseInfo: { caseNumber: 'C1', title: 'T1-C' }, documentLinks: [{ url: 'u1c' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2-A' }, documentLinks: [{ url: 'u2a' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2-B' }, documentLinks: [{ url: 'u2b' }] },
            { caseInfo: { caseNumber: 'C3', title: 'T3-A' }, documentLinks: [{ url: 'u3a' }] },
            { caseInfo: { caseNumber: 'C4', title: 'T4-A' }, documentLinks: [{ url: 'u4a' }] },
        ];

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            { caseLimit: 3, enableVisualizer: false },
        );

        expect(result.processedCases).toHaveLength(3);
        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C1', 'C2', 'C3']);
    });

    test('prefers broader coverage over a slight recency edge when limiting selection', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C_COVERED', title: 'Covered A', date: '15.03.2025' }, documentLinks: [{ url: 'u-covered-1' }] },
            { caseInfo: { caseNumber: 'C_COVERED', title: 'Covered B', date: '20.10.2024' }, documentLinks: [{ url: 'u-covered-2' }] },
            { caseInfo: { caseNumber: 'C_COVERED', title: 'Covered C', date: '05.05.2024' }, documentLinks: [{ url: 'u-covered-3' }] },
            { caseInfo: { caseNumber: 'C_NEW', title: 'New', date: '01.04.2025' }, documentLinks: [{ url: 'u-new' }] },
            { caseInfo: { caseNumber: 'C_MID', title: 'Mid', date: '01.01.2024' }, documentLinks: [{ url: 'u-mid' }] },
        ];

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            { caseLimit: 2, enableVisualizer: false },
        );

        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C_COVERED', 'C_NEW']);
    });

    test('parses trailing-dot Croatian dates for recency ranking', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C_OLDER', title: 'Older A', date: '13.01.2025.' }, documentLinks: [{ url: 'u-older-1' }] },
            { caseInfo: { caseNumber: 'C_OLDER', title: 'Older B', date: '13.01.2025.' }, documentLinks: [{ url: 'u-older-2' }] },
            { caseInfo: { caseNumber: 'C_NEWER', title: 'Newer', date: '14.01.2025.' }, documentLinks: [{ url: 'u-newer-1' }] },
        ];

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            { caseLimit: 1, enableVisualizer: false },
        );

        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C_NEWER']);
    });

    test('prefers higher-coverage clusters on recency ties', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C_LOW', title: 'Low', date: '01.03.2025' }, documentLinks: [{ url: 'u-low-1' }] },
            { caseInfo: { caseNumber: 'C_HIGH', title: 'High A', date: '01.03.2025' }, documentLinks: [{ url: 'u-high-1' }] },
            { caseInfo: { caseNumber: 'C_HIGH', title: 'High B', date: '01.03.2025' }, documentLinks: [{ url: 'u-high-2' }] },
            { caseInfo: { caseNumber: 'C_MED', title: 'Med A', date: '01.03.2025' }, documentLinks: [{ url: 'u-med-1' }] },
            { caseInfo: { caseNumber: 'C_MED', title: 'Med B', date: '01.03.2025' }, documentLinks: [{ url: 'u-med-2' }] },
        ];

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            { caseLimit: 2, enableVisualizer: false },
        );

        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C_HIGH', 'C_MED']);
    });

    test('handles caseLimit greater than available clusters', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2' }, documentLinks: [{ url: 'u2' }] },
        ];

        const options = { caseLimit: 5, enableVisualizer: false };
        const result = await processScrapedCases(casesToProcess, jest.fn(), options);
        
        expect(result.processedCases).toHaveLength(2);
    });

    test('defaults to all available if caseLimit is not provided', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2' }, documentLinks: [{ url: 'u2' }] },
        ];

        // No caseLimit in options
        const result = await processScrapedCases(casesToProcess, jest.fn(), { enableVisualizer: false });
        
        expect(result.processedCases).toHaveLength(2);
    });

    test('keeps visualizer enabled by default when only caseLimit is passed', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
        ];

        await processScrapedCases(casesToProcess, jest.fn(), { caseLimit: 1 });

        expect(mockVisualizerCall).toHaveBeenCalledTimes(1);
    });

    test('does not run visualizer when explicitly disabled', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
        ];

        await processScrapedCases(casesToProcess, jest.fn(), { caseLimit: 1, enableVisualizer: false });

        expect(mockVisualizerCall).not.toHaveBeenCalled();
    });

    test('does not append unrelated expansion entries into the selected primary cluster', async () => {
        const fixture = require('../fixtures/analysis-baselines/undercovered-primary-cluster-expansion.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                caseLimit: 1,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata,
                clusterExpansion: fixture.clusterExpansion
            },
        );

        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].caseResult.caseNumber).toBe('ST-700/2024');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['ST-123/2026']);
        expect(result.discoverySummary.clusters.map(cluster => cluster.clusterId)).toEqual(['ST-700/2024', 'ST-123/2026']);
        expect(result.discoverySummary.expansion.skippedEntryCount).toBe(1);
    });

    test('keeps anonymous clusters uniquely addressable during selection', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'N/A', title: 'Anon older', date: '01.01.2024', participants: [] }, documentLinks: [{ url: 'u-anon-1' }] },
            { caseInfo: { caseNumber: 'N/A', title: 'Anon newer', date: '15.03.2025', participants: [] }, documentLinks: [{ url: 'u-anon-2' }] },
            { caseInfo: { caseNumber: 'C_TRACKED', title: 'Tracked', date: '01.02.2025', participants: [] }, documentLinks: [{ url: 'u-tracked-1' }] },
            { caseInfo: { caseNumber: 'C_TRACKED', title: 'Tracked 2', date: '05.02.2025', participants: [] }, documentLinks: [{ url: 'u-tracked-2' }] },
        ];

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            { caseLimit: 3, enableVisualizer: false },
        );

        const anonymousOne = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'anonymous-1');
        const anonymousTwo = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'anonymous-2');

        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C_TRACKED');
        expect(anonymousOne.newestEntryDate).toBe('2024-01-01T00:00:00.000Z');
        expect(anonymousTwo.newestEntryDate).toBe('2025-03-15T00:00:00.000Z');
        expect(anonymousOne.score).not.toBe(anonymousTwo.score);
        expect(result.processedCases.map(cluster => cluster.groupMetadata.clusterId)).toEqual([
            'C_TRACKED',
            'anonymous-2',
            'anonymous-1'
        ]);
    });
});
