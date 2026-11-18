'use strict';

const { PDFDocument } = require('pdf-lib');
const { extractParsedFileText, mistralOcrCost } = require('./openrouter-client');
const { performance } = require('node:perf_hooks');

function isSizeRejection(raw) { return raw?.requestRejection === 'pdf-parser-size-limit'; }
function requestError(raw) { return raw?.error || raw?.response?.error || raw?.response?.choices?.[0]?.error || null; }
function numeric(value) { return Number.isFinite(value) ? value : 0; }
function addUsage(target, usage) {
    if (!usage || typeof usage !== 'object') return;
    for (const [key, value] of Object.entries(usage)) {
        if (typeof value === 'number' && Number.isFinite(value)) target[key] = (target[key] || 0) + value;
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!target[key] || typeof target[key] !== 'object') target[key] = {};
            addUsage(target[key], value);
        }
    }
}

async function recoverPdfAnalysis({ engine, model, doc, context = {}, originalBytes, requestPdf, requestAnalysis }) {
    if (!Buffer.isBuffer(originalBytes)) throw new TypeError('originalBytes must be a Buffer');
    if (typeof requestPdf !== 'function' || typeof requestAnalysis !== 'function') throw new TypeError('requestPdf and requestAnalysis are required');
    const originalSize = originalBytes.length;
    const started = performance.now();
    const recovery = { mode: 'failed', status: 'failed', originalBytes: originalSize, rewrittenBytes: null, requests: [], chunks: [], error: null };
    const usage = {};
    let knownCost = 0;
    let costIncomplete = false;
    let estimatedParserFee = 0;
    let retries = 0;
    let provider = null;
    let finishReason = null;
    let stopped = false;
    let lastRaw = null;
    const mistralRate = Number.isFinite(context.mistralPageRate) ? context.mistralPageRate : 2;
    const result = (raw = lastRaw) => ({
        response: null,
        usage: Object.keys(usage).length ? usage : null, cost: knownCost,
        costIncomplete, latencyMs: performance.now() - started, retries, provider,
        finish_reason: finishReason, error: recovery.error,
        requestRejection: null, status: raw?.status ?? null, diagnostics: raw?.diagnostics ?? null,
        analysisSegmentation: raw?.analysisSegmentation ?? null,
    });
    const fail = (message, raw = lastRaw) => {
        recovery.status = 'failed';
        recovery.error = message;
        return { result: result(raw), parserText: '', recovery, estimatedParserFee, costAccounted: true };
    };
    const issue = async (bytes, phase, firstPage = null, lastPage = null, transcribe = false) => {
        if (stopped) return { stopped: true };
        if (context.beforeRequest && context.beforeRequest() === false) { stopped = true; return { stopped: true }; }
        const raw = await requestPdf(bytes, { phase, firstPage, lastPage, transcribe });
        lastRaw = raw || {};
        const rejection = isSizeRejection(raw);
        const err = requestError(raw);
        const accepted = !rejection && !err;
        const estimated = engine === 'mistral-ocr' && !rejection && !Number.isFinite(raw?.cost)
            ? mistralOcrCost(lastPage == null ? (doc.pages || 0) : lastPage - firstPage + 1, mistralRate) : 0;
        estimatedParserFee += estimated;
        const cost = rejection ? 0 : Number.isFinite(raw?.cost) ? raw.cost : null;
        recovery.requests.push({ phase, firstPage, lastPage, bytes: bytes.length, status: raw?.status ?? raw?.httpStatus ?? null, cost: Number.isFinite(raw?.cost) ? raw.cost : null, latencyMs: raw?.latencyMs ?? raw?.latency ?? null, error: err, requestRejection: raw?.requestRejection ?? null });
        if (cost !== null) knownCost += cost;
        else costIncomplete = true;
        addUsage(usage, raw?.usage);
        // Monotonic cell latency includes local PDF processing, not just requests.
        retries += numeric(raw?.retries);
        provider = raw?.provider ?? provider;
        finishReason = raw?.finish_reason ?? raw?.finishReason ?? finishReason;
        const keepGoing = context.recordRequest ? context.recordRequest(raw, estimated) : true;
        if (cost === null && !rejection) stopped = true;
        if (keepGoing === false) stopped = true;
        return { raw, rejection, err, accepted, stopped };
    };
    const analysis = async (transcript) => {
        if (stopped) return null;
        if (context.beforeRequest && context.beforeRequest() === false) { stopped = true; return null; }
        const raw = await requestAnalysis(transcript);
        lastRaw = raw || {};
        const err = requestError(raw);
        recovery.requests.push({ phase: 'analysis', firstPage: null, lastPage: null, bytes: null, status: raw?.status ?? raw?.httpStatus ?? null, cost: Number.isFinite(raw?.cost) ? raw.cost : null, latencyMs: raw?.latencyMs ?? raw?.latency ?? null, error: err, requestRejection: raw?.requestRejection ?? null });
        if (Number.isFinite(raw?.cost)) knownCost += raw.cost; else costIncomplete = true;
        if (raw.costIncomplete) costIncomplete = true;
        estimatedParserFee += raw.estimatedParserFee || 0;
        addUsage(usage, raw?.usage); retries += numeric(raw?.retries);
        provider = raw?.provider ?? provider; finishReason = raw?.finish_reason ?? raw?.finishReason ?? finishReason;
        if (context.recordRequest && !raw.costAccounted) context.recordRequest(raw, 0);
        if (err) return null;
        return raw;
    };
    const finalSuccess = (raw, parserText, mode) => {
        recovery.mode = mode;
        recovery.status = 'completed';
        recovery.error = null;
        return {
            result: { ...result(raw), response: raw.response, error: null, analysisSegmentation: raw.analysisSegmentation ?? null },
            parserText, recovery, estimatedParserFee, costAccounted: true,
        };
    };
    try {
        let rewritten = null;
        let pdf;
        try {
            pdf = await PDFDocument.load(originalBytes, { ignoreEncryption: false, updateMetadata: false });
            rewritten = Buffer.from(await pdf.save({ updateFieldAppearances: false }));
        } catch (error) {
            return fail(`Could not losslessly rewrite PDF: ${error.message}`);
        }
        recovery.rewrittenBytes = rewritten.length;
        if (rewritten.length < originalSize) {
            recovery.mode = 'rewritten';
            const attempt = await issue(rewritten, 'rewrite', null, null, false);
            if (attempt.accepted) {
                const parserText = extractParsedFileText(attempt.raw?.response || {});
                if (!parserText.trim()) return fail('Rewritten PDF returned no parser annotations.', attempt.raw);
                return finalSuccess(attempt.raw, parserText, 'rewritten');
            }
            if (attempt.stopped) return fail('Recovery stopped before another request could be made.');
            if (!attempt.rejection) return fail('Rewritten PDF request failed.', attempt.raw);
        }
        recovery.mode = 'chunked';
        const pageCount = pdf.getPageCount();
        if (!pageCount) return fail('PDF has no pages to recover.');
        const chunks = [];
        let transcript = '';
        const parseRange = async (first, last) => {
            if (stopped) return false;
            const part = await PDFDocument.create();
            const copied = await part.copyPages(pdf, Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i));
            copied.forEach((page) => part.addPage(page));
            const bytes = Buffer.from(await part.save());
            const attempt = await issue(bytes, 'parse', first, last, true);
            if (attempt.stopped && !attempt.accepted) return false;
            if (attempt.rejection) {
                if (first === last) { recovery.error = `PDF parser size limit rejected page ${first}; page cannot be recovered without downsampling.`; return false; }
                const middle = Math.floor((first + last) / 2);
                return (await parseRange(first, middle)) && (await parseRange(middle + 1, last));
            }
            if (!attempt.accepted) { recovery.error = `Parser request failed for pages ${first}-${last}.`; return false; }
            const extracted = extractParsedFileText(attempt.raw?.response || {});
            if (!extracted.trim()) { recovery.error = `Parser returned no annotations for pages ${first}-${last}.`; return false; }
            chunks.push({ firstPage: first, lastPage: last, bytes: bytes.length });
            recovery.chunks = chunks.slice();
            transcript += `${transcript ? '\n' : ''}[Original pages ${first}-${last}]\n${extracted}`;
            return !attempt.stopped;
        };
        const middle = Math.floor(pageCount / 2);
        const complete = pageCount === 1
            ? await parseRange(1, 1)
            : (await parseRange(1, middle)) && (await parseRange(middle + 1, pageCount));
        if (!complete) return fail(recovery.error || 'Recovery stopped before parsing completed.');
        recovery.chunks = chunks;
        if (stopped) return fail('Recovery stopped before analysis.');
        const raw = await analysis(transcript);
        if (!raw) return fail(stopped ? 'Recovery stopped before analysis completed.' : 'Final analysis request failed.');
        return finalSuccess(raw, transcript, 'chunked');
    } catch (error) {
        return fail(`PDF recovery failed: ${error.message}`);
    }
}

module.exports = { recoverPdfAnalysis };
