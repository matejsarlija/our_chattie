'use strict';

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { extractTextFromFile, extractTextViaOCR, renderPageToJpeg, buildOcrBatchInstruction, buildAnalysisPrompt } = require('../../court-analysis/agents/analysis-agent');
const { buildPdfMessage, buildImageMessage, requestChat, extractAssistantText, extractParsedFileText, ANALYSIS_MAX_TOKENS } = require('./openrouter-client');
const { jsonValidity, scoreJsonConditions, scoreJsonRequestConditions } = require('./metrics');
function buildNativePdfTranscriptInstruction(pageCount) {
    return [
        'Transcribe this Croatian court PDF faithfully, page by page.',
        'Preserve amounts, dates, identifiers, OIBs, tables, and visible headings exactly as written.',
        `For every page from 1 through ${pageCount}, begin with a line exactly '=== STRANICA N ===' using that PDF page number.`,
        'Put the text from that page below its marker. Return no commentary, summary, or interpretation.',
    ].join(' ');
}
const { createUsageTracker } = require('../../llm/usage');
const { shouldBoundAnalysis, runBoundedAnalysis, checkpointKey, DEFAULT_CHECKPOINT_DIR, persistRawRequest } = require('./bounded-analysis');

const ARMS = [
    { id: 'local-text', requires: 'nothing', stage: 'T' },
    { id: 'local-raster', requires: 'imageInput', stage: 'T' },
    { id: 'or-cloudflare', requires: 'nothing', stage: 'T' },
    { id: 'or-mistral-ocr', requires: 'nothing', stage: 'T' },
    { id: 'or-native-transcribe', requires: 'fileNative', stage: 'T' },
];

// Stage A consumes only the frozen canonical transcript produced by Stage T.
const ANALYSIS_ARMS = [
    { id: 'local-text', requires: 'nothing', stage: 'A', kind: 'text', engine: null },
];

const DEFAULT_KNOWN_PARTIES = 'Participant information was not available from the source page.';

// Every Stage A model receives the same frozen canonical text.
function analysisArmsForModel() {
    return ANALYSIS_ARMS;
}

function capabilityAvailable(capabilities, requirement) {
    if (requirement === 'nothing') return true;
    return capabilities?.[requirement] === true;
}

function buildArmMatrix(models, arms = ARMS, capabilitiesByModel = {}) {
    const matrix = [];
    for (const model of models) {
        for (const arm of arms) {
            const capabilities = capabilitiesByModel[model] || {};
            if (!capabilityAvailable(capabilities, arm.requires)) {
                matrix.push({ model, arm: arm.id, stage: arm.stage || 'T', status: 'SKIPPED', reason: `skipped:unsupported-capability (${arm.requires} is ${capabilities[arm.requires] === false ? 'false' : 'unknown'})` });
            } else {
                matrix.push({ model, arm: arm.id, stage: arm.stage || 'T', status: 'READY' });
            }
        }
    }
    return matrix;
}

function resolveFixturePath(filePath, fixtureRoot) {
    if (path.isAbsolute(filePath) && fs.existsSync(filePath)) return filePath;
    const candidates = [path.resolve(filePath), path.resolve(fixtureRoot, filePath)];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

async function renderPdfPages(filePath, maxPages = Infinity) {
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)) }).promise;
    const count = Math.min(pdf.numPages, maxPages);
    const images = [];
    for (let pageNo = 1; pageNo <= count; pageNo += 1) {
        images.push(await renderPageToJpeg(await pdf.getPage(pageNo)));
    }
    await pdf.destroy();
    return { images, totalPages: count };
}

async function renderPdfPage(filePath, pageNumber) {
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)) }).promise;
    try {
        if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > pdf.numPages) {
            throw new Error(`Page ${pageNumber} is outside 1–${pdf.numPages}`);
        }
        return await renderPageToJpeg(await pdf.getPage(pageNumber));
    } finally {
        await pdf.destroy();
    }
}

// The OCR instruction tells the model to open each page with
// `=== STRANICA N ===`, but this arm sends ONE image per request — so the
// model's own header can only ever say "1", and wrapping the reply in our own
// header produced duplicate markers ([1,1,2,1] on a two-page document). That
// made any page-completeness count measure the wrapper, not the parse. Strip
// the header the model was asked to write, then stamp the real page position
// exactly once.
const PAGE_MARKER = /===\s*STRANICA\s+\d+\s*===/giu;

