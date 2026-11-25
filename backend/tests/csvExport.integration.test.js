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

jest.mock('../court-analysis/acquisition/downloader', () => ({
    downloadClusterAttachments: mockDownloadCall,
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
    analyzeClusterDocuments: mockAnalyzeCall,
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation((p) => Promise.resolve(p))
}));

jest.mock('../court-analysis/reasoning/synthesis/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../court-analysis/reasoning/synthesis/verifier', () => ({
    verifyReport: mockVerifyReport
}));

jest.mock('../llm/openrouterClient.js', () => ({
    createOpenRouterClient: () => ({ invoke: jest.fn().mockResolvedValue({ content: '[]' }) }),
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

    test('full CSV scan selects the primary cluster and catalogs secondary candidates', async () => {
        const client = csvClient();
        const { casesToProcess, discoveryMetadata } = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408',
            1000,
            Infinity,
            false,
            '66124057408',
            { type: 'oib', value: '66124057408' },
            'full'
        );

        expect(casesToProcess).toHaveLength(343);
        expect(discoveryMetadata.discoveryMode).toBe('csv-export');
        expect(discoveryMetadata.totalResults).toBe(381);
        expect(discoveryMetadata.selection).toEqual(expect.objectContaining({
            selectedCaseKey: 'ST-2/2013',
            rule: 'primary-case-pool',
            allocation: 'all',
            analysisBudget: null,
            poolCap: 1000
        }));
        expect(discoveryMetadata.selection.candidates.map((candidate) => candidate.key)).toContain('ST-357/2013');

        const result = await processScrapedCases(casesToProcess, jest.fn(), {
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata,
            scanDepth: 'full'
        });

        expect(result.discoverySummary.discoveryMode).toBe('csv-export');
        expect(result.discoverySummary.totalResults).toBe(381);
        expect(result.discoverySummary.rawEntryCount).toBe(343);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(1);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');

        const primary = result.discoverySummary.clusters.find((cluster) => cluster.clusterId === 'ST-2/2013');
        expect(primary).toBeDefined();
        expect(primary.entryCount).toBe(343);
        expect(primary.identityConsistency).toBe('consistent');
        expect(primary.participantOibs).toContain('66124057408');
        expect(primary.acquisitionModes).toEqual(['csv-export']);
        expect(primary.selectedForReasoning).toBe(true);
        expect(result.discoverySummary.coverageLedger).toMatchObject({
            budget: 343,
            available: 343,
            selected: 343
        });
    });

    test('balanced discovery supplies the capped primary pool for stratified analysis', async () => {
        const client = csvClient();
        const { casesToProcess, discoveryMetadata } = await client.searchAndGetLatestCasesWithDocuments(
            '66124057408',
            400,
            40,
            true,
            '66124057408',
            { type: 'oib', value: '66124057408' },
            'balanced'
        );

        expect(casesToProcess).toHaveLength(343);
        expect(discoveryMetadata.totalResults).toBe(381);
        expect(discoveryMetadata.rawParsedEntryCount).toBe(343);
        expect(discoveryMetadata.selection).toMatchObject({
            rule: 'primary-case-pool',
            allocation: 'stratified',
            analysisBudget: 100,
            poolCap: 400
        });

        const result = await processScrapedCases(casesToProcess, jest.fn(), {
            query: { type: 'oib', value: '66124057408' },
            discoveryMetadata,
            scanDepth: 'balanced'
        });

        expect(result.discoverySummary.totalResults).toBe(381);
        expect(result.discoverySummary.rawEntryCount).toBe(343);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(1);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.coverageLedger).toMatchObject({
            budget: 100,
            available: 343,
            selected: 100
        });
    });
});
