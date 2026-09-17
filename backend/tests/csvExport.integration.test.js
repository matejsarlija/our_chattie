const path = require('path');
const fs = require('fs');
const { CsvExportClient } = require('../scraper/csvExportClient');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'csv-export');

const mockDownloadCall = jest.fn();
const mockAnalyzeCall = jest.fn();
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
    }))
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation((p) => Promise.resolve(p))
}));

jest.mock('../court-analysis/agents/visualizer-agent', () => ({
    VisualizerTool: jest.fn()
}));

jest.mock('../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport
}));

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        invoke: jest.fn().mockResolvedValue({ content: '[]' })
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
    unlink: jest.fn((filePath, cb) => cb && cb(null))
}));

const { processScrapedCases } = require('../court-analysis/pipeline');

function fixtureText(name) {
    return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

function csvClient() {
    return new CsvExportClient({ fetcher: async () => fixtureText('oib-66124057408.csv') });
}

describe('CSV export discovery → pipeline handoff', () => {
    beforeEach(() => {
        mockDownloadCall.mockReset();
        mockAnalyzeCall.mockReset();

        mockDownloadCall.mockImplementation(({ documentLinks }) => {
            return Promise.resolve((documentLinks || []).map((link, index) => ({
                filePath: `/tmp/fake_${index}.pdf`,
                url: link.url
            })));
        });

        mockAnalyzeCall.mockResolvedValue({
            individualAnalyses: [],
            finalSummary: 'Analysis'
        });
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

    test('groups the complete export into a dominant primary cluster with secondary clusters', async () => {
        const client = csvClient();
        const { casesToProcess, discoveryMetadata } = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408', null, Infinity, false
        );

        expect(casesToProcess).toHaveLength(381);
        expect(discoveryMetadata.discoveryMode).toBe('csv-export');
        expect(discoveryMetadata.totalResults).toBe(381);

        const result = await processScrapedCases(casesToProcess, jest.fn(), {
            caseLimit: 5,
            enableVisualizer: false,
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata
        });

        expect(result.discoverySummary.discoveryMode).toBe('csv-export');
        expect(result.discoverySummary.totalResults).toBe(381);
        expect(result.discoverySummary.acquisitionModes).toEqual(['csv-export']);
        expect(result.discoverySummary.rawEntryCount).toBe(381);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBeGreaterThan(1);

        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');

        const primary = result.discoverySummary.clusters.find((c) => c.clusterId === 'ST-2/2013');
        expect(primary).toBeDefined();
        expect(primary.entryCount).toBe(343);
        expect(primary.identityConsistency).toBe('consistent');
        expect(primary.participantOibs).toContain('66124057408');
        expect(primary.acquisitionModes).toEqual(['csv-export']);
        expect(primary.selectedForReasoning).toBe(true);

        // Complete coverage: the primary cluster is already sufficient, so the
        // deterministic expansion path must not be eligible.
        expect(result.discoverySummary.expansionEligibility.eligible).toBe(false);
        expect(result.discoverySummary.expansion).toBeUndefined();

        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].groupMetadata.clusterId).toBe('ST-2/2013');
        expect(result.processedCases[0].groupMetadata.acquisitionModes).toEqual(['csv-export']);
        expect(result.processedCases[0].caseResult.debtorOib).toBe('66124057408');
    });

    test('bounded (default) discovery feeds a single-cluster window while totalResults stays complete', async () => {
        const client = csvClient();
        const { casesToProcess, discoveryMetadata } = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408', null, null, false
        );

        expect(casesToProcess).toHaveLength(30);
        expect(discoveryMetadata.totalResults).toBe(381);
        expect(discoveryMetadata.rawParsedEntryCount).toBe(30);

        const result = await processScrapedCases(casesToProcess, jest.fn(), {
            caseLimit: 5,
            enableVisualizer: false,
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata
        });

        expect(result.discoverySummary.totalResults).toBe(381);
        expect(result.discoverySummary.rawEntryCount).toBe(30);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(1);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.secondaryClusterIds).toEqual([]);
    });
});
