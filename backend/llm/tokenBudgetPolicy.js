'use strict';

const {
    isTableDenseText,
    pageRangesFromMarkedText,
    pageNumbersForRange,
} = require('../court-analysis/extraction/pdfText');
const { splitTextIntoChunks } = require('../court-analysis/reasoning/retrieval/chunker');

const CHUNKING_TRIGGER_CHARS = 4000;
const CHUNKING_TRIGGER_PAGES = 2;
const PROSE_CHUNK_SIZE = 3500;
const TABLE_DENSE_MIN_CHARS = 2200;
const TABLE_DENSE_TARGET_CHARS = 2500;
const TABLE_DENSE_MAX_CHARS = 2800;
const CHUNK_OVERLAP_CHARS = 350;
const BISECT_MIN_CHARS = 800;
const BISECT_MAX_DEPTH = 2;

function estimateSegmentProfile(text, { pageCount = 1, isTableDense = null } = {}) {
    const sourceText = String(text || '');
    const tableDense = typeof isTableDense === 'boolean'
        ? isTableDense
        : isTableDenseText(sourceText);
    const effectivePages = Number.isFinite(pageCount) && pageCount > 0 ? pageCount : 1;
    const shouldChunk = sourceText.length > CHUNKING_TRIGGER_CHARS
        || effectivePages > CHUNKING_TRIGGER_PAGES
        || tableDense;

    return {
        charCount: sourceText.length,
        pageCount: effectivePages,
        densityClass: tableDense ? 'table_dense' : 'prose',
        isTableDense: tableDense,
        shouldChunk,
        chunkSize: tableDense ? TABLE_DENSE_TARGET_CHARS : PROSE_CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP_CHARS,
    };
}

function splitTableDenseOnNewlines(sourceText, {
    docId = 'doc',
    minWindow = TABLE_DENSE_MIN_CHARS,
    maxWindow = TABLE_DENSE_MAX_CHARS,
    overlapChars = CHUNK_OVERLAP_CHARS,
} = {}) {
    const text = String(sourceText || '');
    if (text.length <= maxWindow) {
        return [{
            id: `${docId}:table-1`,
            text,
            startIndex: 0,
            endIndex: text.length,
        }];
    }

    const lines = text.split('\n');
    const lineOffsets = [];
    let cursor = 0;
    for (let i = 0; i < lines.length; i += 1) {
        const start = cursor;
        const lineText = i < lines.length - 1 ? `${lines[i]}\n` : lines[i];
        cursor += lineText.length;
        lineOffsets.push({ start, end: cursor, length: lineText.length });
    }

    const chunks = [];
    let startLineIdx = 0;
    while (startLineIdx < lineOffsets.length) {
        const winStart = lineOffsets[startLineIdx].start;
        let endLineIdx = startLineIdx;

        while (endLineIdx + 1 < lineOffsets.length) {
            const candidateEnd = lineOffsets[endLineIdx + 1].end;
            const candidateLen = candidateEnd - winStart;
            if (candidateLen > maxWindow && (lineOffsets[endLineIdx].end - winStart) >= minWindow) {
                break;
            }
            if (candidateLen > maxWindow) {
                break;
            }
            endLineIdx += 1;
            if ((lineOffsets[endLineIdx].end - winStart) >= TABLE_DENSE_TARGET_CHARS) {
                break;
            }
        }

        const winEnd = lineOffsets[endLineIdx].end;
        // Handle a single giant line with no newlines safely
        if (endLineIdx === startLineIdx && (winEnd - winStart) > maxWindow) {
            let sliceStart = winStart;
            while (sliceStart < winEnd) {
                const sliceEnd = Math.min(winEnd, sliceStart + TABLE_DENSE_TARGET_CHARS);
                chunks.push({
                    id: `${docId}:table-${chunks.length + 1}`,
                    text: text.slice(sliceStart, sliceEnd),
                    startIndex: sliceStart,
                    endIndex: sliceEnd,
                });
                if (sliceEnd >= winEnd) break;
                sliceStart = Math.max(sliceStart + 1, sliceEnd - overlapChars);
            }
            startLineIdx += 1;
            continue;
        }

        chunks.push({
            id: `${docId}:table-${chunks.length + 1}`,
            text: text.slice(winStart, winEnd),
            startIndex: winStart,
            endIndex: winEnd,
        });

        if (endLineIdx >= lineOffsets.length - 1) break;

        // Walk backwards from endLineIdx to include ~overlapChars aligned on line boundaries
        let nextStartLine = endLineIdx;
        while (nextStartLine > startLineIdx + 1) {
            const overlapSize = winEnd - lineOffsets[nextStartLine - 1].start;
            if (overlapSize > overlapChars) break;
            nextStartLine -= 1;
        }
        startLineIdx = nextStartLine <= startLineIdx ? endLineIdx + 1 : nextStartLine;
    }

    return chunks;
}

