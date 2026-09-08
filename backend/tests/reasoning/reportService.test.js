const path = require('path');
const os = require('os');

const mockSynthesizeReport = jest.fn();
const mockNormalizeReasoningEvidence = jest.fn();
const mockVerifyReport = jest.fn();
const mockInvoke = jest.fn();
const mockRunQueryPlanner = jest.fn().mockResolvedValue([]);

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({ invoke: mockInvoke }))
}));

jest.mock('../../helpers/geminiRetry', () => ({
    withGeminiRetry: (fn) => fn(),
    withGeminiTimeout: (callable) => callable(undefined)
}));

jest.mock('../../court-analysis/reasoning/synthesizer', () => ({
    synthesizeReport: mockSynthesizeReport,
    normalizeReasoningEvidence: mockNormalizeReasoningEvidence
}));

jest.mock('../../court-analysis/reasoning/verifier', () => ({
    verifyReport: mockVerifyReport
}));

jest.mock('../../court-analysis/reasoning/queryPlanner', () => ({
    runQueryPlanner: mockRunQueryPlanner,
    mergeRetrievalQueries: jest.requireActual('../../court-analysis/reasoning/queryPlanner').mergeRetrievalQueries
}));

const { generateClusterReport } = require('../../court-analysis/reasoning/reportService');

describe('reasoning reportService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockNormalizeReasoningEvidence.mockImplementation((evidencePackage) => ({
            timeline: [{ date: null, description: `Objava ${evidencePackage.clusterId}`, evidence: [] }],
            claims: [{
                id: 'base-claim-1',
                text: `Osnovni dokaz za ${evidencePackage.clusterId}`,
                confidence: 'medium',
                evidence: []
            }],
            meta: { clusterId: evidencePackage.clusterId }
        }));
    });

    test('synthesizes and verifies against normalized evidence enriched with retrieved matches', async () => {
        const evidencePackage = {
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023',
            primaryCaseNumber: 'ST-100/2023',
            query: { type: 'case_number', value: 'ST-100/2023' },
            documentLinks: [{
                id: 'doc-1',
                text: 'Rješenje navodi tražbinu od 10.000 EUR',
                caseNumber: 'ST-100/2023'
            }]
        };
        const synthesizedReport = {
            schemaVersion: '1.0.0',
            narrative: 'Sažetak',
            findings: [{ text: 'Nalaz', confidence: 'medium', citations: [] }],
            claims: [],
            openQuestions: [],
            nextSteps: [],
            conflicts: [],
            meta: { clusterId: 'ST-100/2023' }
        };
        const verifiedReport = {
            ...synthesizedReport,
            verifiedFindings: synthesizedReport.findings
        };
        const onStage = jest.fn();

        mockSynthesizeReport.mockResolvedValue(synthesizedReport);
        mockVerifyReport.mockResolvedValue(verifiedReport);

        const result = await generateClusterReport(evidencePackage, { onStage });
        const synthesisEvidence = mockSynthesizeReport.mock.calls[0][0];

        expect(result).toEqual(expect.objectContaining({
            schemaVersion: '1.0.0',
            verifiedFindings: synthesizedReport.findings
        }));
        expect(result.meta.retrieval).toEqual(expect.objectContaining({
            metrics: expect.objectContaining({
                queryCount: 5
            })
        }));
        expect(result.meta.rerank).toEqual(expect.objectContaining({
            rerankStatus: 'skipped',
            metrics: expect.objectContaining({
                rerankedMatchCount: expect.any(Number)
            })
        }));
        // Persistence diet (M-06): raw retrieval keeps a trimmed provenance
        // record per match (snippet/score/reasons/sourceId), not the full
        // chunk text (the reranked copy carries that).
        expect(result.meta.retrieval.results[0].matches[0].text).toBeUndefined();
        expect(typeof result.meta.retrieval.results[0].matches[0].snippet).toBe('string');
        expect(result.meta.retrieval.results[0].matches[0].snippet.length).toBeLessThanOrEqual(501);
        expect(typeof result.meta.retrieval.results[0].matches[0].score).toBe('number');
        expect(Array.isArray(result.meta.retrieval.results[0].matches[0].reasons)).toBe(true);
        expect(typeof result.meta.rerank.results[0].matches[0].text).toBe('string');
        expect(mockNormalizeReasoningEvidence).toHaveBeenCalledWith(evidencePackage);
        expect(synthesisEvidence).toEqual(expect.objectContaining({
            timeline: expect.any(Array),
            meta: expect.objectContaining({
                clusterId: 'ST-100/2023',
                retrieval: expect.objectContaining({
                    metrics: expect.objectContaining({ matchCount: expect.any(Number) })
                }),
                rerank: expect.objectContaining({
                    rerankStatus: 'skipped'
                })
            })
        }));
        expect(synthesisEvidence.claims).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'base-claim-1' }),
            expect.objectContaining({
                id: expect.stringMatching(/^retrieved-/),
                text: expect.stringContaining('Rješenje navodi tražbinu od 10.000 EUR'),
                evidence: expect.arrayContaining([
                    expect.objectContaining({
                        sourceId: 'doc-1',
                        text: expect.stringContaining('Rješenje navodi tražbinu od 10.000 EUR'),
                        rerankStatus: 'skipped'
                    })
                ])
            })
        ]));
        expect(onStage).toHaveBeenCalledWith(expect.objectContaining({ step: 'verifying' }));
        expect(mockVerifyReport).toHaveBeenCalledWith(synthesizedReport, synthesisEvidence, expect.any(Object));
    });

    test('M-09: finding citations link back to the retrieval query that surfaced them', async () => {
        const evidencePackage = {
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023',
            primaryCaseNumber: 'ST-100/2023',
            query: { type: 'case_number', value: 'ST-100/2023' },
            documentLinks: [{
                id: 'doc-1',
                text: 'Rješenje navodi tražbinu od 10.000 EUR',
                caseNumber: 'ST-100/2023'
            }]
        };
        mockSynthesizeReport.mockResolvedValue({
            schemaVersion: '1.0.0',
            narrative: 'Sažetak',
            findings: [{
                text: 'Tražbina od 10.000 EUR je utvrđena.',
                confidence: 'high',
                citations: [{ source: 'doc-1', text: 'Rješenje navodi tražbinu od 10.000 EUR' }]
            }],
            claims: [],
            openQuestions: [],
            nextSteps: [],
            conflicts: [],
            meta: { clusterId: 'ST-100/2023' }
        });
        mockVerifyReport.mockImplementation(async (report) => report);

        const result = await generateClusterReport(evidencePackage, {});
        const links = result.findings[0].citations[0].retrievedBy;
        expect(Array.isArray(links)).toBe(true);
        expect(links.length).toBeGreaterThan(0);
        expect(links[0]).toEqual(expect.objectContaining({
            queryText: expect.any(String),
            score: expect.any(Number),
            reasons: expect.any(Array)
        }));
    });
});

