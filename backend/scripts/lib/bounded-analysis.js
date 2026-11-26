'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { splitTextIntoChunks } = require('../../court-analysis/reasoning/retrieval/chunker');
const { mergeAnalysisChunkResults } = require('../../court-analysis/extraction/chunkMerge');
const { extractAssistantText } = require('./openrouter-client');
const { extractTableHeader, applyHeaderPreservation } = require('./table-header-preprocessor');

const CHUNK_SIZE = 3500;
const CHUNK_OVERLAP = 350;
const DEFAULT_CHECKPOINT_DIR = path.resolve(__dirname, '../../data/pdf-engine-bench/checkpoints');

function shouldBoundAnalysis(doc = {}, context = {}, text = '') {
    return context.analysisMode !== 'single'
        && (doc.tableHeavy === true || Number(doc.pages) > 4 || doc.analysisPlan?.textSegments > 1 || String(text || '').length > 12000);
}

function stripCodeFence(text) {
    return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function parseResult(raw, rawText = extractAssistantText(raw.response)) {
    if (raw.error) throw new Error(typeof raw.error === 'string' ? raw.error : JSON.stringify(raw.error));
    if (raw.finish_reason === 'length') throw new Error('Segment output was truncated (finish reason: length)');
    let value;
    try { value = JSON.parse(stripCodeFence(rawText)); } catch (error) { throw error; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Segment JSON must be an object');
    return value;
}

function checkpointKey(segment, model, promptHash, options = {}) {
    return crypto.createHash('sha256')
        .update(`${segment.id}:${segment.text}:${model}:${promptHash}:${JSON.stringify(options || {})}`)
        .digest('hex');
}

function readCheckpoint(filePath, expectedKey) {
    try {
        const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return saved?.version === 1
            && saved.key === expectedKey
            && saved.value
            && typeof saved.value === 'object'
            && !Array.isArray(saved.value)
            ? saved
            : null;
    } catch {
        return null;
    }
}

function writeCheckpoint(filePath, data) {
    writeJsonAtomically(filePath, data);
}

function writeJsonAtomically(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(data), { mode: 0o600 });
        fs.renameSync(temporaryPath, filePath);
    } finally {
        try { fs.unlinkSync(temporaryPath); } catch { /* renamed or already absent */ }
    }
}

function persistRawRequest(checkpointDir, key, request, filePath = null) {
    const artifactPath = filePath || path.join(
        checkpointDir,
        `${key}.${Date.now()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.request.json`,
    );
    request.rawArtifact = path.relative(path.resolve(__dirname, '../..'), artifactPath);
    writeJsonAtomically(artifactPath, request);
    return artifactPath;
}

function measureCoverage(segments) {
    const intervals = segments.map(({ startIndex, endIndex }) => [startIndex, endIndex]).sort((a, b) => a[0] - b[0]);
    let coveredCharacters = 0;
    let start = null;
    let end = null;
    for (const [nextStart, nextEnd] of intervals) {
        if (start === null) { start = nextStart; end = nextEnd; }
        else if (nextStart <= end) end = Math.max(end, nextEnd);
        else { coveredCharacters += end - start; start = nextStart; end = nextEnd; }
    }
    if (start !== null) coveredCharacters += end - start;
    return coveredCharacters;
}

function addUsage(target, usage) {
    for (const [key, value] of Object.entries(usage || {})) {
        if (Number.isFinite(value)) target[key] = (target[key] || 0) + value;
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!target[key]) target[key] = {};
            addUsage(target[key], value);
        }
    }
}

