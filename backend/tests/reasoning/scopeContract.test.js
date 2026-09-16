const { buildScopeContract, CONCLUSION_CATEGORIES } = require('../../court-analysis/reasoning/scopeContract');

function kerumLike({ analyzed = 57, failed = 6, total = 63, totalClaims = 375 } = {}) {
    return {
        coverage: {
            analyzed,
            failed,
            total,
            coverageRatio: 0.9,
            complete: false,
            failedFiles: [
                { fileName: 'Diobeni popis.pdf', code: 'malformed-json', reason: 'x', causalChain: ['y'] },
                { fileName: 'Završni račun.pdf', code: 'malformed-json', reason: 'x', causalChain: ['y'] },
                { fileName: 'Podnesak.pdf', code: 'timeout', reason: 'x', causalChain: ['y'] },
                { fileName: 'Podnesak.pdf', code: 'timeout', reason: 'x', causalChain: ['y'] },
                { fileName: 'Žalba.pdf', code: 'timeout', reason: 'x', causalChain: ['y'] },
                { fileName: 'Prijedlog.pdf', code: 'timeout', reason: 'x', causalChain: ['y'] }
            ],
            groundedClaims: 366,
            totalClaims
        },
        discovery: {
            reasoningClusterId: 'ST-2/2013',
            recommendedPrimaryClusterId: 'ST-2/2013',
            rawEntryCount: 40,
            totalResults: 381,
            clusters: [{
                clusterId: 'ST-2/2013',
                entryCount: 30,
                oldestEntryDate: '2025-07-17T00:00:00.000Z',
                newestEntryDate: '2026-06-23T00:00:00.000Z',
                entryDateSpanDays: 341
            }]
        },
        // Newest entry (index 0) is analyzed; all 30 entries covered.
        entries: [
            { index: 0, caseNumber: 'ST-2/2013', date: '2026-06-23', documentLinks: [{ url: 'https://x/0', text: 'Rješenje.pdf' }] },
            { index: 1, caseNumber: 'ST-2/2013', date: '2025-07-17', documentLinks: [{ url: 'https://x/1', text: 'Podnesak.pdf' }] },
            { index: 2, caseNumber: 'ST-2/2013', date: '2025-01-01', documentLinks: [{ url: 'https://x/2', text: 'Žalba.pdf' }] }
        ],
        analyses: Array.from({ length: analyzed }, (_, i) => ({ fileName: `doc-${i}.pdf`, sourceEntryIndex: i % 3 })),
        rerankedRetrieval: { rerankStatus: 'fallback', metrics: { rerankReason: 'invalid-model-output' } }
    };
}