function pageBody(text) {
    return String(text || '')
        .replace(PAGE_MARKER, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function addUsage(total, usage) {
    for (const [key, value] of Object.entries(usage || {})) {
        if (Number.isFinite(value)) total[key] = (total[key] || 0) + value;
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!total[key]) total[key] = {};
            addUsage(total[key], value);
        }
    }
}

function makeArmRegistry() {
    return {
        'local-text': async (_model, doc) => {
            const extraction = await extractTextFromFile(doc.filePath);
            return { text: extraction.text || '', usage: null, cost: 0, latency: extraction.elapsedMs || null, provider: 'local-pdfjs', errors: extraction.error ? [extraction.error] : [], pages: extraction.pages, pageRanges: extraction.pageRanges || [] };
        },
        'local-raster': async (model, doc, context) => {
            const { images, totalPages } = await renderPdfPages(doc.filePath, context.maxPages);
            const outputs = [];
            const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            let hasUsage = false;
            let cost = 0;
            let hasCost = false;
            let retries = 0;
            let costIncomplete = false;
            const providers = new Set();
            const errors = [];
            const started = Date.now();
            for (let index = 0; index < images.length; index += 1) {
                const result = await requestChat(buildImageMessage({
                    model,
                    prompt: buildOcrBatchInstruction(),
                    imageDataUrl: `data:image/jpeg;base64,${images[index].toString('base64')}`,
                    maxTokens: context.transcriptionMaxTokens || 2048,
                    provider: context.provider,
                    reasoning: context.reasoning,
                }), { ...context.requestOptions, capabilities: context.capabilitiesByModel?.[model], label: `${context.label || model} · page ${index + 1}/${images.length}` });
                if (result.error) errors.push(result.error);
                else {
                    const body = pageBody(extractAssistantText(result.response));
                    // An empty page stays empty: no marker is invented for it, so
                    // a coverage check sees a short document rather than a full one.
                    if (body) outputs.push(`=== STRANICA ${index + 1} ===\n${body}`);
                    else errors.push(`Page ${index + 1}: empty OCR transcription`);
                }
                if (result.provider) providers.add(result.provider);
                if (result.usage) {
                    hasUsage = true;
                    for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) usage[key] += Number(result.usage[key] || 0);
                }
                if (Number.isFinite(result.cost)) { cost += result.cost; hasCost = true; }
                else costIncomplete = true;
                retries += result.retries || 0;
                const keepGoing = context.recordRequest ? context.recordRequest(result, 0) : true;
                if (!keepGoing) {
                    costIncomplete = true;
                    errors.push('Raster transcription stopped before all pages were complete.');
                }
                if (!Number.isFinite(result.cost) || !keepGoing) break;
            }
            if (!outputs.length && !errors.length) errors.push('Raster produced no usable transcription');
            return { text: outputs.join('\n\n'), usage: hasUsage ? usage : null, cost: hasCost ? cost : null, costIncomplete: costIncomplete || !hasCost, costAccounted: Boolean(context.recordRequest), latency: Date.now() - started, retries, provider: [...providers], errors, pages: totalPages };
        },
        'or-cloudflare': async (model, doc, context) => parseEngine('cloudflare-ai', model, doc, context),
        'or-mistral-ocr': async (model, doc, context) => parseEngine('mistral-ocr', model, doc, context),
        'or-native-transcribe': async (model, doc, context) => {
            const bytes = fs.readFileSync(doc.filePath);
            const result = await requestChat(buildPdfMessage({
                model,
                filename: path.basename(doc.filePath),
                bytes,
                prompt: buildNativePdfTranscriptInstruction(doc.pages),
                engine: 'native',
                maxTokens: context.transcriptionMaxTokens || 4096,
                provider: context.provider,
                reasoning: context.reasoning,
            }), { ...context.requestOptions, capabilities: context.capabilitiesByModel?.[model], label: context.label || model });
            return { text: result.error ? '' : extractAssistantText(result.response), usage: result.usage, cost: result.cost, latency: result.latencyMs, retries: result.retries, provider: result.provider, errors: result.error ? [result.error] : [], pages: doc.pages };
        },
    };
}

