'use strict';

const fs = require('fs');
const path = require('path');
const { extractTextFromFile, extractTextViaOCR, renderPageToJpeg, buildOcrBatchInstruction, buildAnalysisPrompt } = require('../../court-analysis/agents/analysis-agent');
const { buildPdfMessage, buildImageMessage, requestChat, extractAssistantText, extractParsedFileText, ANALYSIS_MAX_TOKENS } = require('./openrouter-client');
const { jsonValidity } = require('./metrics');
const { buildNativePdfTranscriptInstruction } = require('../../helpers/nativePdfDocument');
const { createUsageTracker } = require('../../helpers/geminiUsage');
const { recoverPdfAnalysis } = require('./pdf-parser-recovery');
const { shouldBoundAnalysis, runBoundedAnalysis } = require('./bounded-analysis');

const ARMS = [
    { id: 'local-text', requires: 'nothing', stage: 'T' },
    { id: 'local-raster', requires: 'imageInput', stage: 'T' },
    { id: 'or-cloudflare', requires: 'nothing', stage: 'T' },
    { id: 'or-mistral-ocr', requires: 'nothing', stage: 'T' },
    { id: 'or-native-transcribe', requires: 'fileNative', stage: 'T' },
];

// The decision lane. Each arm is one production-shaped analysis request: the
// document goes in, the analysis JSON comes out of the same call. `local-text`
// stays text-only on purpose (pdf.js text + the same analysis prompt), because
// it is the free control on documents that already have a text layer.
// `local-raster` is the page-image path: production renders each page and
// transcribes it, so the bench does the same and then analyzes the transcript.
const ANALYSIS_ARMS = [
    { id: 'local-text', requires: 'nothing', stage: 'A', kind: 'text', engine: null },
    { id: 'local-raster', requires: 'imageInput', stage: 'A', kind: 'image', engine: null },
    { id: 'or-cloudflare', requires: 'nothing', stage: 'A', kind: 'pdf', engine: 'cloudflare-ai' },
    { id: 'or-mistral-ocr', requires: 'nothing', stage: 'A', kind: 'pdf', engine: 'mistral-ocr' },
    { id: 'or-native', requires: 'fileNative', stage: 'A', kind: 'pdf', engine: 'native' },
];

// `buildAnalysisPrompt` ends with "Text:\n\n<segment>". In the one-shot PDF path
// there is no segment to inline — the file parser injects the document into the
// same message — so only that trailing payload is swapped. The schema is not
// forked.
const PDF_ANALYSIS_PLACEHOLDER = 'Text: the attached PDF, as parsed by the pinned file-parser engine.';
const DEFAULT_KNOWN_PARTIES = 'Participant information was not available from the source page.';

function buildPdfAnalysisPrompt(knownParties) {
    return buildAnalysisPrompt(knownParties || DEFAULT_KNOWN_PARTIES, '').replace(/Text:\s*$/, PDF_ANALYSIS_PLACEHOLDER);
}

// Which arms a model is asked to run. The baseline model is the incumbent and
// only needs its production-shaped arm; the challenger runs every input path.
function analysisArmsForModel(model, { baselineModel = null, baselineArm = 'or-native' } = {}) {
    if (baselineModel && model === baselineModel) return ANALYSIS_ARMS.filter((arm) => arm.id === baselineArm);
    if (!baselineModel) return ANALYSIS_ARMS;
    return ANALYSIS_ARMS.filter((arm) => arm.id !== baselineArm);
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
            return { text: extraction.text || '', usage: null, cost: 0, latency: extraction.elapsedMs || null, provider: 'local-pdfjs', errors: extraction.error ? [extraction.error] : [], pages: extraction.pages };
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
            }
            if (!outputs.length && !errors.length) errors.push('Raster produced no usable transcription');
            return { text: outputs.join('\n\n'), usage: hasUsage ? usage : null, cost: hasCost ? cost : null, costIncomplete: costIncomplete || !hasCost, latency: Date.now() - started, retries, provider: [...providers], errors, pages: totalPages };
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
function finalizeAnalysisResult({ result, doc, groundingText = '', parserText = '', parserFeeEstimateUsd = 0 }) {
    const text = result.error ? '' : extractAssistantText(result.response);
    let parsed = null;
    try { parsed = JSON.parse(stripCodeFence(text)); } catch { /* invalid JSON or truncation */ }
    const reportedCost = Number.isFinite(result.cost) ? result.cost : null;
    return {
        text,
        parsed,
        parserText,
        json: result.error ? { valid: false, truncated: result.finish_reason === 'length' } : jsonValidity(text),
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
        costAccounted: result.costAccounted === true,
        errors: result.error ? [result.error] : parsed ? [] : ['Invalid JSON or truncation'],
        // `errors` carries a message for both a provider failure and a model
        // that answered with unusable JSON. Only the former means no answer.
        failedCall: Boolean(result.error),
        pages: doc.pages || null,
    };
}