describe('buildScopeContract (T1-1 backend)', () => {
    test('publishes the fixed conclusion categories', () => {
        expect(CONCLUSION_CATEGORIES).toEqual([
            'docket_timeline',
            'documented_claims',
            'current_procedural_status',
            'full_case_outcome'
        ]);
    });

    test('Kerum-shaped partial run: partial status, full outcome blocked three ways', () => {
        const contract = buildScopeContract(kerumLike());

        expect(contract.analysisStatus).toBe('partial');
        expect(contract.supported).toEqual(expect.arrayContaining([
            'docket_timeline', 'documented_claims', 'current_procedural_status'
        ]));
        expect(contract.supported).not.toContain('full_case_outcome');
        expect(contract.blocked).toEqual(['full_case_outcome']);
        expect(contract.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'full_case_outcome', reason: 'failed-documents' }),
            expect.objectContaining({
                category: 'full_case_outcome',
                reason: 'partial-corpus',
                evidence: { capturedEntries: 40, totalResults: 381 }
            }),
            expect.objectContaining({ category: 'full_case_outcome', reason: 'no-final-distribution-statement' })
        ]));
        // The failed ledger pair is named, not just counted.
        const failedBlocker = contract.blockingEvidence.find((b) => b.reason === 'failed-documents');
        expect(failedBlocker.evidence.files).toEqual(expect.arrayContaining(['Diobeni popis.pdf', 'Završni račun.pdf']));
        expect(contract.degraded).toEqual([
            { condition: 'rerank-fallback', reason: 'invalid-model-output' }
        ]);
        expect(contract.corpus).toEqual(expect.objectContaining({
            analyzed: 57,
            failed: 6,
            total: 63,
            selectedCase: 'ST-2/2013'
        }));
        expect(contract.corpus.dateRange).toEqual(expect.objectContaining({ spanDays: 341 }));
    });

    test('complete single-case run with a distribution statement is sufficient', () => {
        const contract = buildScopeContract({
            coverage: { analyzed: 12, failed: 0, total: 12, complete: true, failedFiles: [], totalClaims: 40 },
            discovery: {
                reasoningClusterId: 'ST-5/2024',
                rawEntryCount: 12,
                totalResults: 12,
                clusters: [{ clusterId: 'ST-5/2024', oldestEntryDate: '2024-01-01', newestEntryDate: '2024-06-01', entryDateSpanDays: 152 }]
            },
            entries: [
                { index: 0, caseNumber: 'ST-5/2024', date: '2024-06-01', documentLinks: [{ url: 'https://x/0', text: 'Diobeni popis.pdf' }] },
                { index: 1, caseNumber: 'ST-5/2024', date: '2024-01-01', documentLinks: [{ url: 'https://x/1', text: 'Rješenje.pdf' }] }
            ],
            analyses: [{ fileName: 'Diobeni popis.pdf', sourceEntryIndex: 0 }, { fileName: 'Rješenje.pdf', sourceEntryIndex: 1 }],
            rerankedRetrieval: { rerankStatus: 'active', metrics: {} }
        });

        expect(contract.analysisStatus).toBe('sufficient');
        expect(contract.blocked).toEqual([]);
        expect(contract.blockingEvidence).toEqual([]);
        expect(contract.degraded).toEqual([]);
        expect(contract.supported).toEqual(expect.arrayContaining(CONCLUSION_CATEGORIES));
    });

    test('uses the persisted selected-cluster summary when discovery clusters are absent', () => {
        const contract = buildScopeContract({
            coverage: { analyzed: 1, failed: 0, total: 1, totalClaims: 1 },
            discovery: {
                reasoningClusterId: 'ST-5/2024',
                rawEntryCount: 1,
                totalResults: 1,
                selectedCluster: {
                    clusterId: 'ST-5/2024',
                    oldestEntryDate: '2024-01-01',
                    newestEntryDate: '2024-06-01',
                    entryDateSpanDays: 152,
                },
            },
            analyses: [{ fileName: 'Diobeni popis.pdf' }],
        });
        expect(contract.corpus.dateRange).toEqual({
            oldestEntryDate: '2024-01-01', newestEntryDate: '2024-06-01', spanDays: 152,
        });
    });

    test('zero analyzed documents is discovery_only with everything blocked', () => {
        const contract = buildScopeContract({
            coverage: { analyzed: 0, failed: 0, total: 0, failedFiles: [], totalClaims: 0 },
            discovery: { reasoningClusterId: null, rawEntryCount: 0, totalResults: 10, clusters: [] },
            analyses: [],
            rerankedRetrieval: null
        });

        expect(contract.analysisStatus).toBe('discovery_only');
        expect(contract.supported).toEqual([]);
        expect(contract.blocked).toEqual(expect.arrayContaining(CONCLUSION_CATEGORIES));
    });

    test('no extracted claims blocks documented_claims without touching the rest', () => {
        const contract = buildScopeContract(kerumLike({ totalClaims: 0 }));

        expect(contract.analysisStatus).toBe('partial');
        expect(contract.supported).toEqual(['docket_timeline', 'current_procedural_status']);
        expect(contract.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'documented_claims', reason: 'no-extracted-claims' })
        ]));
    });

    test('env budget tightening is a degraded condition, not a silent cap', () => {
        const contract = buildScopeContract({ ...kerumLike(), envBudgetCap: true });

        expect(contract.degraded).toEqual(expect.arrayContaining([
            expect.objectContaining({ condition: 'env-budget-cap' })
        ]));
    });

    test('tolerates missing inputs without throwing', () => {
        const contract = buildScopeContract({});
        expect(contract.analysisStatus).toBe('discovery_only');
        const partial = buildScopeContract({ coverage: { analyzed: 2, failed: 0, total: 2, failedFiles: [] }, analyses: [{}, {}] });
        expect(partial.supported).toContain('docket_timeline');
        // No entry chronology and no index linkage: current status degrades
        // instead of asserting support without evidence.
        expect(partial.blocked).toContain('current_procedural_status');
        expect(partial.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({ category: 'current_procedural_status', reason: 'newer-evidence-unavailable' })
        ]));
    });
});

