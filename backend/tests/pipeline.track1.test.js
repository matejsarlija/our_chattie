const mockSearchAndGetLatestCasesWithDocuments = jest.fn();
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
  meta: {
    clusterId: evidencePackage?.clusterId,
    coverage: evidencePackage?.coverage,
    analysesCount: Array.isArray(evidencePackage?.analyses) ? evidencePackage.analyses.length : 0,
  },
}));

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

const { runCourtAnalysis, isUsableAnalysisText } = require('../court-analysis/pipeline');
const { buildClusterEvidencePackage, attachAnalysesToEvidencePackage } = require('../court-analysis/reasoning/evidencePackage');
const { collectSources } = require('../court-analysis/reasoning/indexer');
const realSynthesizer = jest.requireActual('../court-analysis/reasoning/synthesizer');

function buildBaseCluster() {
  return {
    clusterId: 'ST-700/2024',
    caseNumber: 'ST-700/2024',
    isAnonymous: false,
    entries: [
      {
        caseInfo: { caseNumber: 'ST-700/2024', title: 'Zapisnik 1', court: 'TS u Splitu', participants: [] },
        documentLinks: [{ url: 'https://example.com/doc1', text: 'Zapisnik o ispitivanju' }],
      },
    ],
  };
}

function buildDiscoverySummary() {
  return {
    reasoningClusterId: 'ST-700/2024',
    recommendedPrimaryClusterId: 'ST-700/2024',
    secondaryClusterIds: [],
    discoveryMode: 'search-window',
    totalResults: 1,
    totalPages: 1,
    pagesScanned: 1,
    rawEntryCount: 1,
    capturedDistinctCaseCount: 1,
  };
}

