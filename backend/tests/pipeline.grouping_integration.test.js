const { processScrapedCases } = require('../court-analysis/pipeline');
const path = require('path');

// Setup spies
const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();

// Mock dependencies
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
    unlink: jest.fn((path, cb) => cb && cb(null))
}));

describe('processScrapedCases Grouping Integration', () => {
    beforeEach(() => {
        mockDownloadCall.mockReset();
        mockAnalyzeCall.mockReset();
        
        // Setup default behavior
        mockDownloadCall.mockImplementation(({ documentLinks }) => {
            return Promise.resolve(documentLinks.map((l, i) => ({ 
                filePath: `/tmp/fake_${i}.pdf`, 
                url: l.url 
            })));
        });
        
        mockAnalyzeCall.mockResolvedValue({ individualAnalyses: [], finalSummary: 'Analysis' });
    });

    test('groups entries and processes them as clusters', async () => {
        const casesToProcess = [
            {
                caseInfo: { caseNumber: 'ST-1/23', title: 'Entry A' },
                documentLinks: [{ url: 'http://doc1' }]
            },
            {
                caseInfo: { caseNumber: 'ST-1/23', title: 'Entry B' },
                documentLinks: [{ url: 'http://doc2' }]
            },
            {
                caseInfo: { caseNumber: 'ST-2/23', title: 'Entry C' },
                documentLinks: [{ url: 'http://doc3' }]
            }
        ];

        const progressCallback = jest.fn();
        
        const result = await processScrapedCases(casesToProcess, progressCallback);
        
        // Expect 2 processed cases (clusters) because ST-1/23 are grouped
        expect(result.processedCases).toHaveLength(2);
        
        // Verify cluster 1 (ST-1/23)
        const cluster1 = result.processedCases.find(c => c.caseResult.caseNumber === 'ST-1/23');
        expect(cluster1).toBeDefined();
        expect(cluster1.groupMetadata.entryCount).toBe(2);
        
        // Verify DownloadDocumentsTool calls
        // It should be called twice (once per cluster)
        expect(mockDownloadCall).toHaveBeenCalledTimes(2);
        
        // Check that the ST-1/23 cluster call got both document links
        // We look for the call that had 2 links
        const cluster1Call = mockDownloadCall.mock.calls.find(args => args[0].documentLinks.length === 2);
        expect(cluster1Call).toBeDefined();
        
        const links = cluster1Call[0].documentLinks.map(l => l.url);
        expect(links).toContain('http://doc1');
        expect(links).toContain('http://doc2');

        // Check that result includes groupMetadata
        expect(cluster1.groupMetadata).toEqual({
            entryCount: 2,
            isAnonymous: false
        });
    });
});
