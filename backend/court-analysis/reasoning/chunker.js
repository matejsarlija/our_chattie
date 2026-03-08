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
    // Using a hash prevents accidental collisions if indices overlap in some weird way
    // or if we change splitting logic.
    // docId:chunkIndex is simple.
    // Let's use SHA256(docId + ':' + chunkIndex) for stability.
    return crypto.createHash('sha256').update(`${docId}:${chunkIndex}`).digest('hex');
}

/**
 * Splits text into chunks recursively by trying to split on separators.
 * This mimics LangChain's RecursiveCharacterTextSplitter logic.
 * 
 * Separators (in order): ["\n\n", "\n", " ", ""]
 * 
 * @param {string} text - The text to split.
 * @param {object} options - { chunkSize, chunkOverlap, docId }
 * @returns {Array<{id: string, text: string, metadata: { startIndex: number, endIndex: number, docId: string } }>}
 */
function splitTextIntoChunks(text, options = {}) {
    if (!text) return [];

    const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options.chunkOverlap || DEFAULT_CHUNK_OVERLAP;
    const docId = options.docId || 'unknown-doc';
    const separators = options.separators || ["\n\n", "\n", " ", ""];

    // 1. Base case: If text fits in one chunk, return it.
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

    // 2. Recursive Splitting
    const finalChunks = [];
    
    // Find appropriate separator
    let separator = separators[separators.length - 1]; // Default to chars
    for (const sep of separators) {
        if (text.includes(sep)) {
            separator = sep;
            break;
        }
    }
    
    const splits = separator ? text.split(separator) : [text];
    
    let currentChunk = [];
    let currentLen = 0;
    
    // Helper to push a finalized chunk
    const pushChunk = (chunkText, startIndex) => {
        // Add overlap logic if needed, but for now strict implementation
        // Actually, overlap is tricky with recursive splits.
        // Let's implement a simpler iterative accumulator approach which is standard.
        // Instead of recursing, we iterate splits and merge.
        
        finalChunks.push({
            id: computeChunkId(docId, finalChunks.length),
            text: chunkText,
            metadata: {
                docId: docId,
                startIndex: startIndex, // Approximate without tracking exact char pos through splits
                endIndex: startIndex + chunkText.length
            }
        });
    };
    
    // Iterative merge with overlap logic
    // We need to track global character index to provide metadata
    // But splits lose the separator characters...
    // To implement `startIndex` correctly with `split`, we need to add back the separator length.
    
    // Let's refine: Use a simpler approach for now that just accumulates words/sentences.
    // Or stick to the recursive pattern but track offsets?
    // Tracking offsets through recursive splits is hard.
    
    // Alternative: Just iterate over the string with regex matching separators?
    // Let's implement the iterative accumulator on the `splits` array.
    
    let buffer = [];
    let bufferLen = 0;
    let currentStart = 0; // Approximate start index in original text
    
    // Pre-calculate separator length (except for empty string separator)
    const sepLen = separator.length;
    
    for (let i = 0; i < splits.length; i++) {
        const split = splits[i];
        const nextLen = bufferLen + split.length + (buffer.length > 0 ? sepLen : 0);
        
        if (nextLen > chunkSize && buffer.length > 0) {
            // Chunk is full. Push buffer.
            const chunkText = buffer.join(separator);
            
            // Generate metadata
            // startIndex is tricky here because we are iterating splits.
            // Let's just track cumulative length roughly or ignore exact startIndex for now?
            // The spec asks for "Chunk IDs deterministic".
            // Let's ignore precise startIndex for this iteration unless critical.
            // Wait, reasoning might need it to highlight text?
            // Yes, citations need it.
            // Okay, let's track `processedLength`.
            
            finalChunks.push({
                text: chunkText,
                // We'll fix up IDs and Metadata at the end to be safe?
                // Or just push minimal object.
            });
            
            // Handle Overlap: keep trailing splits that fit in overlap size
            // Backtrack buffer to keep last N chars < overlap
            // This is hard with variable length splits.
            // Simplified overlap: Keep last X splits that fit?
            
            // Reset buffer with overlap
            // For now, clear buffer to implement valid chunking first (overlap is P1/nice-to-have correctness)
            // Ideally: while (bufferLen > overlap) shift();
            
            while (bufferLen > chunkOverlap && buffer.length > 0) {
                const removed = buffer.shift();
                bufferLen -= (removed.length + (buffer.length > 0 ? sepLen : 0));
            }
            // If still too big (single massive split), clear it
            if (bufferLen > chunkOverlap) {
                 buffer = [];
                 bufferLen = 0;
            }
        }
        
        buffer.push(split);
        bufferLen += split.length + (buffer.length > 1 ? sepLen : 0);
    }
    
    if (buffer.length > 0) {
        finalChunks.push({ text: buffer.join(separator) });
    }
    
    // Post-process to assign IDs and attempt to recover metadata
    // Recovering metadata exactly is hard if we just joined splits.
    // Better strategy: Use a cursor on original text.
    
    // RESTART STRATEGY: Cursor-based slicing.
    // 1. Iterate chars.
    // 2. If char is separator, check bounds.
    // This is safer for indices.
    
    return finalChunks.map((c, i) => ({
        id: computeChunkId(docId, i),
        text: c.text,
        metadata: {
            docId: docId,
            startIndex: 0, // TODO: Fix index tracking
            endIndex: 0
        }
    }));
}

