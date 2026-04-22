const path = require('path');
const { processScrapedCases } = require('../court-analysis/pipeline');

const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();

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
    VisualizerTool: jest.fn()
}));

jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(() => ({
        getEntries: jest.fn().mockReturnValue([]),
        extractEntryTo: jest.fn()
    }));
});

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    unlink: jest.fn((filePath, cb) => cb && cb(null))
}));

describe('processScrapedCases discovery reconciliation', () => {
    beforeEach(() => {
        mockDownloadCall.mockReset();
        mockAnalyzeCall.mockReset();

        mockDownloadCall.mockImplementation(({ documentLinks }) => {
            return Promise.resolve(documentLinks.map((link, index) => ({
                filePath: `/tmp/fake_${index}.pdf`,
                url: link.url
            })));
        });

        mockAnalyzeCall.mockResolvedValue({
            individualAnalyses: [],
            finalSummary: 'Analysis'
        });
    });

    test('keeps primary and secondary clusters explicit for mixed multi-cluster discovery fixture', async () => {
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                caseLimit: 3,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.discoverySummary).toBeDefined();
        expect(result.discoverySummary.query).toEqual(fixture.query);
        expect(result.discoverySummary.discoveryMode).toBe('search-window');
        expect(result.discoverySummary.acquisitionModes).toEqual(['search-window']);
        expect(result.discoverySummary.totalResults).toBe(18);
        expect(result.discoverySummary.totalPages).toBe(3);
        expect(result.discoverySummary.pagesScanned).toBe(1);
        expect(result.discoverySummary.currentPage).toBe(1);
        expect(result.discoverySummary.hasNextPage).toBe(true);
        expect(result.discoverySummary.rawEntryCount).toBe(8);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(3);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-100/2023');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['ST-200/2021', 'ST-300/2020']);

        const primaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-100/2023');
        const secondaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-300/2020');

        expect(primaryCluster.identityConsistency).toBe('consistent');
        expect(primaryCluster.participantOibs).toEqual(['11111111111']);
        expect(primaryCluster.participantNames).toEqual(['KERUM d.o.o.']);
        expect(primaryCluster.acquisitionModes).toEqual(['search-window']);
        expect(primaryCluster.acquisitionProvenance).toEqual([
            expect.objectContaining({ mode: 'search-window', currentPage: 1 })
        ]);
        expect(primaryCluster.entryCount).toBe(3);
        expect(primaryCluster.documentCount).toBe(3);
        expect(secondaryCluster.identityConsistency).toBe('unresolved');
        expect(secondaryCluster.identityNotes.join(' ')).toContain('missing');
        expect(result.primaryCluster.clusterId).toBe('ST-100/2023');
        expect(result.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['ST-200/2021', 'ST-300/2020']);
    });

    test('retains sparse single-cluster eligibility while exposing search-window metadata and unresolved identity', async () => {
        const fixture = require('../fixtures/analysis-baselines/sparse-single-cluster-discovery.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                caseLimit: 1,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.discoverySummary.totalResults).toBe(2);
        expect(result.discoverySummary.totalPages).toBe(1);
        expect(result.discoverySummary.pagesScanned).toBe(1);
        expect(result.discoverySummary.hasNextPage).toBe(false);
        expect(result.discoverySummary.rawEntryCount).toBe(2);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(1);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');

        const onlyCluster = result.discoverySummary.clusters[0];
        expect(onlyCluster.clusterId).toBe('ST-2/2013');
        expect(onlyCluster.entryCount).toBe(1);
        expect(onlyCluster.documentCount).toBe(1);
        expect(onlyCluster.identityConsistency).toBe('unresolved');
        expect(onlyCluster.participantOibs).toEqual([]);
        expect(onlyCluster.participantNames).toEqual(['KERUM d.o.o. u stečaju', 'CRO-GO d.o.o.']);
        expect(onlyCluster.acquisitionModes).toEqual(['search-window']);
    });

    test('keeps dense dominant cluster coverage metrics and query-oib identity signals authoritative before selection', async () => {
        const fixture = require('../fixtures/analysis-baselines/dense-dominant-cluster.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                caseLimit: 2,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.discoverySummary.totalResults).toBe(23);
        expect(result.discoverySummary.totalPages).toBe(4);
        expect(result.discoverySummary.rawEntryCount).toBe(7);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-900/2024');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['ST-901/2023']);

        const dominantCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-900/2024');
        const secondaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-901/2023');

        expect(dominantCluster.entryCount).toBe(5);
        expect(dominantCluster.documentCount).toBe(5);
        expect(dominantCluster.identityConsistency).toBe('consistent');
        expect(dominantCluster.participantOibs).toEqual(['33333333333']);
        expect(secondaryCluster.identityConsistency).toBe('ambiguous');
        expect(secondaryCluster.identityNotes.join(' ')).toContain('33333333333');
    });

    test('prefers a denser identity-consistent primary cluster over a newer ambiguous text-query cluster', async () => {
        const fixture = require('../fixtures/analysis-baselines/text-query-ambiguous-clusters.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                caseLimit: 1,
                enableVisualizer: false,
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.discoverySummary.totalResults).toBe(16);
        expect(result.discoverySummary.rawEntryCount).toBe(6);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(2);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-410/2022');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['ST-999/2026']);

        const primaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-410/2022');
        const secondaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-999/2026');

        expect(primaryCluster.entryCount).toBe(4);
        expect(primaryCluster.documentCount).toBe(4);
        expect(primaryCluster.identityConsistency).toBe('consistent');
        expect(primaryCluster.participantOibs).toEqual(['55555555555']);
        expect(primaryCluster.selectionReason).toContain('coverage');

        expect(secondaryCluster.identityConsistency).toBe('ambiguous');
        expect(secondaryCluster.participantOibs).toEqual(['66666666666', '77777777777']);
        expect(result.primaryCluster.clusterId).toBe('ST-410/2022');
        expect(result.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['ST-999/2026']);
    });

    test('applies bounded expansion only to an under-covered selected cluster while preserving explicit provenance', async () => {
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
            }
        );

        expect(result.discoverySummary.totalResults).toBe(21);
        expect(result.discoverySummary.rawEntryCount).toBe(4);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(2);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-700/2024');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['ST-123/2026']);
        expect(result.discoverySummary.expansion).toEqual(expect.objectContaining({
            status: 'applied',
            expandedClusterId: 'ST-700/2024',
            appliedPasses: 1,
            appendedEntryCount: 2,
            skippedEntryCount: 1
        }));

        const primaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-700/2024');
        const secondaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-123/2026');

        expect(primaryCluster.entryCount).toBe(4);
        expect(primaryCluster.documentCount).toBe(4);
        expect(primaryCluster.acquisitionModes).toEqual(['search-window', 'cluster-expansion']);
        expect(primaryCluster.entryCountsByAcquisitionMode).toEqual({
            'search-window': 2,
            'cluster-expansion': 2
        });
        expect(primaryCluster.documentCountsByAcquisitionMode).toEqual({
            'search-window': 2,
            'cluster-expansion': 2
        });
        expect(primaryCluster.acquisitionProvenance).toEqual(expect.arrayContaining([
            expect.objectContaining({ mode: 'search-window', currentPage: 1, sourceCaseNumber: 'ST-700/2024' }),
            expect.objectContaining({ mode: 'cluster-expansion', sourceCaseNumber: 'ST-700/2024', pass: 1 })
        ]));
        expect(primaryCluster.expansion).toEqual(expect.objectContaining({
            status: 'applied',
            appliedPasses: 1,
            appendedEntryCount: 2
        }));

        expect(secondaryCluster.entryCount).toBe(2);
        expect(secondaryCluster.acquisitionModes).toEqual(['search-window']);
        expect(result.primaryCluster.clusterId).toBe('ST-700/2024');
        expect(result.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['ST-123/2026']);
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].groupMetadata.acquisitionModes).toEqual(['search-window', 'cluster-expansion']);
        expect(result.processedCases[0].groupMetadata.selectedForReasoning).toBe(true);
    });
});