function referenceArm() {
    return async (_model, doc) => {
        const tracker = createUsageTracker();
        const started = Date.now();
        const result = await extractTextViaOCR(doc.filePath, null, { tracker });
        return { text: result.text || '', usage: tracker.snapshot(), cost: null, latency: Date.now() - started, provider: 'Google Gemini (reference)', errors: result.error ? [result.error] : [], pages: result.pages, modelRelevantToTranscript: false };
    };
}

async function parseEngine(engine, model, doc, context) {
    const result = await requestChat(buildPdfMessage({
        model,
        filename: path.basename(doc.filePath),
        bytes: fs.readFileSync(doc.filePath),
        prompt: 'Process this PDF and return OK.',
        engine,
        maxTokens: 2,
        provider: context.provider,
        reasoning: context.reasoning,
    }), { ...context.requestOptions, capabilities: context.capabilitiesByModel?.[model], label: context.label || model });
    const text = extractParsedFileText(result.response || { error: result.error });
    const errors = result.error ? [result.error] : !text ? ['No parsed file annotations returned'] : [];
    // OpenRouter reports `usage.cost` as the total charged to the account, which
    // already includes the file-parser page fee. Keep the page estimate as a
    // separate cross-check instead of adding it a second time.
    const parserFeeEstimateUsd = engine === 'mistral-ocr' ? context.mistralPageRate * (doc.pages || 0) / 1000 : 0;
    const reportedCost = Number.isFinite(result.cost) ? result.cost : null;
    return {
        text, usage: result.usage,
        cost: reportedCost,
        estimatedParserFee: reportedCost == null ? parserFeeEstimateUsd : 0,
        costBasis: reportedCost == null ? 'estimated-parser-fee' : 'reported-total',
        costIncomplete: reportedCost == null,
        parserFeeEstimateUsd,
        latency: result.latencyMs, retries: result.retries, provider: result.provider, errors, pages: doc.pages, modelRelevantToTranscript: false,
    };
}

