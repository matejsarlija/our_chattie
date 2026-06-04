const { rerankEvidence } = require('../../court-analysis/reasoning/reranker');

describe('reranker', () => {
    test('preserves lexical match order when reranking is skipped', () => {
        const result = rerankEvidence({
            queries: [{ id: 'amounts' }],
            results: [{
                query: { id: 'amounts' },
                matches: [
                    { sourceId: 'doc-1', score: 9, text: 'Prvi rezultat' },
                    { sourceId: 'doc-2', score: 7, text: 'Drugi rezultat' }
                ]
            }],
            metrics: { matchCount: 2 }
        });

        expect(result.rerankStatus).toBe('skipped');
        expect(result.results[0].matches.map((match) => match.sourceId)).toEqual(['doc-1', 'doc-2']);
        expect(result.results[0].matches).toEqual([
            expect.objectContaining({ sourceId: 'doc-1', lexicalRank: 1, rerankStatus: 'skipped', rerankScore: null }),
            expect.objectContaining({ sourceId: 'doc-2', lexicalRank: 2, rerankStatus: 'skipped', rerankScore: null })
        ]);
        expect(result.metrics).toEqual(expect.objectContaining({
            matchCount: 2,
            rerankedMatchCount: 2
        }));
    });

    test('marks fallback without changing order when reranking is requested but model-free', () => {
        const result = rerankEvidence({
            results: [{
                query: { id: 'timeline' },
                matches: [
                    { sourceId: 'entry-1', score: 5, text: 'Rješenje' },
                    { sourceId: 'entry-2', score: 4, text: 'Zaključak' }
                ]
            }]
        }, { enabled: true });

        expect(result.rerankStatus).toBe('fallback');
        expect(result.results[0].rerankStatus).toBe('fallback');
        expect(result.results[0].matches.map((match) => match.sourceId)).toEqual(['entry-1', 'entry-2']);
    });

    test('handles empty retrieval matches gracefully', () => {
        const result = rerankEvidence({
            queries: [{ id: 'party-roles' }],
            results: [{ query: { id: 'party-roles' }, matches: [] }],
            metrics: { matchCount: 0 }
        });

        expect(result).toEqual(expect.objectContaining({
            rerankStatus: 'skipped',
            queries: [{ id: 'party-roles' }],
            metrics: expect.objectContaining({ rerankedMatchCount: 0 })
        }));
        expect(result.results[0].matches).toEqual([]);
    });
});
