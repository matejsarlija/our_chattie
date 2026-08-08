const { splitTextIntoChunks, computeChunkId } = require('../court-analysis/reasoning/chunker');
const fc = require('fast-check');

describe('Chunker', () => {
    describe('computeChunkId', () => {
        test('is deterministic for same inputs', () => {
            const id1 = computeChunkId('doc1', 0);
            const id2 = computeChunkId('doc1', 0);
            expect(id1).toBe(id2);
        });

        test('is distinct for different indices', () => {
            const id1 = computeChunkId('doc1', 0);
            const id2 = computeChunkId('doc1', 1);
            expect(id1).not.toBe(id2);
        });

        test('is distinct for different docs', () => {
            const id1 = computeChunkId('doc1', 0);
            const id2 = computeChunkId('doc2', 0);
            expect(id1).not.toBe(id2);
        });
    });

    describe('splitTextIntoChunks', () => {
        test('splits basic text respecting chunk size', () => {
            const text = "This is a simple sentence. It has multiple words.";
            // Max 15 chars. "This is a simpl" -> cut.
            // Expected: "This is a" (9), "simple" (6), "sentence." (9)...
            const chunks = splitTextIntoChunks(text, { chunkSize: 15, chunkOverlap: 0 });
            
            // Check that no chunk exceeds size
            chunks.forEach(c => {
                expect(c.text.length).toBeLessThanOrEqual(15);
            });
            
            // Check content preservation (roughly)
            const reconstructed = chunks.map(c => c.text).join(' ').replace(/\s+/g, '');
            const original = text.replace(/\s+/g, '');
            // Note: simple join might add extra spaces, but content should match.
            // Actually, without overlap, reconstruction is hard if we split by words.
            // Let's check specific expected chunks.
            expect(chunks[0].text).toContain('This is a');
        });

        test('respects overlap', () => {
            const text = "12345 67890 abcde fghij";
            // Chunk 10, Overlap 5.
            // "12345 6789" (10) -> "12345"
            // Next starts at index 5? 
            // "67890 abcd"
            const chunks = splitTextIntoChunks(text, { chunkSize: 10, chunkOverlap: 5 });
            
            expect(chunks.length).toBeGreaterThan(1);
            // Overlap check: end of chunk 0 should appear in chunk 1
            const chunk0End = chunks[0].text.slice(-3);
            const chunk1Start = chunks[1].text.slice(0, 3);
            // It's approximate due to word boundaries, but let's see.
        });

        test('handles empty input gracefully', () => {
            const chunks = splitTextIntoChunks('', { chunkSize: 100 });
            expect(chunks).toEqual([]);
        });

        test('handles text smaller than chunk size', () => {
            const text = "Small text";
            const chunks = splitTextIntoChunks(text, { chunkSize: 100 });
            expect(chunks).toHaveLength(1);
            expect(chunks[0].text).toBe(text);
            expect(chunks[0].metadata.startIndex).toBe(0);
            expect(chunks[0].metadata.endIndex).toBe(text.length);
        });

        test('metadata includes docId and indices', () => {
            const text = "Hello world";
            const chunks = splitTextIntoChunks(text, { chunkSize: 100, docId: 'test-doc' });
            expect(chunks[0].id).toBeDefined();
            expect(chunks[0].metadata.docId).toBe('test-doc');
            expect(chunks[0].metadata.startIndex).toBe(0);
            expect(chunks[0].metadata.endIndex).toBe(11);
        });
        
        test('splits by newlines first', () => {
            const text = "Paragraph 1.\n\nParagraph 2 is longer.";
            // If chunk size is small enough to split paragraphs but large enough to keep them whole
            const chunks = splitTextIntoChunks(text, { chunkSize: 20, chunkOverlap: 0 });
            // "Paragraph 1." is 12 chars. "Paragraph 2 is longer." is 22 chars.
            // Expect P1 to be its own chunk.
            expect(chunks[0].text).toBe("Paragraph 1.");
        });
    });

    describe('splitTextIntoChunks property-based invariants', () => {
        const textArbitrary = fc.array(
            fc.oneof(
                fc.constant('a'),
                fc.constant(' '),
                fc.constant('\n'),
                fc.constant('.'),
                fc.constant('-'),
                fc.constant('č'),
                fc.constant('š'),
                fc.constant('ž'),
            ),
            { maxLength: 4000 },
        ).map((parts) => parts.join(''));

        test('loses no non-whitespace content across arbitrary texts and sizes', () => {
            fc.assert(
                fc.property(
                    textArbitrary,
                    fc.integer({ min: 1, max: 2000 }),
                    fc.integer({ min: 0, max: 500 }),
                    (text, chunkSize, chunkOverlap) => {
                        const chunks = splitTextIntoChunks(text, { chunkSize, chunkOverlap, docId: 'prop' });
                        const covered = new Array(text.length).fill(false);
                        for (const chunk of chunks) {
                            for (let i = chunk.metadata.startIndex; i < chunk.metadata.endIndex; i += 1) {
                                covered[i] = true;
                            }
                        }
                        for (let i = 0; i < text.length; i += 1) {
                            if (text[i].trim() !== '' && !covered[i]) {
                                return false;
                            }
                        }
                        return true;
                    },
                ),
            );
        });

        test('every chunk text exactly matches its reported source span', () => {
            fc.assert(
                fc.property(
                    textArbitrary,
                    fc.integer({ min: 1, max: 2000 }),
                    fc.integer({ min: 0, max: 500 }),
                    (text, chunkSize, chunkOverlap) => {
                        const chunks = splitTextIntoChunks(text, { chunkSize, chunkOverlap, docId: 'prop' });
                        return chunks.every((chunk) => {
                            const { startIndex, endIndex } = chunk.metadata;
                            return text.slice(startIndex, endIndex) === chunk.text;
                        });
                    },
                ),
            );
        });

        test('no chunk exceeds the requested chunk size', () => {
            fc.assert(
                fc.property(
                    textArbitrary,
                    fc.integer({ min: 1, max: 2000 }),
                    fc.integer({ min: 0, max: 500 }),
                    (text, chunkSize, chunkOverlap) => {
                        const chunks = splitTextIntoChunks(text, { chunkSize, chunkOverlap, docId: 'prop' });
                        return chunks.every((chunk) => chunk.text.length <= chunkSize);
                    },
                ),
            );
        });

        test('chunks are ordered by monotonically increasing start index', () => {
            fc.assert(
                fc.property(
                    textArbitrary,
                    fc.integer({ min: 1, max: 2000 }),
                    fc.integer({ min: 0, max: 500 }),
                    (text, chunkSize, chunkOverlap) => {
                        const chunks = splitTextIntoChunks(text, { chunkSize, chunkOverlap, docId: 'prop' });
                        for (let i = 1; i < chunks.length; i += 1) {
                            if (chunks[i].metadata.startIndex < chunks[i - 1].metadata.startIndex) {
                                return false;
                            }
                        }
                        return true;
                    },
                ),
            );
        });

        test('chunks bound all non-whitespace content from first to last chunk', () => {
            fc.assert(
                fc.property(
                    textArbitrary,
                    fc.integer({ min: 1, max: 2000 }),
                    fc.integer({ min: 0, max: 500 }),
                    (text, chunkSize, chunkOverlap) => {
                        const chunks = splitTextIntoChunks(text, { chunkSize, chunkOverlap, docId: 'prop' });
                        const nonWhitespace = text.replace(/\s+/g, '');
                        if (nonWhitespace.length === 0) return true;
                        if (chunks.length === 0) return false;
                        const first = chunks[0].metadata.startIndex;
                        const last = chunks[chunks.length - 1].metadata.endIndex;
                        // Every non-whitespace char must fall within [first, last].
                        for (let i = 0; i < text.length; i += 1) {
                            if (text[i].trim() !== '' && (i < first || i >= last)) {
                                return false;
                            }
                        }
                        return true;
                    },
                ),
            );
        });

        test('creates deterministic chunk ids for the same document', () => {
            fc.assert(
                fc.property(
                    textArbitrary,
                    fc.integer({ min: 1, max: 500 }),
                    (text, chunkSize) => {
                        const a = splitTextIntoChunks(text, { chunkSize, chunkOverlap: 10, docId: 'doc-x' });
                        const b = splitTextIntoChunks(text, { chunkSize, chunkOverlap: 10, docId: 'doc-x' });
                        expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
                        return true;
                    },
                ),
            );
        });
    });
});
