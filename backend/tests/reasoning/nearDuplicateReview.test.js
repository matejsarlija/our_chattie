const { findNearDuplicateCandidates } = require('../../court-analysis/reasoning/nearDuplicateReview');

function analysis(id, fileName, contentHash, extra = {}) {
    return { id, fileName, caseNumber: 'ST-2/2013', entryDate: '2025-01-01', contentHash, ...extra };
}

describe('findNearDuplicateCandidates (TX-3 research spike)', () => {
    test('same filename with different bytes is a review candidate; both sources retained', () => {
        const analyses = [
            analysis('a-1', 'Podnesak.pdf', 'hash-one'),
            analysis('a-2', 'Podnesak.pdf', 'hash-two'),
            analysis('a-3', 'Rješenje.pdf', 'hash-three')
        ];
        const result = findNearDuplicateCandidates(analyses);

        expect(result.reviewedPairs).toBe(3);
        expect(result.candidates).toHaveLength(1);
        expect(result.candidates[0]).toEqual({
            analysisIds: ['a-1', 'a-2'],
            fileNames: ['Podnesak.pdf', 'Podnesak.pdf'],
            signals: ['same-filename-different-bytes'],
            verdict: 'review-needed'
        });
        // Nothing is merged or dropped: the input list is untouched.
        expect(analyses).toHaveLength(3);
    });

    test('identical bytes are the dedupe path, never candidates', () => {
        const result = findNearDuplicateCandidates([
            analysis('a-1', 'Rješenje.pdf', 'same-hash'),
            analysis('a-2', 'Rješenje.pdf', 'same-hash')
        ]);
        expect(result.candidates).toEqual([]);
    });

    test('missing hashes are unprovable and skipped', () => {
        const result = findNearDuplicateCandidates([
            analysis('a-1', 'Podnesak.pdf', 'hash-one'),
            analysis('a-2', 'Podnesak.pdf', null)
        ]);
        expect(result.candidates).toEqual([]);
    });

    test('no weaker signal exists: distinct names never become candidates', () => {
        // Prototyped and rejected during the spike: same case+date fires on
        // nearly every in-cluster pair (review noise ~n²). Distinct names
        // stay silent even when everything else matches.
        const result = findNearDuplicateCandidates([
            analysis('a-1', 'Prilog-1.pdf', 'hash-one', { entryDate: '2025-03-01' }),
            analysis('a-2', 'Prilog-2.pdf', 'hash-two', { entryDate: '2025-03-01' })
        ]);
        expect(result.candidates).toEqual([]);
        expect(result.reviewedPairs).toBe(1);
    });

    test('distinct files produce no candidates', () => {
        const result = findNearDuplicateCandidates([
            analysis('a-1', 'Podnesak.pdf', 'hash-one'),
            analysis('a-2', 'Žalba.pdf', 'hash-two', { entryDate: '2025-04-01' })
        ]);
        expect(result.candidates).toEqual([]);
        expect(result.reviewedPairs).toBe(1);
    });

    test('tolerates empty and malformed input', () => {
        expect(findNearDuplicateCandidates(null)).toEqual({ candidates: [], reviewedPairs: 0 });
        expect(findNearDuplicateCandidates([null, 'x', 42])).toEqual({ candidates: [], reviewedPairs: 0 });
    });
});
