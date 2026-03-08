const mockSearchAndGetLatestCasesWithDocuments = jest.fn();
const mockInit = jest.fn();
const mockClose = jest.fn();
const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
const mockVisualizerCall = jest.fn();

jest.mock('../scraper/courtSearchPuppeteer', () => {
    return jest.fn().mockImplementation(() => ({
        init: mockInit,
        close: mockClose,
        searchAndGetLatestCasesWithDocuments: mockSearchAndGetLatestCasesWithDocuments,
    }));
});

jest.mock('../court-analysis/agents/download-agent', () => ({
    DownloadDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockDownloadCall,
    })),
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
    AnalyzeDocumentsTool: jest.fn().mockImplementation(() => ({
        _call: mockAnalyzeCall,
    })),
    generateComparativeAnalysis: jest.fn().mockResolvedValue('Comparative Analysis'),
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
    VisualizerTool: jest.fn().mockImplementation(() => ({
        _call: mockVisualizerCall,
    })),
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation((p) => Promise.resolve(p)),
}));

jest.mock('adm-zip', () => {
    return jest.fn().mockImplementation(() => ({
        getEntries: jest.fn().mockReturnValue([]),
        extractEntryTo: jest.fn(),
    }));
});

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    unlink: jest.fn((path, cb) => cb && cb(null)),
}));

const { runCourtAnalysis } = require('../court-analysis/pipeline');

describe('runCourtAnalysis pipeline (deterministic)', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([
            { caseInfo: { caseNumber: 'C1', title: 'T1-A', participants: [] }, documentLinks: [{ url: 'u1a' }] },
            { caseInfo: { caseNumber: 'C1', title: 'T1-B', participants: [] }, documentLinks: [{ url: 'u1b' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2-A', participants: [] }, documentLinks: [{ url: 'u2a' }] },
            { caseInfo: { caseNumber: 'C2', title: 'T2-B', participants: [] }, documentLinks: [{ url: 'u2b' }] },
            { caseInfo: { caseNumber: 'C3', title: 'T3-A', participants: [] }, documentLinks: [{ url: 'u3a' }] },
            { caseInfo: { caseNumber: 'C4', title: 'T4-A', participants: [] }, documentLinks: [{ url: 'u4a' }] },
        ]);

        mockDownloadCall.mockImplementation(({ documentLinks }) => Promise.resolve(
            documentLinks.map((link, idx) => ({ filePath: `/tmp/pipeline_${idx}.pdf`, url: link.url })),
        ));
        mockAnalyzeCall.mockResolvedValue({ individualAnalyses: [], finalSummary: 'Analysis' });
        mockVisualizerCall.mockResolvedValue('graph TD; A-->B');
    });

    test('preserves unique-case limit after grouping duplicate scraped entries', async () => {
        const progress = jest.fn();
        const result = await runCourtAnalysis('66124057408', { caseLimit: 3, enableVisualizer: false }, progress);

        expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', 9);
        expect(result.processedCases).toHaveLength(3);
        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C1', 'C2', 'C3']);
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ step: 'grouping' }));
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ step: 'complete', progress: 100 }));
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('enables visualizer by default when only caseLimit is provided', async () => {
        await runCourtAnalysis('66124057408', { caseLimit: 1 }, jest.fn());
        expect(mockVisualizerCall).toHaveBeenCalledTimes(1);
    });
});
