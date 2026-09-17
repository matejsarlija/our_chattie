const { rerankEvidence, collectCandidates, isAmbiguous, MAX_RERANK_CANDIDATES } = require('../../court-analysis/reasoning/reranker');

const retrievalWith = (matchesPerQuery) => ({
    queries: matchesPerQuery.map((_, i) => ({ id: `q${i + 1}` })),
    results: matchesPerQuery.map((matches, i) => ({ query: { id: `q${i + 1}` }, matches }))
});

describe('reranker — model-backed listwise rerank (Phase 1.2)', () => {
    const ambiguousRetrieval = retrievalWith([
        [
            { sourceId: 'a', text: 'Najbolji rezultat o tražbinama', score: 10 },
            { sourceId: 'b', text: 'Zblizu jednako dobar rezultat', score: 9 }
        ]
    ]);

    test('ambiguity gate detects near-ties and rejects clear winners', () => {
        expect(isAmbiguous(ambiguousRetrieval)).toBe(true);
        expect(isAmbiguous(retrievalWith([[{ sourceId: 'x', score: 10 }, { sourceId: 'y', score: 3 }]]))).toBe(false);
        expect(isAmbiguous(retrievalWith([[{ sourceId: 'z', score: 5 }]]))).toBe(false);
    });

    test('active rerank applies scores and re-sorts within each query', async () => {
        // Model prefers the lexically second candidate.
        const llmRerank = jest.fn().mockResolvedValue([{ id: 'b', score: 0.95 }, { id: 'a', score: 0.4 }]);

        const result = await rerankEvidence(ambiguousRetrieval, { enabled: true, force: true, llmRerank });

        expect(llmRerank).toHaveBeenCalledTimes(1);
        expect(result.rerankStatus).toBe('active');
        expect(result.results[0].rerankStatus).toBe('active');
        expect(result.results[0].matches.map((m) => m.sourceId)).toEqual(['b', 'a']);
        expect(result.results[0].matches[0]).toEqual(expect.objectContaining({ rerankScore: 0.95, lexicalRank: 2 }));
    });

    test('scores are clamped to [0,1] and unknown ids ignored', async () => {
        const llmRerank = jest.fn().mockResolvedValue([
            { id: 'a', score: 7 },
            { id: 'ghost', score: 0.9 },
            { id: 'b', score: 'neispravno' }
        ]);
        const result = await rerankEvidence(ambiguousRetrieval, { enabled: true, force: true, llmRerank });
        expect(result.results[0].matches.find((m) => m.sourceId === 'a').rerankScore).toBe(1);
        expect(result.results[0].matches.find((m) => m.sourceId === 'b').rerankScore).toBeNull();
    });

    test('non-array model output falls back with lexical order preserved', async () => {
        const llmRerank = jest.fn().mockResolvedValue(null);
        const result = await rerankEvidence(ambiguousRetrieval, { enabled: true, force: true, llmRerank });
        expect(result.rerankStatus).toBe('fallback');
        expect(result.metrics.rerankReason).toBe('invalid-model-output');
        expect(result.results[0].matches.map((m) => m.sourceId)).toEqual(['a', 'b']);
    });

    test('model errors fall back instead of failing the run', async () => {
        const llmRerank = jest.fn().mockRejectedValue(new Error('quota hang'));
        const result = await rerankEvidence(ambiguousRetrieval, { enabled: true, force: true, llmRerank });
        expect(result.rerankStatus).toBe('fallback');
        expect(result.metrics.rerankReason).toContain('model-error');
    });

    test('non-ambiguous results skip without any model call (cost gate)', async () => {
        const clearRetrieval = retrievalWith([[{ sourceId: 'x', score: 10 }, { sourceId: 'y', score: 2 }]]);
        const llmRerank = jest.fn();
        const result = await rerankEvidence(clearRetrieval, { enabled: true, llmRerank });
        expect(llmRerank).not.toHaveBeenCalled();
        expect(result.rerankStatus).toBe('skipped');
        expect(result.metrics.rerankReason).toBe('not-ambiguous');
    });

    test('force bypasses the ambiguity gate (manual override switch)', async () => {
        const clearRetrieval = retrievalWith([[{ sourceId: 'x', score: 10 }, { sourceId: 'y', score: 2 }]]);
        const llmRerank = jest.fn().mockResolvedValue([{ id: 'x', score: 1 }]);
        const result = await rerankEvidence(clearRetrieval, { enabled: true, force: true, llmRerank });
        expect(llmRerank).toHaveBeenCalledTimes(1);
        expect(result.rerankStatus).toBe('active');
    });

    test('candidates are deduped across queries and hard-capped at 24', async () => {
        const manyMatches = Array.from({ length: 40 }, (_, i) => ({ sourceId: `src-${i}`, text: `t${i}`, score: 20 - i }));
        // Duplicate across a second query must not create a second candidate.
        const candidates = collectCandidates(retrievalWith([manyMatches.slice(0, 30), manyMatches]));
        expect(candidates.length).toBeLessThanOrEqual(MAX_RERANK_CANDIDATES);
        expect(candidates.every((c, i) => candidates.findIndex((d) => d.id === c.id) === i)).toBe(true);

        let received;
        const llmRerank = jest.fn(async ({ candidates: passed }) => { received = passed; return []; });
        await rerankEvidence(retrievalWith([manyMatches]), { enabled: true, force: true, llmRerank });
        expect(received.length).toBe(MAX_RERANK_CANDIDATES);
    });
});
