const { buildRetrievalChunks, RETRIEVAL_MIN_CHUNK_CHARS } = require('../../court-analysis/reasoning/retrieval/chunker');

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

    test('indexes every eligible chunk across a 40-page document', () => {
        const text = longText(40);
        const chunks = buildRetrievalChunks(text, { docId: 'long' });

        expect(chunks.length).toBeGreaterThan(8);
        expect(chunks.at(-1).metadata.endIndex).toBeGreaterThanOrEqual(text.length - 2);
    });

    test('supports a one-chunk explicit sample without dividing by zero', () => {
        const chunks = buildRetrievalChunks(longText(40), { docId: 'one', limit: 1 });

        expect(chunks).toHaveLength(1);
        expect(chunks[0].metadata.startIndex).toBeGreaterThan(0);
    });

    test('an explicit sample spreads coverage across the document', () => {
        const chunks = buildRetrievalChunks(longText(80), { docId: 'spread', limit: 4 });
        const first = chunks[0];
        const last = chunks.at(-1);
        expect(last.metadata.startIndex).toBeGreaterThan(first.metadata.endIndex);
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
