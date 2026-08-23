// Mock dependencies
const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockVisualizerCall = jest.fn();
const mockSynthesizeReport = jest.fn();
const mockVerifyReport = jest.fn((report) => Promise.resolve(report));
const mockNormalizeReasoningEvidence = jest.fn((evidencePackage) => ({
    timeline: [],
    claims: [],
    meta: { clusterId: evidencePackage?.clusterId }
}));

jest.mock('../court-analysis/agents/download-agent', () => ({
    DownloadDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockDownloadCall
    }))
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
    AnalyzeDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockAnalyzeCall
    })),
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation(p => Promise.resolve(p))
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
    VisualizerTool: jest.fn().mockImplementation(() => ({
        _call: mockVisualizerCall
    }))
}));

jest.mock('../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport
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

const { processScrapedCases } = require('../court-analysis/pipeline');

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
        mockSynthesizeReport.mockResolvedValue({
            schemaVersion: '1.0.0',
            narrative: 'Structured report',
            claims: [],
            findings: [],
            openQuestions: [],
            nextSteps: [],
            conflicts: [],
            meta: {}
        });
    });

    test('respects caseLimit for discovery but reasons only over the top-ranked primary cluster', async () => {
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
        
        expect(result.discoverySummary.clusters.map(cluster => cluster.clusterId)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C1');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['C2', 'C3', 'C4', 'C5']);
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].caseResult.caseNumber).toBe('C1');
        expect(result.report).toEqual(expect.objectContaining({ schemaVersion: '1.0.0' }));
        expect(mockDownloadCall).toHaveBeenCalledTimes(1);
        expect(mockAnalyzeCall).toHaveBeenCalledTimes(1);
    });

    test('returns requested unique-case count in discovery when scraped input contains duplicates', async () => {
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

        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(4);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C1');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['C2', 'C3', 'C4']);
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C1']);
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

        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C_COVERED');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['C_NEW', 'C_MID']);
        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C_COVERED']);
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

        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C_HIGH');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['C_LOW', 'C_MED']);
        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C_HIGH']);
    });

    test('handles caseLimit greater than available clusters', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2' }, documentLinks: [{ url: 'u2' }] },
        ];

        const options = { caseLimit: 5, enableVisualizer: false };
        const result = await processScrapedCases(casesToProcess, jest.fn(), options);
        
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(2);
        expect(result.processedCases).toHaveLength(1);
    });

    test('defaults to all available if caseLimit is not provided', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C1', title: 'T1' }, documentLinks: [{ url: 'u1' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2' }, documentLinks: [{ url: 'u2' }] },
        ];

        // No caseLimit in options
        const result = await processScrapedCases(casesToProcess, jest.fn(), { enableVisualizer: false });
        
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(2);
        expect(result.processedCases).toHaveLength(1);
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
        expect(anonymousOne.selectionDiagnostics).toEqual(expect.objectContaining({
            queryType: null,
            finalSelectionScore: anonymousOne.score
        }));
        expect(anonymousTwo.selectionDiagnostics.recencyScore).toBeGreaterThan(
            anonymousOne.selectionDiagnostics.recencyScore
        );
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['anonymous-1', 'anonymous-2']);
        expect(result.processedCases.map(cluster => cluster.groupMetadata.clusterId)).toEqual(['C_TRACKED']);
    });

    test('marks only the primary cluster as selected for reasoning in discovery output', async () => {
        const casesToProcess = [
            { caseInfo: { caseNumber: 'C_PRIMARY', title: 'Primary', date: '01.03.2025' }, documentLinks: [{ url: 'u-primary-1' }, { url: 'u-primary-2' }] },
            { caseInfo: { caseNumber: 'C_PRIMARY', title: 'Primary 2', date: '02.03.2025' }, documentLinks: [{ url: 'u-primary-3' }] },
            { caseInfo: { caseNumber: 'C_PRIMARY', title: 'Primary 3', date: '01.01.2024' }, documentLinks: [{ url: 'u-primary-4' }] },
            { caseInfo: { caseNumber: 'C_SECONDARY', title: 'Secondary', date: '03.03.2025' }, documentLinks: [{ url: 'u-secondary-1' }] },
        ];

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            { caseLimit: 2, enableVisualizer: false },
        );

        const primaryCluster = result.discoverySummary.clusters.find((cluster) => cluster.clusterId === 'C_PRIMARY');
        const secondaryCluster = result.discoverySummary.clusters.find((cluster) => cluster.clusterId === 'C_SECONDARY');

        expect(result.discoverySummary.reasoningScope).toBe('single-cluster');
        expect(result.discoverySummary.reasoningClusterId).toBe('C_PRIMARY');
        expect(primaryCluster.selectedForReasoning).toBe(true);
        expect(secondaryCluster.selectedForReasoning).toBe(false);
        expect(result.processedCases[0].groupMetadata.selectionScore).toBe(primaryCluster.score);
        expect(result.processedCases[0].groupMetadata.selectionDiagnostics).toEqual(primaryCluster.selectionDiagnostics);
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].groupMetadata.selectedForReasoning).toBe(true);
    });

    test('does not create an expansion plan for a sufficiently covered primary cluster', async () => {
        const casesToProcess = Array.from({ length: 12 }, (_, index) => ({
            caseInfo: {
                caseNumber: 'C_SUFFICIENT',
                title: `Covered ${index + 1}`,
                date: index === 0 ? '01.06.2025' : '01.01.2024'
            },
            documentLinks: [{ url: `u-sufficient-${index + 1}` }]
        }));

        const result = await processScrapedCases(
            casesToProcess,
            jest.fn(),
            {
                caseLimit: 1,
                enableVisualizer: false,
                query: { type: 'case_number', value: 'C_SUFFICIENT' }
            },
        );

        const primaryCluster = result.discoverySummary.clusters.find((cluster) => cluster.clusterId === 'C_SUFFICIENT');

        expect(result.discoverySummary.expansionEligibility.eligible).toBe(false);
        expect(result.discoverySummary.expansionEligibility.blockerReasons).toEqual(['primary-cluster-already-sufficient']);
        expect(result.discoverySummary.expansionPlan).toBeNull();
        expect(primaryCluster.expansionPlan).toBeNull();
        expect(result.processedCases[0].groupMetadata.expansionPlan).toBeNull();
    });
});
