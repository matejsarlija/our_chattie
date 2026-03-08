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
});