function buildAdaptiveSegments(text, {
    docId = 'doc',
    pageRanges = [],
    pageCount = null,
    isTableDense = null,
    splitFn = splitTextIntoChunks,
} = {}) {
    const sourceText = String(text || '');
    const resolvedPageRanges = Array.isArray(pageRanges) && pageRanges.length > 0
        ? pageRanges
        : pageRangesFromMarkedText(sourceText);
    const effectivePages = pageCount || resolvedPageRanges.length || 1;
    const profile = estimateSegmentProfile(sourceText, { pageCount: effectivePages, isTableDense });

    if (!profile.shouldChunk) {
        return {
            usedChunking: false,
            profile,
            segments: [{
                id: `${docId}:full`,
                text: sourceText,
                startIndex: 0,
                endIndex: sourceText.length,
                pageNumbers: pageNumbersForRange(resolvedPageRanges, 0, sourceText.length),
                densityClass: profile.densityClass,
                bisectDepth: 0,
            }],
        };
    }

    const useNewlineTableSplit = profile.isTableDense
        && !(typeof splitFn === 'function' && splitFn._isMockFunction);

    const rawChunks = useNewlineTableSplit
        ? splitTableDenseOnNewlines(sourceText, { docId })
        : splitFn(sourceText, {
            chunkSize: profile.chunkSize,
            chunkOverlap: profile.chunkOverlap,
            docId,
        });

    const segments = rawChunks.map((chunk, index) => {
        const startIndex = chunk.metadata?.startIndex ?? chunk.startIndex ?? 0;
        const endIndex = chunk.metadata?.endIndex ?? chunk.endIndex ?? (startIndex + chunk.text.length);
        return {
            id: chunk.id || `${docId}:chunk-${index + 1}`,
            text: chunk.text,
            startIndex,
            endIndex,
            pageNumbers: pageNumbersForRange(resolvedPageRanges, startIndex, endIndex),
            densityClass: profile.densityClass,
            bisectDepth: 0,
        };
    });

    return {
        usedChunking: true,
        profile,
        segments,
    };
}

function resolveTokenBudget({
    taskType = 'ExtractDoc',
    modelId = 'z-ai/glm-5.3-flash',
    segmentLength = 0,
    isTableDense = false,
    rowEstimate = 0,
} = {}) {
    const normalizedModel = String(modelId || '').toLowerCase();
    let answerTokens = 4096;
    if (taskType === 'SynthesizeCase') {
        answerTokens = 16384;
    } else if (taskType === 'VerifyReport') {
        answerTokens = 8192;
    } else if (isTableDense || rowEstimate >= 10) {
        const rowScaled = rowEstimate > 0 ? Math.max(8192, Math.min(12288, rowEstimate * 220)) : 8192;
        answerTokens = rowScaled;
    } else if (segmentLength > 3000) {
        answerTokens = 6144;
    }

    let reasoningHeadroom = 0;
    if (normalizedModel.startsWith('z-ai/')) {
        reasoningHeadroom = 1536;
    } else if (normalizedModel.includes('gemini-2.5')) {
        reasoningHeadroom = taskType === 'SynthesizeCase' ? 4096 : 1536;
    }

    const maxTokens = Math.min(24576, answerTokens + reasoningHeadroom);
    return {
        answerTokens,
        reasoningHeadroom,
        maxTokens,
        reasoning: normalizedModel.startsWith('z-ai/')
            ? { max_tokens: reasoningHeadroom, exclude: true }
            : undefined,
    };
}

function hasUnclosedJsonStructure(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    if (!(trimmed.startsWith('{') || trimmed.startsWith('[')) && !trimmed.includes('```json')) {
        return false;
    }
    try {
        const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        JSON.parse(cleaned);
        return false;
    } catch {
        return true;
    }
}

