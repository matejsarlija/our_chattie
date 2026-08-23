const mockSearchAndGetLatestCasesWithDocuments = jest.fn();
const mockSearchAndGetLatestCases = jest.fn();
const mockInit = jest.fn();
const mockClose = jest.fn();
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

jest.mock('../scraper/courtSearchPuppeteer', () => {
    return jest.fn().mockImplementation(() => ({
        init: mockInit,
        close: mockClose,
        searchAndGetLatestCases: mockSearchAndGetLatestCases,
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
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
    VisualizerTool: jest.fn().mockImplementation(() => ({
        _call: mockVisualizerCall,
    })),
}));

jest.mock('../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence,
}));

jest.mock('../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport,
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

const { runCourtAnalysis, runCourtDiscovery } = require('../court-analysis/pipeline');

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
        mockSearchAndGetLatestCases.mockResolvedValue({
            casesToProcess: [
                { caseInfo: { caseNumber: 'C1', title: 'T1-A', participants: [] }, documentLinks: [{ url: 'u1a' }] },
                { caseInfo: { caseNumber: 'C1', title: 'T1-B', participants: [] }, documentLinks: [{ url: 'u1b' }] },
                { caseInfo: { caseNumber: 'C2', title: 'T2-A', participants: [] }, documentLinks: [] },
            ],
            discoveryMetadata: {
                discoveryMode: 'search-window',
                acquisitionModes: ['search-window'],
                searchWindows: [{ mode: 'search-window', currentPage: 1, pagesScanned: 1, hasNextPage: true, rawParsedEntryCount: 3 }],
                totalResults: 3,
                totalPages: 1,
                pagesScanned: 1,
                currentPage: 1,
                hasNextPage: false,
                rawParsedEntryCount: 3
            }
        });

        mockDownloadCall.mockImplementation(({ documentLinks }) => Promise.resolve(
            documentLinks.map((link, idx) => ({ filePath: `/tmp/pipeline_${idx}.pdf`, url: link.url })),
        ));
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
            meta: { clusterId: 'C1' },
        });
    });

    test('keeps discovery breadth but reasons only over the selected primary cluster', async () => {
        const progress = jest.fn();
        const result = await runCourtAnalysis('66124057408', { caseLimit: 3, enableVisualizer: false }, progress);

        expect(mockSearchAndGetLatestCasesWithDocuments).toHaveBeenCalledWith('66124057408', null, null, true);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(4);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C1');
        expect(result.discoverySummary.secondaryClusterIds).toEqual(['C2', 'C3', 'C4']);
        expect(result.discoverySummary.reasoningScope).toBe('single-cluster');
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases.map(c => c.caseResult.caseNumber)).toEqual(['C1']);
        expect(mockDownloadCall).toHaveBeenCalledTimes(1);
        expect(mockAnalyzeCall).toHaveBeenCalledTimes(1);
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ step: 'grouping' }));
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ step: 'verifying' }));
        expect(progress).toHaveBeenCalledWith(expect.objectContaining({ step: 'complete', progress: 100 }));
        expect(mockClose).toHaveBeenCalledTimes(1);
    });

    test('enables visualizer by default when only caseLimit is provided', async () => {
        await runCourtAnalysis('66124057408', { caseLimit: 1 }, jest.fn());
        expect(mockVisualizerCall).toHaveBeenCalledTimes(1);
    });

    test('threads resolved typed query into discovery and the selected-cluster evidence package', async () => {
        const query = { type: 'oib', value: '66124057408' };

        const result = await runCourtAnalysis(
            query.value,
            { caseLimit: 3, enableVisualizer: false, query },
            jest.fn()
        );

        expect(result.discoverySummary.query).toEqual(query);
        expect(result.clusterEvidencePackage.query).toEqual(query);
        expect(result.clusterEvidencePackage.clusterId).toBe(result.discoverySummary.reasoningClusterId);
        expect(mockSynthesizeReport).toHaveBeenCalledWith(expect.objectContaining({
            meta: expect.objectContaining({
                clusterId: result.clusterEvidencePackage.clusterId,
                retrieval: expect.any(Object),
            }),
        }), expect.objectContaining({
            tracker: expect.any(Object),
        }));
        expect(result.report).toEqual(expect.objectContaining({
            schemaVersion: '1.0.0',
            narrative: 'Structured report',
        }));
    });

    test('runCourtDiscovery stops after discovery and returns authoritative metadata without invoking analysis tools', async () => {
        mockSearchAndGetLatestCases.mockResolvedValue({
            casesToProcess: [
                { caseInfo: { caseNumber: 'C1', title: 'T1-A', participants: [{ name: 'KERUM d.o.o.', oib: '11111111111' }] }, acquisition: { mode: 'search-window', currentPage: 1 }, documentLinks: [{ url: 'u1a' }] },
                { caseInfo: { caseNumber: 'C1', title: 'T1-B', participants: [{ name: 'KERUM d.o.o.', oib: '11111111111' }] }, acquisition: { mode: 'search-window', currentPage: 1 }, documentLinks: [{ url: 'u1b' }] },
                { caseInfo: { caseNumber: 'C2', title: 'T2-A', participants: [{ name: 'KERUM d.o.o.', oib: 'N/A' }] }, acquisition: { mode: 'search-window', currentPage: 1 }, documentLinks: [{ url: 'u2a' }] },
            ],
            discoveryMetadata: {
                discoveryMode: 'search-window',
                acquisitionModes: ['search-window'],
                searchWindows: [{ mode: 'search-window', currentPage: 1, pagesScanned: 1, hasNextPage: true, rawParsedEntryCount: 4 }],
                totalResults: 12,
                totalPages: 3,
                pagesScanned: 1,
                currentPage: 1,
                hasNextPage: true,
                rawParsedEntryCount: 4
            }
        });

        const result = await runCourtDiscovery('66124057408', { caseLimit: 2 }, jest.fn());

        expect(mockSearchAndGetLatestCases).toHaveBeenCalledWith('66124057408', null, null, true);
        expect(result.discoverySummary.totalResults).toBe(12);
        expect(result.discoverySummary.totalPages).toBe(3);
        expect(result.discoverySummary.rawEntryCount).toBe(4);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('C1');
        expect(result.primaryCluster.participantOibs).toEqual(['11111111111']);
        expect(mockDownloadCall).not.toHaveBeenCalled();
        expect(mockAnalyzeCall).not.toHaveBeenCalled();
        expect(mockVisualizerCall).not.toHaveBeenCalled();
    });

    test('runCourtDiscovery bases discovery on the full search window even when entries lack download links', async () => {
        mockSearchAndGetLatestCases.mockResolvedValue({
            casesToProcess: [
                { caseInfo: { caseNumber: 'C-NO-DOC-1', title: 'No Doc 1', participants: [] }, acquisition: { mode: 'search-window', currentPage: 1 }, documentLinks: [] },
                { caseInfo: { caseNumber: 'C-NO-DOC-2', title: 'No Doc 2', participants: [] }, acquisition: { mode: 'search-window', currentPage: 1 }, documentLinks: [] },
            ],
            discoveryMetadata: {
                discoveryMode: 'search-window',
                acquisitionModes: ['search-window'],
                searchWindows: [{ mode: 'search-window', currentPage: 1, pagesScanned: 1, hasNextPage: true, rawParsedEntryCount: 2 }],
                totalResults: 27,
                totalPages: 5,
                pagesScanned: 1,
                currentPage: 1,
                hasNextPage: true,
                rawParsedEntryCount: 2
            }
        });

        const result = await runCourtDiscovery('bez-dokumenata', { caseLimit: 2 }, jest.fn());

        expect(result.discoverySummary.totalResults).toBe(27);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(2);
        expect(result.primaryCluster.clusterId).toBe('C-NO-DOC-1');
        expect(result.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['C-NO-DOC-2']);
    });

    test('runCourtDiscovery forwards clusterExpansion through the public options object', async () => {
        const fixture = require('../fixtures/analysis-baselines/undercovered-primary-cluster-expansion.json');

        mockSearchAndGetLatestCases.mockResolvedValue({
            casesToProcess: fixture.casesToProcess,
            discoveryMetadata: fixture.discoveryMetadata
        });

        const result = await runCourtDiscovery('KERUM', {
            caseLimit: 1,
            query: fixture.query,
            clusterExpansion: fixture.clusterExpansion
        }, jest.fn());

        expect(result.discoverySummary.expansion).toEqual(expect.objectContaining({
            status: 'applied',
            expandedClusterId: 'ST-700/2024',
            appendedEntryCount: 2
        }));
    });
});