function stripCodeFence(text) {
    return String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

// Shared post-processing for every analysis arm so Cloudflare, Mistral, native
// and the local text control are scored by exactly the same rules.
function finalizeAnalysisResult({ result, doc, groundingText = '', parserText = '', parserFeeEstimateUsd = 0, structuredMode = false }) {
    const text = result.error ? '' : extractAssistantText(result.response);
    let parsed = null;
    try { parsed = JSON.parse(stripCodeFence(text)); } catch { /* invalid JSON or truncation */ }
    const reportedCost = Number.isFinite(result.cost) ? result.cost : null;
    const requests = result.analysisSegmentation?.requests || [];
    const jsonConditions = result.jsonConditions || (requests.length
        ? scoreJsonRequestConditions(requests, { structuredMode })
        : scoreJsonConditions(result.rawText ?? text, { structuredMode }));
    return {
        text,
        parsed,
        parserText,
        json: result.error ? { valid: false, truncated: result.finish_reason === 'length' } : jsonValidity(text),
        jsonConditions,
        repairOverhead: result.repairOverhead || {
            latencyMs: jsonConditions.repairOverheadMs,
            cost: jsonConditions.repairOverheadCost,
        },
        conditionResults: result.conditionResults ?? null,
        groundingText,
        usage: result.usage,
        cost: reportedCost,
        estimatedParserFee: result.estimatedParserFee ?? (reportedCost == null ? parserFeeEstimateUsd : 0),
        costBasis: result.costIncomplete === true ? 'reported-partial' : reportedCost == null ? 'estimated-parser-fee' : 'reported-total',
        costIncomplete: result.costIncomplete === true || reportedCost == null,
        parserFeeEstimateUsd,
        latency: result.latencyMs,
        provider: result.provider,
        retries: result.retries,
        finishReason: result.finish_reason ?? null,
        requestRejection: result.requestRejection ?? null,
        httpStatus: result.status ?? null,
        diagnostics: result.diagnostics ?? null,
        analysisSegmentation: result.analysisSegmentation ?? null,
        structuredAnalysisSegmentation: result.structuredAnalysisSegmentation ?? null,
        requestMetadata: result.requestMetadata ?? null,
        costAccounted: result.costAccounted === true,
        errors: result.error ? [result.error] : parsed ? [] : ['Invalid JSON or truncation'],
        failedCall: Boolean(result.error),
        pages: doc.pages || null,
    };
}

function addUsageTotals(target, usage) {
    for (const [key, value] of Object.entries(usage || {})) {
        if (Number.isFinite(value)) target[key] = (target[key] || 0) + value;
        else if (value && typeof value === 'object' && !Array.isArray(value)) {
            if (!target[key]) target[key] = {};
            addUsageTotals(target[key], value);
        }
    }
}

async function runSingleCondition({ model, sourceText, doc, context, promptHash, requestParameters, requestText, condition }) {
    let result;
    try {
        result = await requestText(sourceText);
    } catch (failure) {
        result = {
            ...failure.rawResult,
            error: failure.rawResult?.error || String(failure.message || failure),
            cost: failure.rawResult?.cost ?? null,
            status: failure.rawResult?.status ?? null,
        };
    }
    const rawText = extractAssistantText(result.response);
    const segment = {
        id: `${doc.docId || 'document'}:1`,
        text: sourceText,
        startIndex: 0,
        endIndex: sourceText.length,
        pageNumbers: [],
    };
    const key = checkpointKey(segment, model, promptHash, requestParameters);
    const request = {
        segmentId: segment.id,
        startIndex: segment.startIndex,
        endIndex: segment.endIndex,
        pageNumbers: segment.pageNumbers,
        condition,
        status: 'received',
        httpStatus: result.status ?? null,
        cost: Number.isFinite(result.cost) ? result.cost : null,
        latencyMs: result.latencyMs ?? null,
        finishReason: result.finish_reason ?? null,
        rawText,
        parseDiagnostics: null,
        diagnostics: result.diagnostics ?? null,
        rawPersistedBeforeParse: false,
    };
    let rawArtifactPath = null;
    request.rawPersistedBeforeParse = true;
    try {
        rawArtifactPath = persistRawRequest(context.checkpointDir || DEFAULT_CHECKPOINT_DIR, key, request);
    } catch (failure) {
        request.rawPersistedBeforeParse = false;
        request.rawPersistenceError = String(failure.message || failure);
    }
    const requestMetadata = {
        mode: 'single',
        status: 'in-progress',
        segments: [{ id: segment.id, startIndex: segment.startIndex, endIndex: segment.endIndex, pageNumbers: [], status: 'pending' }],
        requests: [request],
    };
    context.onRequestProgress?.(requestMetadata, condition);
    const shouldContinue = result.costAccounted
        ? context.beforeRequest ? context.beforeRequest() : true
        : context.recordRequest ? context.recordRequest(result, 0) : true;
    if (!request.rawPersistedBeforeParse) {
        request.status = 'failed';
        request.error = `Unable to persist raw response before parsing: ${request.rawPersistenceError}`;
        request.parseDiagnostics = { name: 'RawPersistenceError', message: request.error };
        requestMetadata.segments[0].status = 'failed';
        requestMetadata.status = 'failed';
        context.onRequestProgress?.(requestMetadata, condition);
        return {
            ...result,
            error: request.error,
            rawText,
            requestMetadata,
            shouldContinue: false,
            costAccounted: result.costAccounted === true || Boolean(context.recordRequest),
        };
    }
    try {
        if (result.error) throw new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error));
        if (result.finish_reason === 'length') throw new Error('Output was truncated (finish reason: length)');
        JSON.parse(stripCodeFence(rawText));
        request.status = 'completed';
    } catch (failure) {
        request.status = 'failed';
        request.error = String(failure.message || failure);
        request.parseDiagnostics = { name: failure.name || 'Error', message: request.error };
    }
    try {
        persistRawRequest(context.checkpointDir || DEFAULT_CHECKPOINT_DIR, key, request, rawArtifactPath);
    } catch (failure) {
        request.rawPersistenceError = String(failure.message || failure);
    }
    requestMetadata.segments[0].status = request.status;
    requestMetadata.status = request.status === 'completed' ? 'completed' : 'failed';
    context.onRequestProgress?.(requestMetadata, condition);
    return {
        ...result,
        rawText,
        requestMetadata,
        shouldContinue,
        costAccounted: result.costAccounted === true || Boolean(context.recordRequest),
    };
}

