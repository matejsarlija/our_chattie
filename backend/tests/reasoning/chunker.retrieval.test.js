const { buildRetrievalChunks, RETRIEVAL_CHUNK_LIMIT, RETRIEVAL_MIN_CHUNK_CHARS } = require('../../court-analysis/reasoning/chunker');

function longText(paragraphs) {
    return Array.from({ length: paragraphs }, (_, i) => `Odluka broj ${i + 1}: sud je doneo rješenje u predmetu i odredio rok za prijavu tražbina vjerovnika u postupku. `.repeat(8)).join('\n\n');
}

describe('buildRetrievalChunks', () => {
    test('returns empty for empty/whitespace input', () => {
        expect(buildRetrievalChunks('')).toEqual([]);
        expect(buildRetrievalChunks('   \n\t ')).toEqual([]);
        expect(buildRetrievalChunks(null)).toEqual([]);
    });

    test('sub-minimal documents contribute nothing to the index', () => {
        // A document whose entire text sits below the minimum chunk size adds
        // index noise, not signal — dropping it entirely is the contract.
        expect(buildRetrievalChunks('Kratka odluka suda o stečaju.')).toEqual([]);
    });

    test('caps output at RETRIEVAL_CHUNK_LIMIT for very long documents', () => {
        const chunks = buildRetrievalChunks(longText(80), { docId: 'long' });
        expect(chunks.length).toBe(RETRIEVAL_CHUNK_LIMIT);
    });

    test('stride sampling spreads coverage across the document, not just the head', () => {
        const chunks = buildRetrievalChunks(longText(80), { docId: 'spread' });
        const first = chunks[0];
        const last = chunks[chunks.length - 1];
        // Last sampled chunk must come from well beyond the document head —
        // head-biased truncation would systematically miss end-of-record facts.
        expect(last.metadata.startIndex).toBeGreaterThan(first.metadata.endIndex);
        // Sampled positions must be strictly increasing.
        for (let i = 1; i < chunks.length; i++) {
            expect(chunks[i].metadata.startIndex).toBeGreaterThanOrEqual(chunks[i - 1].metadata.startIndex);
        }
    });

    test('deterministic for identical inputs', () => {
        const text = longText(40);
        expect(JSON.stringify(buildRetrievalChunks(text, { docId: 'd' })))
            .toBe(JSON.stringify(buildRetrievalChunks(text, { docId: 'd' })));
    });
});

describe('RETRIEVAL_MIN_CHUNK_CHARS contract', () => {
    test('tiny boundary slivers are dropped from eligible sets', () => {
        // A document of many tiny separated fragments produces sliver chunks;
        // none should survive the minimum-length filter unless one is big enough.
        const text = Array.from({ length: 20 }, (_, i) => `kratko-${i}`).join('\n\n');
        const chunks = buildRetrievalChunks(text, { docId: 'slivers' });
        expect(chunks.every((c) => c.text.length >= RETRIEVAL_MIN_CHUNK_CHARS || c.text === '')).toBe(true);
    });
});