describe('Track 1: evidence enrichment (1c)', () => {
  test('attachAnalysesToEvidencePackage attaches successful analyses and computes coverage', () => {
    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const processedCases = [
      {
        groupMetadata: { clusterId: 'ST-700/2024', selectedForReasoning: true },
        caseResult: { caseNumber: 'ST-700/2024' },
        analysis: {
          individualAnalyses: [
            { text: 'doc1.pdf', aiResult: { summary: 'Tražbina od 100.000 EUR.', decisionDate: '2024-01-10', caseNumber: 'ST-700/2024' } },
            { text: 'doc2.pdf', aiResult: { summary: 'Priznata tražbina.', decisionDate: '2024-02-01', caseNumber: 'ST-700/2024' } },
            { text: 'doc3.pdf', error: 'Gemini request timed out after 30000ms' },
          ],
        },
      },
    ];

    const enriched = attachAnalysesToEvidencePackage(pkg, processedCases, 'ST-700/2024');

    expect(enriched.analyses).toHaveLength(2);
    expect(enriched.analyses[0].summary).toBe('Tražbina od 100.000 EUR.');
    expect(enriched.analyses[0].decisionDate).toBe('2024-01-10');
    expect(enriched.coverage).toEqual({
      analyzed: 2,
      failed: 1,
      total: 3,
      coverageRatio: 0.67,
      complete: false,
      failedFiles: [{ fileName: 'doc3.pdf', reason: 'Gemini request timed out after 30000ms' }],
    });
  });

  test('attachAnalysesToEvidencePackage filters to the selected cluster only', () => {
    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const processedCases = [
      {
        groupMetadata: { clusterId: 'ST-700/2024', selectedForReasoning: true },
        caseResult: { caseNumber: 'ST-700/2024' },
        analysis: {
          individualAnalyses: [
            { text: 'doc1.pdf', aiResult: { summary: 'Tražbina.', caseNumber: 'ST-700/2024' } },
          ],
        },
      },
      {
        groupMetadata: { clusterId: 'ST-800/2024', selectedForReasoning: false },
        caseResult: { caseNumber: 'ST-800/2024' },
        analysis: {
          individualAnalyses: [
            { text: 'other.pdf', aiResult: { summary: 'Ne smije ući.', caseNumber: 'ST-800/2024' } },
          ],
        },
      },
    ];

    const enriched = attachAnalysesToEvidencePackage(pkg, processedCases, 'ST-700/2024');

    expect(enriched.analyses).toHaveLength(1);
    expect(enriched.analyses[0].summary).toBe('Tražbina.');
    expect(enriched.coverage.total).toBe(1);
  });

  test('attachAnalysesToEvidencePackage handles null/empty inputs defensively', () => {
    expect(attachAnalysesToEvidencePackage(null, [])).toBeNull();

    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const enriched = attachAnalysesToEvidencePackage(pkg, [], 'ST-700/2024');
    expect(enriched.analyses).toEqual([]);
    expect(enriched.coverage).toEqual({
      analyzed: 0,
      failed: 0,
      total: 0,
      coverageRatio: 0,
      complete: false,
      failedFiles: [],
    });
  });

  test('indexer exposes successful analyses as retrievable sources', () => {
    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const enriched = attachAnalysesToEvidencePackage(pkg, [
      {
        groupMetadata: { clusterId: 'ST-700/2024' },
        analysis: {
          individualAnalyses: [
            { text: 'doc1.pdf', aiResult: { summary: 'Utvrđena tražbina u iznosu od 1.234.567,89 EUR.', decisionDate: '2024-01-10', caseNumber: 'ST-700/2024' } },
          ],
        },
      },
    ], 'ST-700/2024');

    const sources = collectSources(enriched);
    const analysisSources = sources.filter((source) => source.metadata?.sourceType === 'analysis');

    expect(analysisSources.length).toBe(1);
    expect(analysisSources[0].text).toContain('1.234.567,89 EUR');
  });

  test('normalizeReasoningEvidence converts analyses into first-class claims', () => {
    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const enriched = attachAnalysesToEvidencePackage(pkg, [
      {
        groupMetadata: { clusterId: 'ST-700/2024' },
        analysis: {
          individualAnalyses: [
            { text: 'doc1.pdf', aiResult: { summary: 'Sud je priznao tražbinu od 50.000 EUR.', caseNumber: 'ST-700/2024' } },
          ],
        },
      },
    ], 'ST-700/2024');

    const evidence = realSynthesizer.normalizeReasoningEvidence(enriched);

    const analysisClaims = evidence.claims.filter((claim) => claim.id.startsWith('analysis-'));
    expect(analysisClaims).toHaveLength(1);
    expect(analysisClaims[0].text).toContain('50.000 EUR');
    expect(evidence.meta.coverage).toEqual(expect.objectContaining({ analyzed: 1 }));
    expect(evidence.meta.analysesCount).toBe(1);
  });

  test('attachAnalysesToEvidencePackage surfaces structured money-flow from analysis amounts', () => {
    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const enriched = attachAnalysesToEvidencePackage(pkg, [
      {
        groupMetadata: { clusterId: 'ST-700/2024' },
        analysis: {
          individualAnalyses: [
            {
              text: 'diobni_popis.pdf',
              aiResult: {
                summary: 'Isplata drugog višeg isplatnog reda.',
                caseNumber: 'ST-700/2024',
                amounts: [
                  { description: 'Isplata drugog višeg isplatnog reda', amount: '1.200.000,00', currency: 'EUR', date: '2025-12-17' },
                  { description: 'Rezervacija parničnih troškova', amount: 1033.25, currency: 'EUR' },
                  { description: 'Nepotpun zapis bez iznosa' }
                ]
              }
            },
          ],
        },
      },
    ], 'ST-700/2024');

    expect(enriched.moneyFlow).toEqual(expect.objectContaining({
      count: 2,
      hasMoneyFlow: true,
      currencyTotals: { EUR: 1200000.00 + 1033.25 }
    }));
    expect(enriched.analyses[0].amounts).toHaveLength(3);

    const evidence = realSynthesizer.normalizeReasoningEvidence(enriched);
    const moneyFlowClaims = evidence.claims.filter((claim) => claim.id.startsWith('money-flow-'));
    expect(moneyFlowClaims).toHaveLength(2);
    expect(moneyFlowClaims[0].text).toContain('1,200,000');
    expect(moneyFlowClaims[0].text).toContain('EUR');
    expect(moneyFlowClaims[0].text).toContain('diobni_popis.pdf');
    expect(evidence.meta.moneyFlow).toEqual(expect.objectContaining({ count: 2, hasMoneyFlow: true }));
  });

  test('attachAnalysesToEvidencePackage exposes an empty money-flow surface when no amounts exist', () => {
    const pkg = buildClusterEvidencePackage({ cluster: buildBaseCluster(), clusterSummary: {}, discoverySummary: buildDiscoverySummary(), query: null });
    const enriched = attachAnalysesToEvidencePackage(pkg, [
      {
        groupMetadata: { clusterId: 'ST-700/2024' },
        analysis: {
          individualAnalyses: [
            { text: 'doc1.pdf', aiResult: { summary: 'Procesno rješenje bez iznosa.', caseNumber: 'ST-700/2024' } },
          ],
        },
      },
    ], 'ST-700/2024');

    expect(enriched.moneyFlow).toEqual({
      count: 0,
      entries: [],
      currencyTotals: {},
      hasMoneyFlow: false
    });

    const evidence = realSynthesizer.normalizeReasoningEvidence(enriched);
    expect(evidence.claims.some((claim) => claim.id.startsWith('money-flow-'))).toBe(false);
    expect(evidence.meta.moneyFlow.hasMoneyFlow).toBe(false);
  });
});