async function analyzeTextResult(model, sourceText, doc, context, pageRanges = []) {
    const knownParties = context.knownParties || DEFAULT_KNOWN_PARTIES;
    const promptHash = crypto.createHash('sha256').update(buildAnalysisPrompt(knownParties, '')).digest('hex');
    const baseParameters = {
        max_tokens: context.analysisMaxTokens || ANALYSIS_MAX_TOKENS,
        ...(context.provider ? { provider: context.provider } : {}),
        ...(context.reasoning ? { reasoning: context.reasoning } : {}),
    };
    const makeRequestText = (requestParameters) => (text, segment = null) => {
        const chat = context.requestChat || requestChat;
        return chat({
            model,
            messages: [{ role: 'user', content: buildAnalysisPrompt(knownParties, text) }],
            stream: false,
            ...requestParameters,
        }, {
            ...context.requestOptions, capabilities: context.capabilitiesByModel?.[model],
            label: `${context.label || model}${segment ? ` · chars ${segment.startIndex}-${segment.endIndex}${segment.pageNumbers.length ? ` · pages ${segment.pageNumbers.join(',')}` : ''}` : ''}`,
        });
    };
    const runCondition = async (condition, responseFormat = null) => {
        const requestParameters = {
            ...baseParameters,
            ...(responseFormat ? { response_format: responseFormat } : {}),
        };
        const requestText = makeRequestText(requestParameters);
        if (!shouldBoundAnalysis(doc, context, sourceText)) {
            return runSingleCondition({
                model, sourceText, doc, context, promptHash, requestParameters, requestText, condition,
            });
        }
        return runBoundedAnalysis({
            model,
            doc,
            context: {
                ...context,
                promptHash,
                checkpointOptions: requestParameters,
                analysisCondition: condition,
            },
            sourceText,
            pageRanges,
            requestText,
        });
    };

    const onlyStructuredMode = context.analysisConditionOnly === 'structured_mode';
    const rawResult = onlyStructuredMode
        ? { notRequested: true, rawText: '', cost: 0, latencyMs: 0, usage: null, costAccounted: true }
        : await runCondition('raw_parse');
    let structuredResult = null;
    if (onlyStructuredMode) {
        structuredResult = await runCondition('structured_mode', { type: 'json_object' });
    } else if (!rawResult.shouldContinue && rawResult.shouldContinue !== undefined) {
        structuredResult = null;
    } else if (context.beforeRequest && !context.beforeRequest()) {
        structuredResult = null;
    } else {
        structuredResult = await runCondition('structured_mode', { type: 'json_object' });
    }
    const rawRequests = rawResult.analysisSegmentation?.requests || rawResult.requestMetadata?.requests || [];
    const structuredRequests = structuredResult?.analysisSegmentation?.requests || structuredResult?.requestMetadata?.requests || [];
    const rawPersistenceFailed = rawRequests.some((request) => request.rawPersistedBeforeParse === false);
    const structuredPersistenceFailed = structuredRequests.some((request) => request.rawPersistedBeforeParse === false);
    const unpersistedScore = {
        raw_parse: false,
        structured_mode: false,
        repaired: false,
        rawFailed: true,
        repairOverheadMs: 0,
        repairOverheadCost: 0,
    };
    const rawScores = rawResult.notRequested ? null : rawPersistenceFailed
        ? unpersistedScore
        : rawRequests.length
            ? scoreJsonRequestConditions(rawRequests)
            : scoreJsonConditions(rawResult.rawText || '');
    const structuredScores = structuredResult
        ? structuredPersistenceFailed
            ? unpersistedScore
            : structuredRequests.length
                ? scoreJsonRequestConditions(structuredRequests)
                : scoreJsonConditions(structuredResult.rawText || '')
        : null;
    const selectedScores = onlyStructuredMode ? structuredScores : rawScores;
    const rawUsable = Boolean(rawScores && (rawScores.raw_parse || rawScores.repaired));
    const structuredUsable = Boolean(structuredScores && (structuredScores.raw_parse || structuredScores.repaired));
    const responseResult = (onlyStructuredMode || (!rawUsable && structuredUsable))
        ? structuredResult
        : rawResult;
    const rawCostKnown = rawResult.notRequested || Number.isFinite(rawResult.cost);
    const structuredCostKnown = !structuredResult || Number.isFinite(structuredResult.cost);
    const knownCost = (!rawResult.notRequested && rawCostKnown ? rawResult.cost : 0)
        + (structuredResult && structuredCostKnown ? structuredResult.cost : 0);
    const usage = {};
    if (!rawResult.notRequested) addUsageTotals(usage, rawResult.usage);
    if (structuredResult) addUsageTotals(usage, structuredResult.usage);
    const providers = [...new Set([rawResult.provider, structuredResult?.provider].filter(Boolean))];
    const conditionResults = {
        raw_parse: {
            requested: !rawResult.notRequested,
            passed: rawScores ? rawScores.raw_parse : null,
            cost: rawResult.notRequested ? null : rawResult.cost ?? null,
            latencyMs: rawResult.notRequested ? null : rawResult.latencyMs ?? null,
            requests: rawRequests,
        },
        structured_mode: {
            requested: Boolean(structuredResult),
            passed: structuredScores ? structuredScores.raw_parse : null,
            cost: structuredResult?.cost ?? null,
            latencyMs: structuredResult?.latencyMs ?? null,
            requests: structuredRequests,
        },
        repaired: {
            rawFailed: selectedScores.rawFailed,
            passed: selectedScores.repaired,
            latencyMs: selectedScores.repairOverheadMs,
            cost: selectedScores.repairOverheadCost,
        },
    };
    return {
        ...responseResult,
        rawText: responseResult.rawText || null,
        cost: rawCostKnown && structuredCostKnown ? knownCost : knownCost || null,
        costIncomplete: Boolean((!rawResult.notRequested && rawResult.costIncomplete) || structuredResult?.costIncomplete || !rawCostKnown || !structuredCostKnown),
        usage: Object.keys(usage).length ? usage : null,
        latencyMs: (rawResult.notRequested ? 0 : rawResult.latencyMs || 0) + (structuredResult?.latencyMs || 0),
        retries: (rawResult.notRequested ? 0 : rawResult.retries || 0) + (structuredResult?.retries || 0),
        provider: providers.join(', ') || null,
        costAccounted: Boolean(context.recordRequest) || Boolean((rawResult.notRequested || rawResult.costAccounted) && structuredResult?.costAccounted),
        structuredAnalysisSegmentation: structuredResult?.analysisSegmentation ?? null,
        conditionResults,
        jsonConditions: {
            raw_parse: rawScores ? rawScores.raw_parse : null,
            structured_mode: structuredResult ? structuredScores.raw_parse : null,
            repaired: selectedScores.repaired,
            rawFailed: selectedScores.rawFailed,
            repairOverheadMs: selectedScores.repairOverheadMs,
            repairOverheadCost: selectedScores.repairOverheadCost,
        },
        repairOverhead: {
            latencyMs: selectedScores.repairOverheadMs,
            cost: selectedScores.repairOverheadCost,
        },
        structuredMode: Boolean(structuredResult),
    };
}