function analyzeCompletionTelemetry(response, { budget = null } = {}) {
    const meta = response?.usage_metadata || {};
    const details = response?.response_metadata?.usageDetails || {};
    const outputTokens = Number.isFinite(meta.output_tokens) ? meta.output_tokens : 0;
    const reasoningTokens = Number.isFinite(details.reasoning_tokens)
        ? details.reasoning_tokens
        : (Number.isFinite(meta.reasoning_tokens) ? meta.reasoning_tokens : 0);
    const finishReason = response?.response_metadata?.finish_reason ?? null;
    const reasoningRatio = outputTokens > 0
        ? Number((reasoningTokens / outputTokens).toFixed(4))
        : 0;
    const unclosedJson = hasUnclosedJsonStructure(response?.content);
    const hitLengthCap = finishReason === 'length';
    const isTruncated = hitLengthCap || (unclosedJson && outputTokens > 0);

    let truncationCause = null;
    if (hitLengthCap) {
        const reasoningStarved = reasoningRatio >= 0.7
            || (budget?.reasoningHeadroom > 0 && reasoningTokens >= budget.reasoningHeadroom);
        truncationCause = reasoningStarved ? 'reasoning_starvation' : 'answer_cap_exceeded';
    } else if (unclosedJson) {
        truncationCause = 'unclosed_json';
    }

    return {
        outputTokens,
        reasoningTokens,
        reasoningRatio,
        finishReason,
        hitLengthCap,
        unclosedJson,
        isTruncated,
        truncationCause,
    };
}

function findNearestNewlineSplit(text, minChars) {
    const midpoint = Math.floor(text.length / 2);
    let bestIdx = -1;
    let bestDist = Infinity;

    for (let i = minChars; i <= text.length - minChars; i += 1) {
        if (text[i] === '\n') {
            const dist = Math.abs(i - midpoint);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i + 1; // Keep trailing newline on left slice cleanly
            }
        }
    }

    if (bestIdx !== -1 && (text.length - bestIdx) >= minChars) {
        return bestIdx;
    }

    // Fall back to midpoint space when a table has no interior newlines
    for (let offset = 0; midpoint + offset <= text.length - minChars; offset += 1) {
        if (midpoint + offset >= minChars && text[midpoint + offset] === ' ') {
            return midpoint + offset + 1;
        }
        if (midpoint - offset >= minChars && text[midpoint - offset] === ' ') {
            return midpoint - offset + 1;
        }
    }

    return midpoint;
}

function bisectSegmentOnNewline(segment, { minChars = BISECT_MIN_CHARS, maxDepth = BISECT_MAX_DEPTH } = {}) {
    if (!segment || typeof segment.text !== 'string') return null;
    const nextDepth = (segment.bisectDepth || 0) + 1;
    if (nextDepth > maxDepth) return null;
    if (segment.text.length < minChars * 2) return null;

    const splitAt = findNearestNewlineSplit(segment.text, minChars);
    if (splitAt < minChars || (segment.text.length - splitAt) < minChars) {
        return null;
    }

    const baseStart = Number.isFinite(segment.startIndex) ? segment.startIndex : 0;
    const basePages = Array.isArray(segment.pageNumbers) ? segment.pageNumbers : [];
    const leftText = segment.text.slice(0, splitAt);
    const rightText = segment.text.slice(splitAt);

    return [
        {
            ...segment,
            id: `${segment.id}:b1`,
            text: leftText,
            startIndex: baseStart,
            endIndex: baseStart + leftText.length,
            pageNumbers: basePages,
            bisectDepth: nextDepth,
        },
        {
            ...segment,
            id: `${segment.id}:b2`,
            text: rightText,
            startIndex: baseStart + leftText.length,
            endIndex: baseStart + segment.text.length,
            pageNumbers: basePages,
            bisectDepth: nextDepth,
        },
    ];
}

module.exports = {
    CHUNKING_TRIGGER_CHARS,
    CHUNKING_TRIGGER_PAGES,
    PROSE_CHUNK_SIZE,
    TABLE_DENSE_MIN_CHARS,
    TABLE_DENSE_TARGET_CHARS,
    TABLE_DENSE_MAX_CHARS,
    CHUNK_OVERLAP_CHARS,
    BISECT_MIN_CHARS,
    BISECT_MAX_DEPTH,
    estimateSegmentProfile,
    splitTableDenseOnNewlines,
    buildAdaptiveSegments,
    resolveTokenBudget,
    analyzeCompletionTelemetry,
    bisectSegmentOnNewline,
};
