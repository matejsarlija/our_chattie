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
                query: fixture.query
            }
        );

        expect(result.discoverySummary).toBeDefined();
        expect(result.discoverySummary.query).toEqual(fixture.query);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(3);
        expect(result.discoverySummary.rawEntryCount).toBe(6);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-100/2023');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['ST-200/2021', 'ST-300/2020']);

        const primaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-100/2023');
        const secondaryCluster = result.discoverySummary.clusters.find(cluster => cluster.clusterId === 'ST-300/2020');

        expect(primaryCluster.identityConsistency).toBe('consistent');
        expect(primaryCluster.entryCount).toBe(3);
        expect(primaryCluster.documentCount).toBe(3);
        expect(secondaryCluster.identityConsistency).toBe('unresolved');
        expect(secondaryCluster.identityNotes.join(' ')).toContain('missing');
    });
});