async function runBoundedAnalysis({ doc = {}, context = {}, sourceText, pageRanges = [], requestText, model }) {
    const started = performance.now();
    const text = String(sourceText || '');
    const chunks = splitTextIntoChunks(text, {
        chunkSize: CHUNK_SIZE,
        chunkOverlap: CHUNK_OVERLAP,
        docId: doc.docId || 'document',
    });
    const preservedChunks = context.tableHeaders === 'on'
        ? applyHeaderPreservation(chunks, extractTableHeader(text))
        : chunks;
    const segments = preservedChunks.map((chunk) => ({
        id: chunk.id,
        text: chunk.text,
        startIndex: chunk.metadata.startIndex,
        endIndex: chunk.metadata.endIndex,
        pageNumbers: pageRanges
            .filter((page) => page.endIndex > chunk.metadata.startIndex && page.startIndex < chunk.metadata.endIndex)
            .map((page) => page.pageNumber),
    }));
    const metadata = {
        mode: 'bounded',
        status: 'running',
        kind: 'text',
        segments: segments.map((segment) => ({
            id: segment.id,
            startIndex: segment.startIndex,
            endIndex: segment.endIndex,
            pageNumbers: segment.pageNumbers,
            status: 'pending',
        })),
        requests: [],
        gaps: [],
        coverage: { coveredCharacters: 0, totalCharacters: text.length, rate: 0 },
        error: null,
    };
    const values = [];
    const usage = {};
    const providers = new Set();
    let cost = 0;
    let costIncomplete = false;
    let retries = 0;
    let lastRaw = null;
    let error = segments.length ? null : 'No source segments to analyze';
    const checkpointDir = context.checkpointDir || DEFAULT_CHECKPOINT_DIR;
    const checkpointOptions = context.checkpointOptions || {};
    const promptHash = context.promptHash || '';
    let rawPersistenceFailed = false;
    const noCache = context.noCache === true || context.forceRerun === true;

    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const key = checkpointKey(segment, model, promptHash, checkpointOptions);
        const checkpointPath = path.join(checkpointDir, `${key}.json`);
        if (!noCache) {
            const saved = readCheckpoint(checkpointPath, key);
            if (saved) {
                values.push({ segment, value: saved.value });
                metadata.segments[index].status = 'completed';
                metadata.requests.push({
                    segmentId: segment.id,
                    condition: context.analysisCondition || 'raw_parse',
                    pageNumbers: segment.pageNumbers,
                    startIndex: segment.startIndex,
                    endIndex: segment.endIndex,
                    status: 'checkpoint: hit',
                    checkpoint: 'hit',
                    httpStatus: saved.httpStatus ?? null,
                    cost: 0,
                    latencyMs: 0,
                    finishReason: saved.finishReason ?? null,
                    rawText: saved.rawText || '',
                    parseDiagnostics: null,
                    error: null,
                });
                continue;
            }
        }
        if (context.beforeRequest && !context.beforeRequest()) {
            error = 'Stopped before all source segments were analyzed';
            break;
        }
        let raw;
        try {
            raw = await requestText(segment.text, segment);
        } catch (failure) {
            raw = {
                ...failure.rawResult,
                error: failure.rawResult?.error || String(failure.message || failure),
                cost: failure.rawResult?.cost ?? null,
                status: failure.rawResult?.status ?? null,
            };
        }
        lastRaw = raw;
        if (Number.isFinite(raw.cost)) cost += raw.cost;
        else costIncomplete = true;
        if (raw.costIncomplete) costIncomplete = true;
        addUsage(usage, raw.usage);
        retries += raw.retries || 0;
        if (raw.provider) providers.add(raw.provider);
        const rawText = extractAssistantText(raw.response);
        const request = {
            segmentId: segment.id,
            condition: context.analysisCondition || 'raw_parse',
            pageNumbers: segment.pageNumbers,
            startIndex: segment.startIndex,
            endIndex: segment.endIndex,
            status: 'received',
            httpStatus: raw.status ?? null,
            cost: Number.isFinite(raw.cost) ? raw.cost : null,
            latencyMs: raw.latencyMs ?? null,
            finishReason: raw.finish_reason ?? null,
            error: raw.error || null,
            rawText,
            parseDiagnostics: null,
            diagnostics: raw.diagnostics ?? null,
            analysisSegmentation: raw.analysisSegmentation ?? null,
        };
        metadata.requests.push(request);
        const keepGoing = raw.costAccounted
            ? context.beforeRequest ? context.beforeRequest() : true
            : context.recordRequest ? context.recordRequest(raw, 0) : true;
        let rawArtifactPath = null;
        request.rawPersistedBeforeParse = true;
        try {
            rawArtifactPath = persistRawRequest(checkpointDir, key, request);
        } catch (failure) {
            request.rawPersistedBeforeParse = false;
            rawPersistenceFailed = true;
            const message = String(failure.message || failure);
            request.status = 'failed';
            request.rawPersistenceError = message;
            request.error = `Unable to persist raw response before parsing: ${message}`;
            request.parseDiagnostics = { name: failure.name || 'RawPersistenceError', message: request.error };
            metadata.segments[index].status = 'failed';
            metadata.gaps.push({
                segmentId: segment.id,
                startIndex: segment.startIndex,
                endIndex: segment.endIndex,
                pageNumbers: segment.pageNumbers,
                reason: request.error,
            });
            error = request.error;
            context.onRequestProgress?.(metadata, context.analysisCondition || 'raw_parse');
            break;
        }
        context.onRequestProgress?.(metadata, context.analysisCondition || 'raw_parse');
        let value;
        try {
            value = parseResult(raw, rawText);
        } catch (failure) {
            const message = String(failure.message || failure);
            metadata.segments[index].status = 'failed';
            request.status = 'failed';
            request.error = message;
            request.parseDiagnostics = { name: failure.name || 'Error', message };
            metadata.gaps.push({
                segmentId: segment.id,
                startIndex: segment.startIndex,
                endIndex: segment.endIndex,
                pageNumbers: segment.pageNumbers,
                reason: message,
            });
            error = `Segment ${segment.id}: ${message}`;
        }
        if (value) {
            values.push({ segment, value });
            metadata.segments[index].status = 'completed';
            request.status = 'completed';
            try {
                writeCheckpoint(checkpointPath, {
                    version: 1,
                    key,
                    value,
                    rawText,
                    httpStatus: raw.status ?? null,
                    finishReason: raw.finish_reason ?? null,
                });
            } catch (failure) {
                request.checkpointError = String(failure.message || failure);
            }
        }
        try {
            rawArtifactPath = persistRawRequest(checkpointDir, key, request, rawArtifactPath);
        } catch (failure) {
            request.rawPersistenceError = String(failure.message || failure);
        }
        context.onRequestProgress?.(metadata, context.analysisCondition || 'raw_parse');
        if ((!keepGoing || costIncomplete) && index < segments.length - 1) {
            error = costIncomplete
                ? 'Request cost is unknown; remaining segments were not requested'
                : 'Cost guard stopped analysis before all source segments completed';
            break;
        }
    }

    const coveredCharacters = measureCoverage(values.map(({ segment }) => segment));
    metadata.coverage = {
        coveredCharacters,
        totalCharacters: text.length,
        rate: text.length ? coveredCharacters / text.length : 0,
    };
    let response = null;
    if (values.length) {
        const { gaps: _mergeGaps, assignmentCueGaps: _assignmentCueGaps, ...merged } = mergeAnalysisChunkResults(values, text);
        metadata.status = values.length === segments.length ? 'completed' : 'partial';
        response = { choices: [{ message: { content: JSON.stringify(merged) } }] };
    } else {
        metadata.status = 'failed';
    }
    metadata.error = error;
    if (!error && metadata.gaps.length) metadata.error = `${metadata.gaps.length} segment(s) failed JSON parsing`;
    return {
        response,
        error: values.length ? null : error,
        cost,
        costIncomplete,
        usage: Object.keys(usage).length ? usage : null,
        latencyMs: performance.now() - started,
        retries,
        provider: [...providers].join(', ') || null,
        finish_reason: lastRaw?.finish_reason ?? null,
        status: lastRaw?.status ?? null,
        diagnostics: lastRaw?.diagnostics ?? null,
        analysisSegmentation: metadata,
        parserText: '',
        groundingText: text,
        estimatedParserFee: 0,
        costAccounted: true,
        ...(rawPersistenceFailed ? { shouldContinue: false } : {}),
    };
}

module.exports = { shouldBoundAnalysis, runBoundedAnalysis, CHUNK_SIZE, CHUNK_OVERLAP, checkpointKey, DEFAULT_CHECKPOINT_DIR, persistRawRequest };