// Stage A analyzes canonical text for every model. Stage T freezes source text
// separately; a missing digital text layer must not trigger a PDF fallback.
async function runTextAnalysis(model, doc, context) {
    const extraction = doc.benchExtraction || await extractTextFromFile(doc.filePath);
    const sourceText = String(extraction.text || '');
    if (!sourceText.trim()) {
        return {
            skipped: 'no-text-layer', text: '', parserText: '', groundingText: '',
            errors: [], cost: 0, costIncomplete: false, latency: extraction.elapsedMs || null,
            provider: 'local-pdfjs', usage: null, pages: extraction.pages,
        };
    }
    const result = await analyzeTextResult(model, sourceText, doc, context, extraction.pageRanges || []);
    return finalizeAnalysisResult({ result, doc, groundingText: sourceText, structuredMode: result.structuredMode });
}

function makeAnalysisRegistry() {
    return {
        'local-text': (model, doc, context) => runTextAnalysis(model, doc, context),
    };
}

function buildArmDefinitions() {
    const registry = makeArmRegistry();
    return ARMS.map((arm) => ({ ...arm, run: registry[arm.id] }));
}

module.exports = {
    ARMS, ANALYSIS_ARMS, capabilityAvailable, buildArmMatrix, resolveFixturePath,
    renderPdfPages, renderPdfPage, makeArmRegistry, buildArmDefinitions, referenceArm, parseEngine, pageBody,
    analysisArmsForModel, makeAnalysisRegistry, runTextAnalysis,
};