describe('reasoning reportService optional-pass gating', () => {
    const originalEnv = { ...process.env };
    const tmpDataDir = path.join(os.tmpdir(), `report-service-gating-${process.pid}`);

    function buildPackage() {
        return {
            packageType: 'ClusterEvidencePackage',
            clusterId: 'ST-100/2023',
            primaryCaseNumber: 'ST-100/2023',
            query: { type: 'case_number', value: 'ST-100/2023' },
            documentLinks: [{ id: 'doc-1', text: 'Rješenje navodi tražbinu', caseNumber: 'ST-100/2023' }]
        };
    }

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.ANALYSIS_DATA_DIR = tmpDataDir;
        delete process.env.REASONING_PLANNER;
        delete process.env.REASONING_FOLLOWUP;
        mockNormalizeReasoningEvidence.mockImplementation((evidencePackage) => ({
            timeline: [{ date: null, description: `Objava ${evidencePackage.clusterId}`, evidence: [] }],
            claims: [],
            meta: { clusterId: evidencePackage.clusterId }
        }));
        mockSynthesizeReport.mockResolvedValue({ schemaVersion: '1.0.0', narrative: 'x', findings: [], claims: [], openQuestions: [], nextSteps: [], conflicts: [], meta: {} });
        mockVerifyReport.mockResolvedValue({ schemaVersion: '1.0.0', narrative: 'x', findings: [], verifiedFindings: [], claims: [], openQuestions: [], nextSteps: [], conflicts: [], meta: {} });
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    test('planner runs by default', async () => {
        await generateClusterReport(buildPackage(), {});
        expect(mockRunQueryPlanner).toHaveBeenCalled();
    });

    test('force runs planner', async () => {
        process.env.REASONING_PLANNER = 'force';
        await generateClusterReport(buildPackage(), {});
        expect(mockRunQueryPlanner).toHaveBeenCalled();
    });

    test('off skips planner', async () => {
        process.env.REASONING_PLANNER = 'off';
        await generateClusterReport(buildPackage(), {});
        expect(mockRunQueryPlanner).not.toHaveBeenCalled();
    });
});

