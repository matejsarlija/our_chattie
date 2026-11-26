'use strict';

const {
    findQuoteIndexInSegmentRange,
    resolveDecisionDateAcrossChunks,
    mergeAnalysisChunkResults,
} = require('../court-analysis/extraction/chunkMerge');

describe('chunkMerge', () => {
    test('anchors overlap quote lookup strictly within segment range so distant identical quotes are never falsely deduplicated', () => {
        const prefix = 'A'.repeat(420);
        const overlapPhrase = 'Trgovačkog suda u Splitu';
        const middle = 'X'.repeat(4400);
        const tail = `\nPonovno pojavljivanje iste fraze: ${overlapPhrase}`;
        const fullText = prefix + overlapPhrase + middle + tail;

        const seg1 = { id: 'doc:chunk-1', startIndex: 0, endIndex: 500, pageNumbers: [1] };
        const seg2 = { id: 'doc:chunk-2', startIndex: 4800, endIndex: fullText.length, pageNumbers: [10] };

        expect(findQuoteIndexInSegmentRange(fullText, seg1, overlapPhrase)).toBe(420);
        const seg2Pos = findQuoteIndexInSegmentRange(fullText, seg2, overlapPhrase);
        expect(seg2Pos).toBeGreaterThan(4800);

        const merged = mergeAnalysisChunkResults([
            {
                segment: seg1,
                value: {
                    summary: 'Prvi odlomak.',
                    decisionDate: '2026-01-15',
                    amounts: [{
                        description: 'Tražbina A',
                        amount: 100,
                        currency: 'EUR',
                        quote: 'Trgovačkog suda u Splitu',
                    }],
                },
            },
            {
                segment: { id: 'doc:chunk-mid', startIndex: 400, endIndex: 1200, pageNumbers: [2] },
                value: {
                    decisionDate: '2020-05-01',
                    amounts: [{
                        description: 'Tražbina A',
                        amount: 100,
                        currency: 'EUR',
                        quote: 'Trgovačkog suda u Splitu',
                    }],
                },
            },
            {
                segment: seg2,
                value: {
                    summary: 'Zadnji odlomak.',
                    amounts: [{
                        description: 'Tražbina A',
                        amount: 100,
                        currency: 'EUR',
                        quote: 'Trgovačkog suda u Splitu',
                    }],
                },
            },
        ], fullText);

        // seg-1 and seg-mid overlap cleanly -> deduped to 1; seg-2 is far downstream -> kept!
        expect(merged.amounts).toHaveLength(2);
        expect(merged.decisionDate).toBe('2026-01-15');
    });

    test('resolves decisionDate preferring header or closing chunk over body dates', () => {
        expect(resolveDecisionDateAcrossChunks([
            { value: { decisionDate: null } },
            { value: { decisionDate: '2018-03-01' } },
            { value: { decisionDate: '2026-05-20' } },
        ])).toBe('2026-05-20');
    });
});