// Re-implementing with proper index tracking and recursion
function splitTextRecursive(text, chunkSize, chunkOverlap, separators) {
    const finalChunks = [];
    let separator = separators[separators.length - 1];
    let newSeparators = [];
    
    for (let i = 0; i < separators.length; i++) {
        const s = separators[i];
        if (s === "") {
             separator = s;
             break;
        }
        if (text.includes(s)) {
            separator = s;
            newSeparators = separators.slice(i + 1);
            break;
        }
    }
    
    const splits = separator ? text.split(separator) : text.split(""); // fallback to char
    let goodSplits = [];
    
    // Merge splits back into chunks
    let currentDoc = [];
    let totalLen = 0;
    
    for (const split of splits) {
        if (split.length < chunkSize) {
            currentDoc.push(split);
            totalLen += split.length + (currentDoc.length > 1 ? separator.length : 0);
            
            if (totalLen > chunkSize) {
                // Determine split point?
                // This logic is getting complex for a "simple" task.
                // Let's use the provided standard LangChain logic simplified:
            }
        }
    }
    
    // Let's go with the simpler non-recursive string search implementation.
    return []; 
}

// ---------------------------------------------------------
// THIRD ATTEMPT: Standard robust implementation (Simple)
// ---------------------------------------------------------

function simpleChunker(text, options = {}) {
     const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
     const chunkOverlap = options.chunkOverlap || DEFAULT_CHUNK_OVERLAP;
     const docId = options.docId || 'unknown-doc';
     
     const chunks = [];
     let start = 0;
     
     while (start < text.length) {
         let end = start + chunkSize;
         
         if (end >= text.length) {
             end = text.length;
         } else {
             // Try to find a nice break point (newline, space) looking backwards from 'end'
             // Look back up to 'overlap' distance to find a break
             let foundBreak = false;
             const searchLimit = Math.max(start, end - chunkOverlap); // Don't look back past start
             
             // Priority 1: Newlines
             const lastNewline = text.lastIndexOf('\n', end);
             if (lastNewline > searchLimit) {
                 end = lastNewline + 1; // Include newline
                 foundBreak = true;
             }
             
             // Priority 2: Space
             if (!foundBreak) {
                 const lastSpace = text.lastIndexOf(' ', end);
                 if (lastSpace > searchLimit) {
                     end = lastSpace + 1;
                     foundBreak = true;
                 }
             }
             
             // If no break found, we force split at 'end' (mid-word)
         }
         
         const chunkText = text.slice(start, end).trim();
         
         if (chunkText.length > 0) {
             chunks.push({
                 id: computeChunkId(docId, chunks.length),
                 text: chunkText,
                 metadata: {
                     docId: docId,
                     startIndex: start,
                     endIndex: end // Note: .trim() might change actual length, but this tracks source span roughly
                 }
             });
         }
         
         // Move start forward
         // Overlap: We want the NEXT chunk to start 'overlap' characters before THIS chunk ended?
         // No, we want the next chunk to start `chunkSize - overlap` after the current start?
         // Standard sliding window: stride = chunkSize - overlap.
         // But we used variable `end` based on delimiters.
         
         // Correct logic:
         // If we hit end of text, break.
         if (end >= text.length) break;
         
         // If we found a clean break, `end` is the break point.
         // To create overlap, we should verify if we can simply move `start`.
         
         // The "sliding window" approach:
         // Start = End - Overlap
         // Ensure Start > Previous Start (progress)
         
         const nextStart = Math.max(start + 1, end - chunkOverlap);
         start = nextStart;
     }
     
     return chunks;
}

module.exports = {
    splitTextIntoChunks: simpleChunker,
    computeChunkId
};