describe('current_procedural_status chronology gate (T1-1 follow-up)', () => {
    function statusInput(entryDates, analyzedIndexes, { failedFiles = [], totalClaims = 10 } = {}) {
        const entries = entryDates.map((date, index) => ({
            index,
            caseNumber: 'ST-2/2013',
            date,
            documentLinks: [{ url: `https://x/${index}`, text: `doc-${index}.pdf` }]
        }));
        return {
            coverage: {
                analyzed: analyzedIndexes.length,
                failed: failedFiles.length,
                total: analyzedIndexes.length + failedFiles.length,
                failedFiles,
                totalClaims
            },
            discovery: {
                reasoningClusterId: 'ST-2/2013',
                rawEntryCount: entryDates.length,
                totalResults: entryDates.length,
                clusters: [{ clusterId: 'ST-2/2013' }]
            },
            entries,
            analyses: analyzedIndexes.map((sourceEntryIndex) => ({
                fileName: `doc-${sourceEntryIndex}.pdf`,
                sourceEntryIndex
            })),
            rerankedRetrieval: null
        };
    }

    test('1. old-only analyzed sample blocks current status as latest-entry-not-analyzed', () => {
        const contract = buildScopeContract(statusInput(['2026-06-23', '2025-07-17', '2025-01-01'], [1, 2]));

        expect(contract.supported).not.toContain('current_procedural_status');
        expect(contract.blocked).toContain('current_procedural_status');
        expect(contract.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'current_procedural_status',
                reason: 'latest-entry-not-analyzed',
                evidence: expect.objectContaining({
                    newestEntryDate: '2026-06-23',
                    newestEntries: 1,
                    analyzedNewestEntries: 0
                })
            })
        ]));
        const blocker = contract.blockingEvidence.find((b) => b.reason === 'latest-entry-not-analyzed');
        expect(blocker.evidence.uncoveredEntries).toEqual([
            expect.objectContaining({ sourceEntryIndex: 0, fileNames: ['doc-0.pdf'] })
        ]);
    });

    test('2. newest relevant entry failed (not successfully analyzed) blocks as latest-entry-not-analyzed', () => {
        const contract = buildScopeContract(statusInput(
            ['2026-06-23', '2025-07-17'],
            [1],
            { failedFiles: [{ fileName: 'doc-0.pdf', code: 'malformed-json', reason: 'x', causalChain: ['y'] }] }
        ));

        expect(contract.supported).not.toContain('current_procedural_status');
        expect(contract.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'current_procedural_status',
                reason: 'latest-entry-not-analyzed',
                evidence: expect.objectContaining({ newestEntryDate: '2026-06-23' })
            })
        ]));
    });

    test('3. newest analyzed but a later-unorderable document is missing blocks as newer-evidence-unavailable', () => {
        const contract = buildScopeContract(statusInput(['2026-06-23', 'N/A'], [0]));

        expect(contract.supported).not.toContain('current_procedural_status');
        expect(contract.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'current_procedural_status',
                reason: 'newer-evidence-unavailable',
                evidence: expect.objectContaining({ newestAnalyzedEntryDate: '2026-06-23' })
            })
        ]));
        const blocker = contract.blockingEvidence.find((b) => b.reason === 'newer-evidence-unavailable');
        expect(blocker.evidence.undatedEntries).toEqual([
            expect.objectContaining({ sourceEntryIndex: 1 })
        ]);
    });

    test('4. qualifying latest-entry sample supports current status', () => {
        const contract = buildScopeContract(statusInput(['2026-06-23', '2025-07-17', 'N/A'], [0, 1, 2]));

        expect(contract.supported).toContain('current_procedural_status');
        expect(contract.blockingEvidence.filter((b) => b.category === 'current_procedural_status')).toEqual([]);
    });

    test('legacy inputs without index provenance degrade to newer-evidence-unavailable', () => {
        const withoutIndexes = statusInput(['2026-06-23', '2025-07-17'], [0, 1]);
        withoutIndexes.analyses = [{ fileName: 'doc-0.pdf' }, { fileName: 'doc-1.pdf' }];
        const contract = buildScopeContract(withoutIndexes);

        expect(contract.supported).not.toContain('current_procedural_status');
        expect(contract.blockingEvidence).toEqual(expect.arrayContaining([
            expect.objectContaining({
                category: 'current_procedural_status',
                reason: 'newer-evidence-unavailable',
                evidence: expect.objectContaining({ unverifiableProvenance: true })
            })
        ]));
    });
});