async function analyzeTextResult(model, sourceText, doc, context, pageRanges = []) {
    const requestText = (text, segment = null) => requestChat({
        model,
        messages: [{ role: 'user', content: buildAnalysisPrompt(context.knownParties || DEFAULT_KNOWN_PARTIES, text) }],
        max_tokens: context.analysisMaxTokens || ANALYSIS_MAX_TOKENS,
        stream: false,
        ...(context.provider ? { provider: context.provider } : {}),
        ...(context.reasoning ? { reasoning: context.reasoning } : {}),
    }, {
        ...context.requestOptions, capabilities: context.capabilitiesByModel?.[model],
        label: `${context.label || model}${segment ? ` · chars ${segment.startIndex}-${segment.endIndex}${segment.pageNumbers.length ? ` · pages ${segment.pageNumbers.join(',')}` : ''}` : ''}`,
    });
    return shouldBoundAnalysis(doc, context, sourceText)
        ? runBoundedAnalysis({ model, doc, context, sourceText, pageRanges, requestText })
        : requestText(sourceText);
}

// Normal condition: PDF + analysis in one call. A confirmed parser-size
// rejection can recover without changing the parser or reducing image quality.
async function runPdfAnalysis(engine, model, doc, context) {
    const bytes = fs.readFileSync(doc.filePath);
    const requestPdf = (payload, { phase = 'original', firstPage = null, lastPage = null, transcribe = false } = {}) => requestChat(buildPdfMessage({
        model,
        filename: path.basename(doc.filePath),
        bytes: payload,
        prompt: transcribe ? 'Acknowledge receipt with OK. The file-parser annotations supply the document transcript.' : buildPdfAnalysisPrompt(context.knownParties),
        engine,
        maxTokens: transcribe ? 1 : context.analysisMaxTokens || ANALYSIS_MAX_TOKENS,
        provider: context.provider,
        reasoning: transcribe ? { enabled: false } : context.reasoning,
    }), {
        ...context.requestOptions, capabilities: context.capabilitiesByModel?.[model],
        label: `${context.label || model}${phase === 'original' ? '' : ` · ${phase}${firstPage ? ` pages ${firstPage}-${lastPage}` : ''}`}`,
    });
    const canRecover = (result) => engine !== 'native' && result.requestRejection === 'pdf-parser-size-limit' && context.parserRecovery !== 'off';
    const recoverRejected = async (payload, initial, sourcePages = null) => {
        const recoveryDoc = sourcePages ? { ...doc, pages: 1 } : doc;
        const recoveryContext = sourcePages ? { ...context, label: `${context.label || model} · recovery for original page ${sourcePages[0]}` } : context;
        const originalPageText = (text) => sourcePages
            ? text.replace(/^\[Original pages 1-1\]\n/, `[Original pages ${sourcePages[0]}-${sourcePages[0]}]\n`) : text;
        const recovered = await recoverPdfAnalysis({
            engine, model, doc: recoveryDoc, context: recoveryContext, originalBytes: payload,
            requestPdf: (bytes, options) => requestPdf(bytes, sourcePages
                ? { ...options, firstPage: sourcePages[0], lastPage: sourcePages[0] } : options),
            requestAnalysis: (transcript) => analyzeTextResult(model, originalPageText(transcript), recoveryDoc, recoveryContext),
        });
        recovered.recovery.requests.unshift({
            phase: 'original', firstPage: sourcePages?.[0] || 1, lastPage: sourcePages?.[0] || doc.pages || null, bytes: payload.length,
            status: initial.status ?? null, cost: initial.cost ?? null, latencyMs: initial.latencyMs ?? null,
            error: initial.error, requestRejection: initial.requestRejection,
        });
        if (sourcePages) {
            recovered.recovery.sourcePages = sourcePages;
            for (const request of recovered.recovery.requests) {
                if (request.firstPage != null) request.firstPage = sourcePages[0];
                if (request.lastPage != null) request.lastPage = sourcePages[0];
            }
            for (const chunk of recovered.recovery.chunks) {
                chunk.firstPage = sourcePages[0];
                chunk.lastPage = sourcePages[0];
            }
            if (recovered.result.error) {
                recovered.result.error = `Original PDF page ${sourcePages[0]} (recovery-local page 1): ${recovered.result.error}`;
                recovered.recovery.error = recovered.result.error;
            }
        }
        return {
            ...recovered.result, latencyMs: recovered.result.latencyMs + (initial.latencyMs || 0),
            parserText: originalPageText(recovered.parserText), parserRecovery: recovered.recovery,
            estimatedParserFee: recovered.estimatedParserFee, costAccounted: recovered.costAccounted,
        };
    };
    if ((doc.pages || 0) > 1 && shouldBoundAnalysis(doc, context)) {
        const segmented = await runBoundedAnalysis({
            model, doc, context, pdfBytes: bytes, engine,
            requestPdf: async (payload, segment) => {
                const initial = await requestPdf(payload, {
                    phase: 'bounded analysis', firstPage: segment.pageNumbers[0],
                    lastPage: segment.pageNumbers[segment.pageNumbers.length - 1],
                });
                return canRecover(initial) ? recoverRejected(payload, initial, segment.pageNumbers) : initial;
            },
        });
        return finalizeAnalysisResult({
            result: segmented, doc, parserText: segmented.parserText || '',
            groundingText: segmented.groundingText || '',
        });
    }
    const result = await requestPdf(bytes);
    if (canRecover(result)) {
        const recovered = await recoverRejected(bytes, result);
        return {
            ...finalizeAnalysisResult({
                result: recovered, doc, parserText: recovered.parserText,
                groundingText: recovered.parserText, parserFeeEstimateUsd: recovered.estimatedParserFee,
            }),
            parserRecovery: recovered.parserRecovery,
        };
    }
    const parserText = extractParsedFileText(result.response || {});
    const parserFeeEstimateUsd = engine === 'mistral-ocr' && result.requestRejection !== 'pdf-parser-size-limit'
        ? (context.mistralPageRate || 2) * (doc.pages || 0) / 1000 : 0;
    return finalizeAnalysisResult({ result, doc, groundingText: parserText, parserText, parserFeeEstimateUsd });
}

