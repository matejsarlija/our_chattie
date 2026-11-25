const path = require('path');

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
    downloadClusterAttachments: mockDownloadCall,
}));

jest.mock('../court-analysis/agents/analysis-agent', () => ({
    analyzeClusterDocuments: mockAnalyzeCall,
}));

jest.mock('../court-registry/enricher', () => ({
    enrichParticipants: jest.fn().mockImplementation(p => Promise.resolve(p))
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

const { processScrapedCases, buildDiscoveryResult, PartialAnalysisError } = require('../court-analysis/pipeline');

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

    test('keeps primary and secondary clusters explicit for mixed multi-cluster discovery fixture', async () => {
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
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
        expect(result.discoverySummary.reasoningScope).toBe('single-cluster');
        expect(result.discoverySummary.heuristics).toBeDefined();
        expect(result.discoverySummary.heuristics.action).toBeDefined();
        expect(result.discoverySummary.heuristics.reason).toBeDefined();
        expect(result.discoverySummary.reasoningClusterId).toBe('ST-100/2023');
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
        expect(primaryCluster.selectedForReasoning).toBe(true);
        expect(secondaryCluster.identityConsistency).toBe('unresolved');
        expect(secondaryCluster.identityNotes.join(' ')).toContain('missing');
        expect(secondaryCluster.selectedForReasoning).toBe(false);
        expect(result.primaryCluster.clusterId).toBe('ST-100/2023');
        expect(result.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['ST-200/2021', 'ST-300/2020']);
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].caseResult.caseNumber).toBe('ST-100/2023');
    });

    test('analyzes the full 50-entry single-cluster window (3b full document history)', async () => {
        const fixture = require('../fixtures/analysis-baselines/single-cluster-paginated.json');
        expect(fixture.casesToProcess).toHaveLength(50);

        mockAnalyzeCall.mockImplementation(({ files }) => Promise.resolve({
            individualAnalyses: files.map((file, index) => ({
                text: file.text,
                filePath: file.filePath,
                aiResult: {
                    caseNumber: 'ST-2/2013',
                    decisionDate: null,
                    summary: `Dokument ${index + 1}`
                }
            })),
            finalSummary: 'Analysis'
        }));

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.discoverySummary.rawEntryCount).toBe(50);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(1);
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.secondaryClusterIds).toEqual([]);

        const primary = result.discoverySummary.clusters[0];
        expect(primary.entryCount).toBe(50);
        expect(primary.documentCount).toBe(50);

        // Full document history: every merged documentLink is downloaded and analyzed.
        expect(mockDownloadCall).toHaveBeenCalledTimes(1);
        expect(mockDownloadCall.mock.calls[0][0].documentLinks).toHaveLength(50);
        expect(mockAnalyzeCall).toHaveBeenCalledTimes(1);
        expect(mockAnalyzeCall.mock.calls[0][0].files).toHaveLength(50);
        expect(result.clusterEvidencePackage.documentLinks).toHaveLength(50);
        expect(result.clusterEvidencePackage.coverage).toEqual(expect.objectContaining({
            analyzed: 50,
            total: 50,
            complete: true
        }));
    });

    test('surfaces structured money-flow from analyzed documents (3c money-flow reconstruction)', async () => {
        const fixture = require('../fixtures/analysis-baselines/single-cluster-paginated.json');
        const entries = fixture.casesToProcess.slice(0, 3);

        mockAnalyzeCall.mockImplementation(({ files }) => Promise.resolve({
            individualAnalyses: files.map((file, index) => ({
                text: file.text,
                filePath: file.filePath,
                aiResult: {
                    caseNumber: 'ST-2/2013',
                    summary: index === 0
                        ? 'Isplata drugog višeg isplatnog reda u iznosu od 1.200.000,00 EUR.'
                        : 'Procesno rješenje bez financijskog sadržaja.',
                    amounts: index === 0
                        ? [{ description: 'Isplata drugog višeg isplatnog reda', amount: '1.200.000,00', currency: 'EUR', date: '2025-12-17' }]
                        : []
                }
            })),
            finalSummary: 'Analysis'
        }));

        const result = await processScrapedCases(
            entries,
            jest.fn(),
            {
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.clusterEvidencePackage.flows).toEqual(expect.objectContaining({
            count: 1,
            hasFlows: true,
            currencyTotals: { EUR: 1200000.00 }
        }));
        expect(result.clusterEvidencePackage.flows.entries[0]).toEqual(expect.objectContaining({
            kind: 'amount',
            sourceAmount: 1200000.00,
            amountEur: 1200000.00,
            sourceCurrency: 'EUR',
            description: 'Isplata drugog višeg isplatnog reda',
            caseNumber: 'ST-2/2013'
        }));
    });

    test('retains sparse single-cluster eligibility while exposing search-window metadata and unresolved identity', async () => {
        const fixture = require('../fixtures/analysis-baselines/sparse-single-cluster-discovery.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
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
        expect(onlyCluster.selectedForReasoning).toBe(true);
    });

    test('keeps dense dominant cluster coverage metrics and query-oib identity signals authoritative before selection', async () => {
        const fixture = require('../fixtures/analysis-baselines/dense-dominant-cluster.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
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
        expect(dominantCluster.selectedForReasoning).toBe(true);
        expect(secondaryCluster.identityConsistency).toBe('ambiguous');
        expect(secondaryCluster.identityNotes.join(' ')).toContain('33333333333');
        expect(secondaryCluster.selectedForReasoning).toBe(false);
    });

    test('prefers a denser identity-consistent primary cluster over a newer ambiguous text-query cluster', async () => {
        const fixture = require('../fixtures/analysis-baselines/text-query-ambiguous-clusters.json');

        const result = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
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
        expect(primaryCluster.selectionDiagnostics).toEqual(expect.objectContaining({
            queryType: 'text',
            identityMultiplier: 1,
            finalSelectionScore: primaryCluster.score
        }));
        expect(primaryCluster.selectionDiagnostics.entryCoverageScore).toBeGreaterThan(
            secondaryCluster.selectionDiagnostics.entryCoverageScore
        );
        expect(primaryCluster.selectionDiagnostics.dominanceScore).toBeGreaterThan(
            secondaryCluster.selectionDiagnostics.dominanceScore
        );
        expect(primaryCluster.selectedForReasoning).toBe(true);

        expect(secondaryCluster.identityConsistency).toBe('ambiguous');
        expect(secondaryCluster.participantOibs).toEqual(['66666666666', '77777777777']);
        expect(secondaryCluster.selectionDiagnostics.identityMultiplier).toBe(0.35);
        expect(secondaryCluster.selectedForReasoning).toBe(false);
        expect(result.primaryCluster.clusterId).toBe('ST-410/2022');
        expect(result.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['ST-999/2026']);
        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].caseResult.caseNumber).toBe('ST-410/2022');
    });


    test('attaches partial discovery results when a later analysis stage fails', async () => {
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');

        mockAnalyzeCall.mockRejectedValue(new Error('Dokument se ne može analizirati (HTTP 500)'));
        mockSynthesizeReport.mockClear();

        const error = await processScrapedCases(
            fixture.casesToProcess,
            jest.fn(),
            {
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        ).catch((err) => err);

        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(PartialAnalysisError);
        expect(error.name).toBe('PartialAnalysisError');
        expect(error.stage).toBe('reasoning');
        expect(error.partialResult).toBeDefined();
        expect(error.partialResult.discoverySummary).toEqual(expect.objectContaining({
            reasoningClusterId: 'ST-100/2023',
            recommendedPrimaryClusterId: 'ST-100/2023',
            secondaryClusterIds: ['ST-200/2021', 'ST-300/2020'],
            capturedDistinctCaseCount: 3
        }));
        expect(error.partialResult.primaryCluster.clusterId).toBe('ST-100/2023');
        expect(error.partialResult.clusterEvidencePackage).toEqual(expect.objectContaining({
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023'
        }));
        expect(error.partialResult.secondaryClusters.map(cluster => cluster.clusterId)).toEqual(['ST-200/2021', 'ST-300/2020']);
        expect(error.partialResult.comparativeAnalysis).toBeNull();
        expect(error.partialResult.report).toBeNull();
        expect(mockSynthesizeReport).not.toHaveBeenCalled();
    });

    test('degrades gracefully instead of throwing when the reasoning report stage fails', async () => {
        // Report generation failures (dense-cluster JSON truncation, transient
        // model errors, etc.) must not discard the already-succeeded, real-money
        // per-document analyses. Unlike an earlier analysis-stage failure (see
        // the previous test), this one no longer propagates as a
        // PartialAnalysisError — it resolves normally with report: null and a
        // reportError message, exactly like rerank/planner already degrade.
        const fixture = require('../fixtures/analysis-baselines/mixed-multi-cluster.json');

        mockSynthesizeReport.mockRejectedValue(new Error('Dnevni limit AI analize je iscrpljen.'));
        const progress = jest.fn();

        const result = await processScrapedCases(
            fixture.casesToProcess,
            progress,
            {
                query: fixture.query,
                discoveryMetadata: fixture.discoveryMetadata
            }
        );

        expect(result.processedCases).toHaveLength(1);
        expect(result.processedCases[0].caseResult.caseNumber).toBe('ST-100/2023');
        expect(result.report).toBeNull();
        expect(result.reportError).toBe('Dnevni limit AI analize je iscrpljen.');
        // No per-document summaries exist in this fixture's mocked analyses, so
        // the fallback overview (built from allProcessedCases) is empty rather
        // than null — the function returned successfully, it just had nothing
        // to report on.
        expect(result.comparativeAnalysis).toBe('');
        expect(result.clusterEvidencePackage.clusterId).toBe('ST-100/2023');
    });
});

describe('buildDiscoveryResult on frozen 66124057408 baseline (CI, no Gemini)', () => {
    test('groups the 9 real captured e-Oglasna entries into the recorded ST-2/2013 cluster', () => {
        const fixture = require('../fixtures/analysis-baselines/66124057408-baseline.json');

        const result = buildDiscoveryResult(fixture.discovery.entries, {
            query: { type: 'oib', value: '66124057408' }
        });

        expect(fixture.discovery.entries).toHaveLength(9);
        expect(fixture.discovery.count).toBe(9);
        expect(fixture.discovery.caseNumbers).toEqual(['ST-2/2013']);

        expect(result.primaryClusterId).toBe('ST-2/2013');
        expect(result.clusters).toHaveLength(1);
        expect(result.clusters[0].caseNumber || result.clusters[0].clusterId).toBe('ST-2/2013');
        expect(result.clusters[0].entries).toHaveLength(9);
        expect(result.secondaryClusters).toHaveLength(0);
        expect(result.discoverySummary.capturedDistinctCaseCount).toBe(1);
        expect(result.discoverySummary.reasoningClusterId).toBe('ST-2/2013');
        expect(result.discoverySummary.recommendedPrimaryClusterId).toBe('ST-2/2013');
    });
});
