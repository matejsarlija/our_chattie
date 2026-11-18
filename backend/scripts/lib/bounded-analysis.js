'use strict';

const { performance } = require('node:perf_hooks');
const { PDFDocument } = require('pdf-lib');
const { splitTextIntoChunks } = require('../../court-analysis/reasoning/chunker');
const { mergeAnalysisChunkResults } = require('../../court-analysis/agents/analysis-agent');
const { extractAssistantText, extractParsedFileText, mistralOcrCost } = require('./openrouter-client');

const CHUNK_SIZE = 3500;
const CHUNK_OVERLAP = 350;

function shouldBoundAnalysis(doc = {}, context = {}, text = '') {
    return context.analysisMode !== 'single'
        && (doc.tableHeavy === true || Number(doc.pages) > 4 || doc.analysisPlan?.textSegments > 1 || String(text || '').length > 12000);
}

function parseResult(raw) {
    if (raw.error) throw new Error(typeof raw.error === 'string' ? raw.error : JSON.stringify(raw.error));
    if (raw.finish_reason === 'length') throw new Error('Segment output was truncated (finish reason: length)');
    const text = extractAssistantText(raw.response).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let value;
    try { value = JSON.parse(text); } catch { throw new Error('Segment returned invalid JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Segment JSON must be an object');
    return value;
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

async function runBoundedAnalysis({ doc = {}, context = {}, sourceText, pageRanges = [], pdfBytes, engine, requestText, requestPdf }) {
    const started = performance.now();
    const isPdf = pdfBytes != null;
    if (isPdf && sourceText != null) throw new Error('Pass exactly one bounded-analysis source type');
    let pdf;
    let segments;
    if (isPdf) {
        pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
        segments = Array.from({ length: pdf.getPageCount() }, (_, i) => ({
            id: `page-${i + 1}`, startIndex: null, endIndex: null, pageNumbers: [i + 1],
        }));
    } else {
        segments = splitTextIntoChunks(String(sourceText || ''), {
            chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP, docId: doc.docId || 'document',
        }).map(chunk => ({
            id: chunk.id, text: chunk.text, startIndex: chunk.metadata.startIndex, endIndex: chunk.metadata.endIndex,
            pageNumbers: pageRanges.filter(page => page.endIndex > chunk.metadata.startIndex && page.startIndex < chunk.metadata.endIndex).map(page => page.pageNumber),
        }));
    }
    const metadata = {
        mode: 'bounded', status: 'failed', kind: isPdf ? 'pdf' : 'text',
        segments: segments.map(({ text, ...segment }) => ({ ...segment, status: 'pending' })), requests: [], error: null,
    };
    const values = [];
    const usage = {};
    const providers = new Set();
    const transcripts = [];
    let cost = 0;
    let costIncomplete = false;
    let estimatedParserFee = 0;
    let retries = 0;
    let lastRaw = null;
    let error = segments.length ? null : 'No source segments to analyze';
    for (let index = 0; index < segments.length; index++) {
        const segment = segments[index];
        if (context.beforeRequest && !context.beforeRequest()) { error = 'Stopped before all source segments were analyzed'; break; }
        let bytes;
        if (isPdf) {
            try {
                const part = await PDFDocument.create();
                const [page] = await part.copyPages(pdf, [index]);
                part.addPage(page);
                bytes = Buffer.from(await part.save({ updateFieldAppearances: false }));
            } catch (failure) {
                metadata.segments[index].status = 'failed';
                error = `Could not prepare page ${index + 1}: ${failure.message}`;
                break;
            }
        }
        let raw;
        try {
            raw = isPdf ? await requestPdf(bytes, segment) : await requestText(segment.text, segment);
        } catch (failure) {
            raw = { ...failure.rawResult, error: failure.rawResult?.error || String(failure.message || failure), cost: failure.rawResult?.cost ?? null, status: failure.rawResult?.status ?? null };
        }
        lastRaw = raw;
        const rejected = raw.requestRejection === 'pdf-parser-size-limit';
        if (Number.isFinite(raw.cost)) cost += raw.cost;
        else if (!rejected) costIncomplete = true;
        if (raw.costIncomplete) costIncomplete = true;
        const fee = raw.estimatedParserFee ?? (isPdf && engine === 'mistral-ocr' && !rejected && !Number.isFinite(raw.cost)
            ? mistralOcrCost(segment.pageNumbers.length, context.mistralPageRate || 2) : 0);
        estimatedParserFee += fee;
        addUsage(usage, raw.usage);
        retries += raw.retries || 0;
        if (raw.provider) providers.add(raw.provider);
        const request = {
            segmentId: segment.id, pageNumbers: segment.pageNumbers, startIndex: segment.startIndex, endIndex: segment.endIndex,
            status: raw.status ?? null, cost: Number.isFinite(raw.cost) ? raw.cost : null,
            latencyMs: raw.latencyMs ?? null, finishReason: raw.finish_reason ?? null,
            error: raw.error || null, diagnostics: raw.diagnostics ?? null,
            parserRecovery: raw.parserRecovery ?? null, analysisSegmentation: raw.analysisSegmentation ?? null,
        };
        metadata.requests.push(request);
        const keepGoing = raw.costAccounted
            ? context.beforeRequest ? context.beforeRequest() : true
            : context.recordRequest ? context.recordRequest(raw, fee) : true;
        try {
            const value = parseResult(raw);
            values.push({ segment, value });
            metadata.segments[index].status = 'completed';
            if (isPdf && engine !== 'native') {
                const text = raw.parserText || extractParsedFileText(raw.response);
                if (text) transcripts.push(`=== STRANICA ${segment.pageNumbers[0]} ===\n${text}`);
            }
        } catch (failure) {
            metadata.segments[index].status = 'failed';
            request.error = String(failure.message || failure);
            error = `Segment ${segment.id}: ${request.error}`;
            break;
        }
        if ((!keepGoing || costIncomplete) && index < segments.length - 1) {
            error = costIncomplete ? 'Request cost is unknown; remaining segments were not requested' : 'Cost guard stopped analysis before all source segments completed';
            break;
        }
    }
    let response = null;
    if (!error && values.length === segments.length) {
        const { gaps, assignmentCueGaps, ...merged } = mergeAnalysisChunkResults(values, isPdf ? '' : String(sourceText || ''));
        metadata.status = 'completed';
        response = { choices: [{ message: { content: JSON.stringify(merged) } }] };
    }
    metadata.error = error;
    const parserText = transcripts.join('\n\n');
    return {
        response, error, cost, costIncomplete, usage: Object.keys(usage).length ? usage : null,
        latencyMs: performance.now() - started, retries, provider: [...providers].join(', ') || null,
        finish_reason: lastRaw?.finish_reason ?? null, status: lastRaw?.status ?? null, diagnostics: lastRaw?.diagnostics ?? null,
        analysisSegmentation: metadata, parserText, groundingText: isPdf ? parserText : String(sourceText || ''),
        estimatedParserFee, costAccounted: true,
    };
}

module.exports = { shouldBoundAnalysis, runBoundedAnalysis, CHUNK_SIZE, CHUNK_OVERLAP };