// Free control: pdf.js text into a text-only analysis call. An image-only
// document has no text layer, so the arm is skipped rather than scored on "".
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
    return finalizeAnalysisResult({ result, doc, groundingText: sourceText });
}

/**
 * Page-image analysis: render each page, transcribe it with the production OCR
 * instruction, then analyze the assembled transcript with the same analysis
 * prompt every other arm uses.
 *
 * Two things this deliberately does NOT do:
 *  - it does not re-emit the model's own `=== STRANICA N ===` header; the model
 *    only ever sees one image per request, so its header can only say 1.
 *    `pageBody` strips it and the wrapper stamps the real page position once.
 *  - it does not invent a page for a failed or empty transcription. A short
 *    transcript must stay short.
 */
async function runRasterAnalysis(model, doc, context) {
    const maxPages = Number(context.rasterMaxPages) > 0 ? Number(context.rasterMaxPages) : Infinity;
    const { images, totalPages } = await renderPdfPages(doc.filePath, maxPages);
    const sections = [];
    const usage = {};
    let hasUsage = false;
    let ocrCost = 0;
    let hasCost = false;
    let costIncomplete = false;
    let retries = 0;
    let latencyMs = 0;
    const providers = new Set();
    const errors = [];

    for (let index = 0; index < images.length; index += 1) {
        if (context.beforeRequest && !context.beforeRequest()) {
            errors.push('Raster stopped before all pages were transcribed.');
            break;
        }
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
            if (body) sections.push(`=== STRANICA ${index + 1} ===\n${body}`);
            else errors.push(`Page ${index + 1}: empty OCR transcription`);
        }
        if (result.provider) providers.add(result.provider);
        if (result.usage) {
            hasUsage = true;
            addUsage(usage, result.usage);
        }
        if (Number.isFinite(result.cost)) { ocrCost += result.cost; hasCost = true; }
        else costIncomplete = true;
        retries += result.retries || 0;
        latencyMs += result.latencyMs || 0;
        const keepGoing = context.recordRequest ? context.recordRequest(result, 0) : true;
        if (!Number.isFinite(result.cost) || !keepGoing) break;
    }

    const transcript = sections.join('\n\n');
    if (!transcript.trim() || costIncomplete || (context.beforeRequest && !context.beforeRequest())) {
        return {
            failedCall: true, text: '', parsed: null, parserText: '', groundingText: '',
            errors: [...errors, 'Raster transcription incomplete; analysis was not started.'],
            cost: hasCost ? ocrCost : null, costIncomplete: costIncomplete || !hasCost, latency: latencyMs,
            retries, provider: [...providers].join(', ') || null, usage: hasUsage ? usage : null, pages: totalPages,
            costAccounted: Boolean(context.recordRequest),
        };
    }

    const result = await analyzeTextResult(model, transcript, doc, context);
    if (context.recordRequest && !result.costAccounted) context.recordRequest(result, 0);

    if (result.provider) providers.add(result.provider);
    if (result.usage) {
        hasUsage = true;
        addUsage(usage, result.usage);
    }
    // Preserve the known subtotal, but never label missing call costs as zero.
    if (Number.isFinite(result.cost)) { ocrCost += result.cost; hasCost = true; }
    else costIncomplete = true;
    const merged = {
        ...result,
        cost: hasCost ? ocrCost : null,
        latencyMs: latencyMs + (result.latencyMs || 0),
        retries: retries + (result.retries || 0),
        usage: hasUsage ? usage : null,
        costAccounted: Boolean(context.recordRequest) || result.costAccounted === true,
    };
    const finalized = finalizeAnalysisResult({ result: merged, doc, groundingText: transcript });
    return {
        ...finalized,
        errors: [...errors, ...finalized.errors],
        costIncomplete: costIncomplete || !hasCost,
        provider: [...providers].join(', ') || result.provider || null,
    };
}

function makeAnalysisRegistry() {
    return {
        'local-text': (model, doc, context) => runTextAnalysis(model, doc, context),
        'local-raster': (model, doc, context) => runRasterAnalysis(model, doc, context),
        'or-cloudflare': (model, doc, context) => runPdfAnalysis('cloudflare-ai', model, doc, context),
        'or-mistral-ocr': (model, doc, context) => runPdfAnalysis('mistral-ocr', model, doc, context),
        'or-native': (model, doc, context) => runPdfAnalysis('native', model, doc, context),
    };
}

function buildArmDefinitions() {
    const registry = makeArmRegistry();
    return ARMS.map((arm) => ({ ...arm, run: registry[arm.id] }));
}

module.exports = {
    ARMS, ANALYSIS_ARMS, capabilityAvailable, buildArmMatrix, resolveFixturePath,
    renderPdfPages, renderPdfPage, makeArmRegistry, buildArmDefinitions, referenceArm, parseEngine, pageBody,
    buildPdfAnalysisPrompt, analysisArmsForModel, makeAnalysisRegistry, runPdfAnalysis, runTextAnalysis, runRasterAnalysis,
};