describe('Track 1: visualizer guards (1e)', () => {
  test('isUsableAnalysisText rejects empty and failure-placeholder text', () => {
    expect(isUsableAnalysisText('')).toBe(false);
    expect(isUsableAnalysisText('  ')).toBe(false);
    expect(isUsableAnalysisText(null)).toBe(false);
    expect(isUsableAnalysisText(undefined)).toBe(false);
    expect(isUsableAnalysisText('Greška pri generiranju završnog sažetka.')).toBe(false);
    expect(isUsableAnalysisText('Nema dostupnih podataka za generiranje analize.')).toBe(false);
    expect(isUsableAnalysisText('Analiza dokumenata nije uspješno izvršena.')).toBe(false);
  });

  test('isUsableAnalysisText accepts real analytical content', () => {
    expect(isUsableAnalysisText('Analiza pokazuje nepodmirene tražbine u iznosu od 2 milijuna EUR.')).toBe(true);
  });

  test('pipeline skips the visualizer when comparative analysis is a failure placeholder', async () => {
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([
      { caseInfo: { caseNumber: 'ST-700/2024', title: 'T1', participants: [] }, documentLinks: [{ url: 'u1', text: 'doc1' }] },
    ]);
    mockDownloadCall.mockResolvedValue([{ filePath: '/tmp/track1.pdf', url: 'u1' }]);
    mockAnalyzeCall.mockResolvedValue({ individualAnalyses: [], finalSummary: 'Analysis' });

    // Simulate the real-world failure where generateComparativeAnalysis emits a placeholder.
    require('../court-analysis/agents/analysis-agent').generateComparativeAnalysis.mockResolvedValue(
      'Greška pri generiranju završnog sažetka.'
    );

    mockSynthesizeReport.mockResolvedValue({
      schemaVersion: '1.0.0',
      narrative: 'Report',
      claims: [],
      findings: [],
      openQuestions: [],
      nextSteps: [],
      conflicts: [],
      meta: {},
    });

    await runCourtAnalysis('66124057408', { caseLimit: 1, enableVisualizer: true }, jest.fn());

    expect(mockVisualizerCall).not.toHaveBeenCalled();
  });

  test('pipeline attaches analyses to the evidence package and report meta end-to-end', async () => {
    mockSearchAndGetLatestCasesWithDocuments.mockResolvedValue([
      { caseInfo: { caseNumber: 'ST-700/2024', title: 'T1', participants: [] }, documentLinks: [{ url: 'u1', text: 'doc1' }] },
    ]);
    mockDownloadCall.mockResolvedValue([{ filePath: '/tmp/track1.pdf', url: 'u1' }]);
    mockAnalyzeCall.mockResolvedValue({
      individualAnalyses: [
        { text: 'track1.pdf', aiResult: { summary: 'Tražbina od 40.000 EUR.', caseNumber: 'ST-700/2024' } },
      ],
      finalSummary: 'Analysis',
    });

    mockSynthesizeReport.mockResolvedValue({
      schemaVersion: '1.0.0',
      narrative: 'Report',
      claims: [],
      findings: [],
      openQuestions: [],
      nextSteps: [],
      conflicts: [],
      meta: {},
    });

    const result = await runCourtAnalysis('66124057408', { caseLimit: 1, enableVisualizer: false }, jest.fn());

    expect(result.clusterEvidencePackage.analyses).toHaveLength(1);
    expect(result.clusterEvidencePackage.analyses[0].summary).toBe('Tražbina od 40.000 EUR.');
    expect(result.clusterEvidencePackage.coverage).toEqual(expect.objectContaining({ analyzed: 1, total: 1, complete: true }));
    expect(mockNormalizeReasoningEvidence).toHaveBeenCalledWith(expect.objectContaining({
      analyses: expect.arrayContaining([expect.objectContaining({ summary: 'Tražbina od 40.000 EUR.' })]),
    }));
  });
});