describe('stripRetrievalText provenance record (M-06)', () => {
  const { stripRetrievalText, RETRIEVAL_SNIPPET_MAX_CHARS } = require('../../court-analysis/reasoning/reportService');

  test('keeps snippet/score/reasons/sourceId/fileName per match, drops full text', () => {
    const out = stripRetrievalText({
      queries: [{ id: 'q-1', text: 'trazbina' }],
      results: [{
        query: { id: 'q-1', text: 'trazbina' },
        matches: [{
          sourceId: 'doc-1',
          text: 'Rješenje navodi tražbinu od 10.000 EUR uz obrazloženje.',
          score: 4.2,
          reasons: ['token:trazbina', 'anchor:123'],
          metadata: { fileName: 'Rjesenje.pdf', sourceType: 'analysis' },
        }],
      }],
      metrics: { queryCount: 1 },
    });
    const match = out.results[0].matches[0];
    expect(match.text).toBeUndefined();
    expect(match.snippet).toBe('Rješenje navodi tražbinu od 10.000 EUR uz obrazloženje.');
    expect(match.score).toBe(4.2);
    expect(match.reasons).toEqual(['token:trazbina', 'anchor:123']);
    expect(match.sourceId).toBe('doc-1');
    expect(match.fileName).toBe('Rjesenje.pdf');
    expect(match.sourceType).toBe('analysis');
  });

  test('bounds long snippets to RETRIEVAL_SNIPPET_MAX_CHARS', () => {
    const long = 'x'.repeat(RETRIEVAL_SNIPPET_MAX_CHARS + 100);
    const out = stripRetrievalText({
      results: [{ query: { id: 'q' }, matches: [{ sourceId: 's', text: long, score: 1, reasons: [], metadata: {} }] }],
    });
    expect(out.results[0].matches[0].snippet.length).toBeLessThanOrEqual(RETRIEVAL_SNIPPET_MAX_CHARS + 1);
    expect(out.results[0].matches[0].snippet.endsWith('…')).toBe(true);
  });

  test('passes through null retrieval without throwing', () => {
    expect(stripRetrievalText(null)).toBeNull();
    expect(stripRetrievalText({})).toEqual({ results: [] });
  });
});

describe('composeOverviewMarkdown', () => {
  const { composeOverviewMarkdown } = require('../../court-analysis/reasoning/reportService');

  test('composes narrative, open questions, and next steps — findings live only in the annex (M-03)', () => {
    const overview = composeOverviewMarkdown({
      narrative: 'Predmet je otvoren 2013.',
      findings: [
        { text: 'Priznata tražbina od 100.000 EUR.', confidence: 'high' },
        { text: '', confidence: 'low' },
      ],
      openQuestions: ['Nije poznat status GFI izvješća.'],
      nextSteps: ['Pratiti rok za prijavu potražina.'],
    });

    expect(overview).toContain('Predmet je otvoren 2013.');
    // M-03 dedupe: findings render once, in the structured annex — never in the markdown.
    expect(overview).not.toContain('Ključni nalazi');
    expect(overview).not.toContain('Priznata tražbina od 100.000 EUR.');
    expect(overview).toContain('## Otvorena pitanja\n- Nije poznat status GFI izvješća.');
    expect(overview).toContain('## Sljedeći koraci\n- Pratiti rok za prijavu potražina.');
  });

  test('renders object-shaped open questions via their text field', () => {
    const overview = composeOverviewMarkdown({
      narrative: 'Narativ.',
      openQuestions: [
        { text: 'Pitanje iz usklađivanja.', source: 'reconciliation', kind: 'arithmetic' },
        'Obično tekstualno pitanje.',
      ],
    });
    expect(overview).toContain('- Pitanje iz usklađivanja.');
    expect(overview).toContain('- Obično tekstualno pitanje.');
  });

  test('returns only the narrative when no structured sections exist', () => {
    expect(composeOverviewMarkdown({ narrative: 'Samo narativ.' })).toBe('Samo narativ.');
  });

  test('returns empty string for null/empty reports so guards skip the visualizer', () => {
    expect(composeOverviewMarkdown(null)).toBe('');
    expect(composeOverviewMarkdown({})).toBe('');
  });

  test('placeholder narratives pass through unchanged (visualizer guard matches them)', () => {
    const placeholder = 'Nema dovoljno dokaza za generiranje izvješća.';
    expect(composeOverviewMarkdown({ narrative: placeholder })).toBe(placeholder);
  });
});
