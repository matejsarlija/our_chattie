// backend/court-analysis/reasoning/chunker.js

const crypto = require('crypto');

const DEFAULT_CHUNK_SIZE = 1000;
const DEFAULT_CHUNK_OVERLAP = 200;

/**
 * Computes a deterministic ID for a chunk based on docId and index.
 * @param {string} docId - The document ID.
 * @param {number} chunkIndex - The index of the chunk in the document.
 * @returns {string} - Deterministic ID string.
 */
function computeChunkId(docId, chunkIndex) {
    if (!docId) throw new Error('docId is required for computeChunkId');
    return crypto.createHash('sha256').update(`${docId}:${chunkIndex}`).digest('hex');
}

/**
 * Splits text into chunks using a cursor-based sliding window.
 *
 * Strategy:
 * - Walk the text with a cursor. Each chunk ends at a preferred break point
 *   (paragraph, newline, then space) that is at most `chunkSize` chars away.
 * - Overlap is implemented by starting the next chunk `chunkOverlap` chars
 *   before the current chunk's end (stride = chunkSize - chunkOverlap), while
 *   guaranteeing forward progress and that the whole text is covered exactly once.
 * - `startIndex`/`endIndex` always refer to positions in the ORIGINAL text, so
 *   citations can highlight the exact source span.
 *
 * @param {string} text - The text to split.
 * @param {object} options - { chunkSize, chunkOverlap, docId }
 * @returns {Array<{id: string, text: string, metadata: { startIndex: number, endIndex: number, docId: string } }>}
 */
function splitTextIntoChunks(text, options = {}) {
    if (!text || text.length === 0) return [];

    const chunkSize = Math.max(1, Number.isFinite(options.chunkSize) ? options.chunkSize : DEFAULT_CHUNK_SIZE);
    const chunkOverlap = Math.max(0, Number.isFinite(options.chunkOverlap) ? options.chunkOverlap : DEFAULT_CHUNK_OVERLAP);
    const docId = options.docId || 'unknown-doc';

    if (text.length <= chunkSize) {
        return [{
            id: computeChunkId(docId, 0),
            text: text,
            metadata: {
                docId: docId,
                startIndex: 0,
                endIndex: text.length
            }
        }];
    }

    const chunks = [];
    const stride = Math.max(1, chunkSize - chunkOverlap);
    let start = 0;
    let chunkIndex = 0;

    while (start < text.length) {
        const remaining = text.length - start;
        let end = start + Math.min(chunkSize, remaining);

        if (end < text.length) {
            // Accept a break point only if it still guarantees forward progress
            // (the next chunk start is `end - overlap`, so require end > start + overlap).
            // This prevents re-finding a stale separator far behind the cursor
            // when the text has long runs without break points.
            const searchFloor = start + chunkOverlap;
            const newlineIndex = text.lastIndexOf('\n', end);
            if (newlineIndex >= searchFloor) {
                end = newlineIndex + 1;
            } else {
                const spaceIndex = text.lastIndexOf(' ', end);
                if (spaceIndex >= searchFloor) {
                    end = spaceIndex + 1;
                }
            }
        }

        const rawChunkText = text.slice(start, end);
        const trimmedStartOffset = rawChunkText.length - rawChunkText.trimStart().length;
        const trimmedText = rawChunkText.trim();
        const trimmedTextStart = start + trimmedStartOffset;
        const trimmedTextEnd = trimmedTextStart + trimmedText.length;

        if (trimmedText.length > 0) {
            chunks.push({
                id: computeChunkId(docId, chunkIndex),
                text: trimmedText,
                metadata: {
                    docId: docId,
                    startIndex: trimmedTextStart,
                    endIndex: trimmedTextEnd
                }
            });
            chunkIndex += 1;
        }

        if (end >= text.length) break;

        // Next chunk starts `chunkOverlap` chars before this chunk's end,
        // but always forward from the previous start to guarantee progress.
        start = Math.max(start + 1, end - chunkOverlap);
    }

    return chunks;
}

module.exports = {
    splitTextIntoChunks,
    computeChunkId
};
