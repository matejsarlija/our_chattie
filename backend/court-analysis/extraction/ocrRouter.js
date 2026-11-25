'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PDFDocument } = require('pdf-lib');
const logger = require('../../services/logger');
const { createOpenRouterClient } = require('../../llm/openrouterClient');
const { trackUsageInvoke } = require('../../llm/usage');
const { withGeminiRetry, withGeminiTimeout } = require('../../llm/retry');
const { modelContentToText } = require('../../helpers/jsonExtract');
const { buildStageCounterEvent } = require('../../http/analysisStage');
const {
    EXTRACTION_ERROR_CODES,
    buildExtractionResult,
    buildPageRanges,
    renderPageToJpeg,
    renderPdfPagesToJpegBuffers,
    isPdfJsMocked,
} = require('./pdfText');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { getSharedWorkerPool } = require('./workerPool');

const DEFAULT_BATCH_WINDOW_PAGES = 15;
const DEFAULT_MAX_DOC_OCR_PAGES = 60;
const DEFAULT_MAX_OCR_WINDOW_BYTES = 5 * 1024 * 1024;
const DEFAULT_PDF_PREFLIGHT_MAX_BYTES = 50 * 1024 * 1024;
const OCR_PROMPT_VERSION = 2;

const MISTRAL_OCR_HOST_MODEL = 'google/gemini-2.5-flash';
const GEMMA_RASTER_MODEL = 'google/gemma-4-31b-it';
const GEMINI_RASTER_MODEL = 'google/gemini-2.5-flash';

const GEMMA_PROVIDER_PREF = Object.freeze({
    order: ['DeepInfra', 'Parasail', 'Together'],
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: 'deny',
    quantizations: ['bf16', 'fp16', 'fp8'],
});

const GEMINI_PROVIDER_PREF = Object.freeze({
    order: ['Google AI Studio', 'Google Vertex'],
    allow_fallbacks: true,
    require_parameters: true,
    data_collection: 'deny',
});

const OCR_BATCH_MARKER_RE = /^===\s*STRANICA\s+(\d+)\s*===/gim;
const OCR_PAGE_CACHE_MAX_ENTRIES = 400;
const ocrPageCache = new Map();

function resetOcrPageCacheForTests() {
    ocrPageCache.clear();
}

function resolveBatchWindowPages() {
    const raw = Number.parseInt(process.env.OCR_BATCH_WINDOW_PAGES, 10);
    return Number.isFinite(raw) && raw >= 1 ? Math.min(30, Math.floor(raw)) : DEFAULT_BATCH_WINDOW_PAGES;
}

function resolveMaxDocOcrPages() {
    const maxDoc = Number.parseInt(process.env.MAX_DOC_OCR_PAGES, 10);
    if (Number.isFinite(maxDoc) && maxDoc >= 1) return Math.floor(maxDoc);
    const legacyCap = Number.parseInt(process.env.OCR_MAX_PAGES, 10);
    if (Number.isFinite(legacyCap) && legacyCap >= 1) return Math.floor(legacyCap);
    return DEFAULT_MAX_DOC_OCR_PAGES;
}

function resolveOcrMaxPages() {
    return resolveMaxDocOcrPages();
}

function resolveMaxOcrWindowBytes() {
    const raw = Number(process.env.OCR_MAX_WINDOW_BYTES);
    return Number.isFinite(raw) && raw >= 1024 ? Math.floor(raw) : DEFAULT_MAX_OCR_WINDOW_BYTES;
}

function resolvePdfMaxBytes() {
    const raw = Number(process.env.OCR_MAX_PDF_BYTES);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PDF_PREFLIGHT_MAX_BYTES;
}

function resolvePdfHardMaxPages() {
    const raw = Number.parseInt(process.env.OCR_HARD_MAX_PAGES, 10);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : null;
}

function resolveOcrTimeoutMs() {
    const raw = Number(process.env.OPENROUTER_OCR_TIMEOUT_MS);
    return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 90000;
}

function throwIfSignalAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason || Object.assign(new Error('Analysis aborted.'), { name: 'AbortError' });
    }
}

function buildOcrSinglePagePrompt() {
    return 'Extract all text from this document image. The document is in Croatian. Provide only the raw text.';
}

async function resolvePdfPageCount(fileBytes) {
    if (!isPdfJsMocked()) {
        try {
            const pdfDoc = await PDFDocument.load(fileBytes, { ignoreEncryption: true });
            return pdfDoc.getPageCount();
        } catch {
            // Fall through to pdfjs-dist when pdf-lib cannot parse the stream.
        }
    }
    const { PDFJS_STANDARD_FONT_DATA_URL } = require('./pdfText');
    let doc = null;
    try {
        doc = await pdfjsLib.getDocument({
            data: new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength),
            standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
        }).promise;
        return doc.numPages || 0;
    } finally {
        if (doc && typeof doc.destroy === 'function') {
            await doc.destroy().catch(() => {});
        }
    }
}

function buildOcrBatchInstruction() {
    return (
        'Extract all text from each document image. The documents are in Croatian. Images are provided in a fixed order. ' +
        "For EACH image, start with a header line exactly '=== STRANICA N ===' " +
        '(N is the 1-based position of that image in THIS message: the first image is 1, the second is 2, and so on), ' +
        'followed by that page\'s raw text on the following lines. ' +
        'Provide no commentary outside the page sections.'
    );
}

function splitBatchedOcrPages(responseText, expectedPages) {
    const segments = new Array(expectedPages).fill(null);
    const marks = [];
    const re = new RegExp(OCR_BATCH_MARKER_RE.source, 'gim');
    let match;
    while ((match = re.exec(String(responseText || ''))) !== null) {
        marks.push({
            pageNumber: Number.parseInt(match[1], 10),
            headerStart: match.index,
            bodyStart: match.index + match[0].length,
        });
    }
    for (let i = 0; i < marks.length; i += 1) {
        const { pageNumber, bodyStart } = marks[i];
        if (!(pageNumber >= 1 && pageNumber <= expectedPages)) continue;
        if (segments[pageNumber - 1] !== null) continue;
        const end = i + 1 < marks.length ? marks[i + 1].headerStart : String(responseText).length;
        const body = String(responseText).slice(bodyStart, end).trim();
        segments[pageNumber - 1] = body.length > 0 ? body : null;
    }
    return segments;
}

function buildContiguousRanges(pageNumbers) {
    if (!Array.isArray(pageNumbers) || pageNumbers.length === 0) return [];
    const sorted = [...new Set(pageNumbers)].sort((a, b) => a - b);
    const ranges = [];
    let from = sorted[0];
    let to = sorted[0];
    for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i] === to + 1) {
            to = sorted[i];
        } else {
            ranges.push({ from, to });
            from = sorted[i];
            to = sorted[i];
        }
    }
    ranges.push({ from, to });
    return ranges;
}

function selectOcrPages(targetPages, maxPages = resolveMaxDocOcrPages()) {
    const sorted = [...new Set((targetPages || []).filter((p) => Number.isInteger(p) && p >= 1))].sort((a, b) => a - b);
    if (sorted.length <= maxPages) {
        return {
            selectedPages: sorted,
            skippedPageRanges: [],
            truncated: false,
        };
    }

    const headCount = maxPages >= 6 ? Math.ceil((maxPages * 2) / 3) : maxPages;
    const tailCount = maxPages - headCount;
    const head = sorted.slice(0, headCount);
    const tail = tailCount > 0 ? sorted.slice(-tailCount) : [];
    const selectedPages = [...head, ...tail];
    const selectedSet = new Set(selectedPages);
    const skipped = sorted.filter((p) => !selectedSet.has(p));

    return {
        selectedPages,
        skippedPageRanges: buildContiguousRanges(skipped),
        truncated: true,
    };
}

function groupIntoPageWindows(pageNumbers, windowSize = resolveBatchWindowPages()) {
    const sorted = [...pageNumbers].sort((a, b) => a - b);
    const windows = [];
    for (let i = 0; i < sorted.length; i += windowSize) {
        windows.push(sorted.slice(i, i + windowSize));
    }
    return windows;
}

async function slicePdfWindowBytes(srcDoc, pageNumbers, maxWindowBytes = resolveMaxOcrWindowBytes()) {
    const subDoc = await PDFDocument.create();
    const indices = pageNumbers.map((pageNo) => pageNo - 1);
    const copiedPages = await subDoc.copyPages(srcDoc, indices);
    for (const page of copiedPages) {
        subDoc.addPage(page);
    }
    const bytes = Buffer.from(await subDoc.save());
    if (bytes.length > maxWindowBytes && pageNumbers.length > 1) {
        const mid = Math.ceil(pageNumbers.length / 2);
        const left = await slicePdfWindowBytes(srcDoc, pageNumbers.slice(0, mid), maxWindowBytes);
        const right = await slicePdfWindowBytes(srcDoc, pageNumbers.slice(mid), maxWindowBytes);
        return [...left, ...right];
    }
    return [{ pageNumbers, bytes }];
}

async function buildSlicedWindows(pdfBytes, selectedPages, {
    windowPages = resolveBatchWindowPages(),
    maxWindowBytes = resolveMaxOcrWindowBytes(),
} = {}) {
    const rawWindows = groupIntoPageWindows(selectedPages, windowPages);
    if (isPdfJsMocked()) {
        return rawWindows.map((pages) => ({ pageNumbers: pages, bytes: Buffer.from(pdfBytes) }));
    }
    try {
        const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        const totalDocPages = srcDoc.getPageCount();
        const validWindows = rawWindows
            .map((pages) => pages.filter((p) => p >= 1 && p <= totalDocPages))
            .filter((pages) => pages.length > 0);
        const sliced = [];
        for (const pages of validWindows) {
            const parts = await slicePdfWindowBytes(srcDoc, pages, maxWindowBytes);
            sliced.push(...parts);
        }
        return sliced;
    } catch {
        return rawWindows.map((pages) => ({ pageNumbers: pages, bytes: Buffer.from(pdfBytes) }));
    }
}

function readCachedPage(contentHash, pageNumber, sqliteStore, engine = 'stage-t') {
    const key = `${contentHash}:${pageNumber}`;
    if (ocrPageCache.has(key)) {
        const cached = ocrPageCache.get(key);
        ocrPageCache.delete(key);
        ocrPageCache.set(key, cached);
        return cached;
    }
    try {
        const fromSql = sqliteStore?.getOcrPage?.(contentHash, pageNumber, {
            engine: 'page-cache',
            promptVersion: OCR_PROMPT_VERSION,
            modelId: engine,
        }) ?? sqliteStore?.getOcrPage?.(contentHash, pageNumber);
        if (typeof fromSql === 'string' && fromSql.length > 0) {
            ocrPageCache.set(key, fromSql);
            return fromSql;
        }
    } catch {
        // Cache read errors must never abort OCR.
    }
    return null;
}

function writeCachedPage(contentHash, pageNumber, text, sqliteStore, engine = 'stage-t') {
    if (typeof text !== 'string' || !text.trim()) return;
    const key = `${contentHash}:${pageNumber}`;
    if (ocrPageCache.has(key)) ocrPageCache.delete(key);
    ocrPageCache.set(key, text);
    while (ocrPageCache.size > OCR_PAGE_CACHE_MAX_ENTRIES) {
        ocrPageCache.delete(ocrPageCache.keys().next().value);
    }
    try {
        sqliteStore?.putOcrPage?.(contentHash, pageNumber, text, {
            engine: 'page-cache',
            promptVersion: OCR_PROMPT_VERSION,
            modelId: engine,
        });
    } catch {
        // Cache write failures must never abort OCR.
    }
}

function extractMistralTextParts(response) {
    const annotations = response?.annotations
        || response?.response_metadata?.annotations
        || response?.choices?.[0]?.message?.annotations;
    if (Array.isArray(annotations) && annotations.length > 0) {
        const parts = annotations.flatMap((item) => item?.file?.content || [])
            .filter((part) => part?.type === 'text' && typeof part.text === 'string' && part.text.trim())
            .map((part) => part.text.replace(/<\/?file\b[^>]*>/gi, '').trim())
            .filter(Boolean);
        if (parts.length > 0) return parts;
    }
    const raw = modelContentToText(response?.content).replace(/<\/?file\b[^>]*>/gi, '').trim();
    return raw ? [raw] : [];
}

function mapMistralWindowOutput(parts, windowPages) {
    const mapped = new Map();
    if (!Array.isArray(parts) || parts.length === 0) return mapped;

    if (parts.length === windowPages.length) {
        windowPages.forEach((pageNumber, idx) => {
            if (parts[idx]?.trim()) mapped.set(pageNumber, parts[idx].trim());
        });
        return mapped;
    }

    const joined = parts.join('\n').trim();
    const markerSplits = splitBatchedOcrPages(joined, windowPages.length);
    if (markerSplits.some(Boolean)) {
        windowPages.forEach((pageNumber, idx) => {
            if (markerSplits[idx]) mapped.set(pageNumber, markerSplits[idx]);
        });
        return mapped;
    }

    if (windowPages.length === 1 && joined) {
        mapped.set(windowPages[0], joined);
        return mapped;
    }

    // Mistral returned one combined transcript for a multi-page window without per-page splits:
    // split deterministically across pages by paragraph/character proportion or attach to first page if tiny.
    const formFeedParts = joined.split(/\f+/).map((s) => s.trim()).filter(Boolean);
    if (formFeedParts.length === windowPages.length) {
        windowPages.forEach((pageNumber, idx) => {
            mapped.set(pageNumber, formFeedParts[idx]);
        });
        return mapped;
    }

    if (joined) {
        mapped.set(windowPages[0], joined);
        for (let i = 1; i < windowPages.length; i += 1) {
            mapped.set(windowPages[i], '');
        }
    }
    return mapped;
}

function isRecitationOrBlockedResponse(response, error = null) {
    const finishReason = String(response?.response_metadata?.finish_reason || response?.response_metadata?.finishReason || '').toLowerCase();
    if (finishReason === 'recitation' || finishReason === 'content_filter') return true;
    if (error && /recitation|content_filter|blocked/i.test(String(error?.message || error))) return true;
    return false;
}

async function runMistralOcrWindow({ window, fileName, invokeClient, tracker, onUsage, signal }) {
    const plugins = [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }];
    const client = invokeClient
        ? { invoke: invokeClient }
        : createOpenRouterClient({ model: MISTRAL_OCR_HOST_MODEL, temperature: 0, maxTokens: 16, plugins });
    const message = {
        role: 'user',
        content: [
            { type: 'text', text: 'Process this PDF and return OK.' },
            {
                type: 'file',
                file: {
                    filename: fileName || 'document.pdf',
                    file_data: `data:application/pdf;base64,${window.bytes.toString('base64')}`,
                },
            },
        ],
    };
    const response = await withGeminiRetry(
        () => withGeminiTimeout(
            (reqSignal) => trackUsageInvoke(client, [message], {
                signal: reqSignal || signal,
                tracker,
                onUsage,
                plugins: [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }],
            }),
            { timeoutMs: resolveOcrTimeoutMs() },
        ),
    );
    const parts = extractMistralTextParts(response);
    return {
        mapped: mapMistralWindowOutput(parts, window.pageNumbers),
        response,
    };
}

async function runRasterOcrForPages({
    pdfBytes,
    pageNumbers,
    modelId,
    providerPref,
    workerPool,
    invokeClient,
    tracker,
    onUsage,
    progressCallback,
    fileName,
    signal,
}) {
    if (!pageNumbers.length) return { pageMap: new Map(), error: null, recitationBlocked: false };

    let renderedPages;
    if (workerPool && !isPdfJsMocked()) {
        renderedPages = await workerPool.run('renderPdfPages', {
            bytes: new Uint8Array(pdfBytes),
            pageNumbers,
        }, { signal });
    } else {
        renderedPages = await renderPdfPagesToJpegBuffers(pdfBytes, pageNumbers);
    }

    const client = invokeClient
        ? { invoke: invokeClient }
        : createOpenRouterClient({
            model: modelId,
            temperature: 0.1,
            maxTokens: renderedPages.length > 1 ? 16384 : 4096,
            provider: providerPref,
        });

    const pageMap = new Map();
    let lastError = null;
    let recitationBlocked = false;

    if (renderedPages.length > 1) {
        try {
            throwIfSignalAborted(signal);
            const content = renderedPages.map(({ buffer }) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}` },
            }));
            content.push({ type: 'text', text: buildOcrBatchInstruction() });
            const response = await withGeminiRetry(
                () => withGeminiTimeout(
                    (reqSignal) => trackUsageInvoke(client, [{ role: 'user', content }], {
                        signal: reqSignal || signal,
                        tracker,
                        onUsage,
                    }),
                    { timeoutMs: resolveOcrTimeoutMs() },
                ),
            );
            if (isRecitationOrBlockedResponse(response)) {
                recitationBlocked = true;
            } else {
                const segments = splitBatchedOcrPages(modelContentToText(response?.content), renderedPages.length);
                renderedPages.forEach(({ pageNumber }, pos) => {
                    if (typeof segments[pos] === 'string' && segments[pos].trim()) {
                        pageMap.set(pageNumber, segments[pos].trim());
                    }
                });
            }
        } catch (err) {
            if (signal?.aborted) throw err;
            lastError = err;
            if (isRecitationOrBlockedResponse(null, err)) recitationBlocked = true;
            logger.agent.warn(`[Stage T] Batch raster (${modelId}) failed for ${fileName}: ${err.message}`);
        }
    }

    // Sequential refill for single-page requests or pages missed by batch
    for (const { pageNumber, buffer } of renderedPages) {
        if (pageMap.has(pageNumber) || recitationBlocked) continue;
        throwIfSignalAborted(signal);
        progressCallback?.({
            step: 'ocr',
            message: `OCR: stranica ${pageNumber} (${fileName})...`,
        });
        try {
            const response = await withGeminiRetry(
                () => withGeminiTimeout(
                    (reqSignal) => trackUsageInvoke(client, [{
                        role: 'user',
                        content: [
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}` } },
                            { type: 'text', text: buildOcrSinglePagePrompt() },
                        ],
                    }], {
                        signal: reqSignal || signal,
                        tracker,
                        onUsage,
                    }),
                    { timeoutMs: resolveOcrTimeoutMs() },
                ),
            );
            if (isRecitationOrBlockedResponse(response)) {
                recitationBlocked = true;
                lastError = new Error(`OCR recitation block on ${modelId}`);
                break;
            }
            const pageText = modelContentToText(response?.content).trim();
            if (pageText) {
                pageMap.set(pageNumber, pageText);
            }
        } catch (err) {
            if (signal?.aborted) throw err;
            lastError = err;
            if (isRecitationOrBlockedResponse(null, err)) {
                recitationBlocked = true;
            }
            break;
        }
    }

    return { pageMap, error: lastError, recitationBlocked };
}

async function transcribeDocumentViaStageT({
    filePath,
    preflightDoc = null,
    progressCallback = null,
    sqliteStore = null,
    workerPool = null,
    tracker = null,
    onUsage = null,
    signal = null,
    clients = {},
    docsDone = 0,
    docsTotal = 1,
} = {}) {
    throwIfSignalAborted(signal);
    const fileName = preflightDoc?.fileName || path.basename(filePath || 'document.pdf');
    const resolvedPath = filePath || preflightDoc?.filePath;
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
        return buildExtractionResult({
            method: 'ocr',
            error: EXTRACTION_ERROR_CODES.FILE_NOT_FOUND,
        });
    }

    const fileBytes = fs.readFileSync(resolvedPath);
    if (fileBytes.length > resolvePdfMaxBytes()) {
        return buildExtractionResult({
            method: 'ocr',
            pages: 0,
            error: EXTRACTION_ERROR_CODES.PDF_TOO_LARGE,
        });
    }

    const contentHash = preflightDoc?.contentHash || crypto.createHash('sha256').update(fileBytes).digest('hex');
    let totalDocPages = Number.isInteger(preflightDoc?.pageCount) && preflightDoc.pageCount > 0
        ? preflightDoc.pageCount
        : null;
    if (totalDocPages === null) {
        try {
            totalDocPages = await resolvePdfPageCount(fileBytes);
        } catch (err) {
            if (signal?.aborted) throw err;
            const isTimeout = /abort|timed out|timeout/i.test(String(err?.message || ''));
            return buildExtractionResult({
                method: 'ocr',
                pages: 0,
                error: isTimeout ? EXTRACTION_ERROR_CODES.OCR_TIMEOUT : EXTRACTION_ERROR_CODES.OCR_FAILED,
            });
        }
        if (!Number.isInteger(totalDocPages) || totalDocPages <= 0) {
            return buildExtractionResult({
                method: 'ocr',
                pages: 0,
                error: EXTRACTION_ERROR_CODES.OCR_FAILED,
            });
        }
    }
    const hardMaxPages = resolvePdfHardMaxPages();
    if (hardMaxPages !== null && totalDocPages > hardMaxPages) {
        return buildExtractionResult({
            method: 'ocr',
            pages: 0,
            error: EXTRACTION_ERROR_CODES.PDF_PAGE_LIMIT_EXCEEDED,
        });
    }

    // Whole-document SQLite transcript cache hit check
    const cachedTranscript = sqliteStore?.getOcrTranscript?.({ contentHash });
    if (cachedTranscript && cachedTranscript.text && !preflightDoc?.digitalPages?.length) {
        const pageMap = cachedTranscript.pageMap || {};
        const pageNums = Object.keys(pageMap).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
        const pageRanges = pageNums.length > 0
            ? buildPageRanges(pageNums.map((p) => String(pageMap[p] || '')), pageNums)
            : [];
        return buildExtractionResult({
            text: cachedTranscript.text,
            method: 'ocr',
            ocrEngine: cachedTranscript.engine,
            fromCache: true,
            pages: cachedTranscript.pageCount || pageNums.length || 1,
            pageRanges,
            truncated: Boolean(cachedTranscript.truncated),
            skippedPageRanges: [],
            error: null,
        });
    }

    // Build initial digital page map for hybrid_mixed documents
    const mergedPages = new Map();
    if (Array.isArray(preflightDoc?.pageAnalyses)) {
        for (const page of preflightDoc.pageAnalyses) {
            if (page.hasUsableText && page.text) {
                mergedPages.set(page.pageNumber, page.text);
            }
        }
    }

    const targetOcrPages = Array.isArray(preflightDoc?.ocrPages) && preflightDoc.ocrPages.length > 0
        ? preflightDoc.ocrPages
        : Array.from({ length: totalDocPages }, (_, idx) => idx + 1);

    const { selectedPages, skippedPageRanges, truncated } = selectOcrPages(targetOcrPages);
    const pendingOcrPages = [];
    for (const pageNumber of selectedPages) {
        const cachedPage = readCachedPage(contentHash, pageNumber, sqliteStore);
        if (cachedPage !== null) {
            mergedPages.set(pageNumber, cachedPage);
        } else {
            pendingOcrPages.push(pageNumber);
        }
    }

    const pool = workerPool || getSharedWorkerPool();
    const windows = await buildSlicedWindows(fileBytes, pendingOcrPages);
    const enginesUsed = new Set();
    let pagesDone = selectedPages.length - pendingOcrPages.length;
    const pagesTotal = selectedPages.length;
    let firstFailure = null;
    const ocrProviderMode = String(process.env.OCR_PROVIDER || 'auto').toLowerCase();
    const canTryMistral = ocrProviderMode !== 'raster'
        && (Boolean(clients.mistralOcr) || Boolean(process.env.OPENROUTER_API_KEY));

    const emitOcrProgress = () => {
        const counter = buildStageCounterEvent({
            stage: 'ocr',
            done: pagesDone,
            failed: 0,
            total: pagesTotal,
            unit: 'stranica',
        });
        counter.metadata.docsDone = docsDone;
        counter.metadata.docsTotal = docsTotal;
        counter.metadata.pagesDone = pagesDone;
        counter.metadata.pagesTotal = pagesTotal;
        progressCallback?.(counter);
    };

    for (const window of windows) {
        throwIfSignalAborted(signal);
        let unresolved = [...window.pageNumbers];

        // Tier 1: or-mistral-ocr on sliced <=15p / <=5MB window
        if (canTryMistral && unresolved.length > 0) {
            try {
                const { mapped } = await runMistralOcrWindow({
                    window,
                    fileName,
                    invokeClient: clients.mistralOcr,
                    tracker,
                    onUsage,
                    signal,
                });
                const covered = [];
                for (const pageNo of unresolved) {
                    if (mapped.has(pageNo)) {
                        const text = mapped.get(pageNo);
                        mergedPages.set(pageNo, text);
                        if (text) writeCachedPage(contentHash, pageNo, text, sqliteStore, 'mistral-ocr');
                        covered.push(pageNo);
                    }
                }
                if (covered.length > 0) {
                    enginesUsed.add('mistral-ocr');
                    pagesDone += covered.length;
                    unresolved = unresolved.filter((p) => !covered.includes(p));
                    emitOcrProgress();
                }
            } catch (err) {
                if (signal?.aborted) throw err;
                firstFailure = firstFailure || err;
                logger.agent.warn(`[Stage T] Mistral OCR failed on ${fileName} pages [${window.pageNumbers.join(',')}]: ${err.message}`);
            }
        }

        // Tier 2: google/gemma-4-31b-it vision raster
        if (unresolved.length > 0) {
            const gemmaRes = await runRasterOcrForPages({
                pdfBytes: fileBytes,
                pageNumbers: unresolved,
                modelId: GEMMA_RASTER_MODEL,
                providerPref: GEMMA_PROVIDER_PREF,
                workerPool: pool,
                invokeClient: clients.gemmaRaster,
                tracker,
                onUsage,
                progressCallback,
                fileName,
                signal,
            });
            if (gemmaRes.pageMap.size > 0) {
                enginesUsed.add('gemma-raster');
                for (const [pageNo, text] of gemmaRes.pageMap) {
                    mergedPages.set(pageNo, text);
                    writeCachedPage(contentHash, pageNo, text, sqliteStore, GEMMA_RASTER_MODEL);
                }
                pagesDone += gemmaRes.pageMap.size;
                unresolved = unresolved.filter((p) => !gemmaRes.pageMap.has(p));
                emitOcrProgress();
            }
            if (gemmaRes.error) firstFailure = firstFailure || gemmaRes.error;
        }

        // Tier 3: google/gemini-2.5-flash final vision raster escalation
        if (unresolved.length > 0) {
            const geminiRes = await runRasterOcrForPages({
                pdfBytes: fileBytes,
                pageNumbers: unresolved,
                modelId: GEMINI_RASTER_MODEL,
                providerPref: GEMINI_PROVIDER_PREF,
                workerPool: pool,
                invokeClient: clients.geminiRaster,
                tracker,
                onUsage,
                progressCallback,
                fileName,
                signal,
            });
            if (geminiRes.pageMap.size > 0) {
                enginesUsed.add('gemini-raster');
                for (const [pageNo, text] of geminiRes.pageMap) {
                    mergedPages.set(pageNo, text);
                    writeCachedPage(contentHash, pageNo, text, sqliteStore, GEMINI_RASTER_MODEL);
                }
                pagesDone += geminiRes.pageMap.size;
                unresolved = unresolved.filter((p) => !geminiRes.pageMap.has(p));
                emitOcrProgress();
            }
            if (geminiRes.error) firstFailure = firstFailure || geminiRes.error;
        }
    }

    // Merge digital + OCR pages in exact 1..N order
    const orderedPageNums = [...mergedPages.keys()].sort((a, b) => a - b);
    const nonEmptyPages = orderedPageNums.filter((p) => String(mergedPages.get(p) || '').trim().length > 0);
    if (nonEmptyPages.length === 0) {
        const isTimeout = /abort|timed out|timeout/i.test(String(firstFailure?.message || ''));
        return buildExtractionResult({
            method: 'ocr',
            pages: 0,
            truncated,
            skippedPageRanges,
            error: isTimeout ? EXTRACTION_ERROR_CODES.OCR_TIMEOUT : EXTRACTION_ERROR_CODES.OCR_FAILED,
        });
    }

    const orderedTexts = orderedPageNums
        .map((p) => ({ pageNumber: p, text: String(mergedPages.get(p) || '') }))
        .filter((entry) => entry.text.length > 0);
    const combinedText = orderedTexts.map((e) => e.text).join('\n\n');
    const pageRanges = buildPageRanges(orderedTexts.map((e) => e.text), orderedTexts.map((e) => e.pageNumber));
    const ocrEngine = enginesUsed.size > 0 ? [...enginesUsed].join('+') : 'cache';

    const ocrObtainedCount = selectedPages.filter((p) => mergedPages.has(p)).length;
    const isPartialOcr = ocrObtainedCount < selectedPages.length;
    const pageMapObj = Object.fromEntries(orderedTexts.map((e) => [e.pageNumber, e.text]));

    if (sqliteStore?.putOcrTranscript && enginesUsed.size > 0) {
        try {
            sqliteStore.putOcrTranscript({
                contentHash,
                engine: ocrEngine,
                taskType: 'TranscribePage',
                promptVersion: OCR_PROMPT_VERSION,
                modelId: enginesUsed.has('mistral-ocr') ? 'or-mistral-ocr' : GEMMA_RASTER_MODEL,
                pageCount: orderedTexts.length,
                text: combinedText,
                pageMap: pageMapObj,
                truncated: truncated || isPartialOcr,
            });
        } catch {
            // Non-fatal persistence error.
        }
    }

    return buildExtractionResult({
        text: combinedText,
        method: preflightDoc?.docClass === 'hybrid_mixed' ? 'hybrid' : 'ocr',
        ocrEngine,
        fromCache: enginesUsed.size === 0 && selectedPages.length > 0,
        pages: orderedTexts.length,
        pageRanges,
        truncated: truncated || isPartialOcr,
        skippedPageRanges,
        reasonCode: truncated ? EXTRACTION_ERROR_CODES.OCR_PAGE_CAP : (isPartialOcr ? EXTRACTION_ERROR_CODES.OCR_PARTIAL : null),
        error: isPartialOcr ? EXTRACTION_ERROR_CODES.OCR_PARTIAL : null,
    });
}

async function extractTextViaOCR(filePath, progressCallback, options = {}) {
    const signal = options.signal || null;
    throwIfSignalAborted(signal);
    const fileName = path.basename(filePath || 'document.pdf');
    if (!filePath || !fs.existsSync(filePath)) {
        return buildExtractionResult({
            method: 'ocr',
            error: EXTRACTION_ERROR_CODES.FILE_NOT_FOUND,
        });
    }

    const fileBytes = fs.readFileSync(filePath);
    if (fileBytes.length > resolvePdfMaxBytes()) {
        return buildExtractionResult({
            method: 'ocr',
            pages: 0,
            error: EXTRACTION_ERROR_CODES.PDF_TOO_LARGE,
        });
    }

    const contentHash = crypto.createHash('sha256').update(fileBytes).digest('hex');
    const sqliteStore = options.sqliteStore || null;
    const tracker = options.tracker || null;
    const onUsage = options.onUsage || null;
    const modelId = options.modelId || GEMMA_RASTER_MODEL;
    const { PDFJS_STANDARD_FONT_DATA_URL } = require('./pdfText');

    let doc = null;
    try {
        doc = await pdfjsLib.getDocument({
            data: new Uint8Array(fileBytes.buffer, fileBytes.byteOffset, fileBytes.byteLength),
            standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
        }).promise;
        const totalDocPages = doc.numPages || 0;
        const hardMaxPages = resolvePdfHardMaxPages();
        if (hardMaxPages !== null && totalDocPages > hardMaxPages) {
            return buildExtractionResult({
                method: 'ocr',
                pages: 0,
                error: EXTRACTION_ERROR_CODES.PDF_PAGE_LIMIT_EXCEEDED,
            });
        }

        const targetPages = Array.from({ length: totalDocPages }, (_, idx) => idx + 1);
        const { selectedPages, skippedPageRanges, truncated } = selectOcrPages(targetPages);
        const mergedPages = new Map();
        const pendingPages = [];
        for (const pageNo of selectedPages) {
            const cached = readCachedPage(contentHash, pageNo, sqliteStore);
            if (cached !== null) {
                mergedPages.set(pageNo, cached);
            } else {
                pendingPages.push(pageNo);
            }
        }

        let firstFailure = null;
        if (pendingPages.length > 0) {
            const client = options.invokeClient
                ? { invoke: options.invokeClient }
                : createOpenRouterClient({
                    model: modelId,
                    temperature: 0.1,
                    maxTokens: pendingPages.length > 1 ? 16384 : 4096,
                    provider: GEMMA_PROVIDER_PREF,
                });

            if (pendingPages.length > 1) {
                try {
                    throwIfSignalAborted(signal);
                    const content = [];
                    for (const pageNo of pendingPages) {
                        const page = await doc.getPage(pageNo);
                        const buf = await renderPageToJpeg(page);
                        content.push({
                            type: 'image_url',
                            image_url: { url: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` },
                        });
                    }
                    content.push({ type: 'text', text: buildOcrBatchInstruction() });
                    const response = await withGeminiRetry(
                        () => withGeminiTimeout(
                            (reqSignal) => trackUsageInvoke(client, [{ role: 'user', content }], {
                                signal: reqSignal || signal,
                                tracker,
                                onUsage,
                            }),
                            { timeoutMs: resolveOcrTimeoutMs() },
                        ),
                    );
                    const segments = splitBatchedOcrPages(modelContentToText(response?.content), pendingPages.length);
                    pendingPages.forEach((pageNo, pos) => {
                        if (typeof segments[pos] === 'string' && segments[pos].trim()) {
                            const txt = segments[pos].trim();
                            mergedPages.set(pageNo, txt);
                            writeCachedPage(contentHash, pageNo, txt, sqliteStore, modelId);
                        }
                    });
                } catch (err) {
                    if (signal?.aborted) throw err;
                    firstFailure = firstFailure || err;
                }
            }

            const stillPending = pendingPages.filter((p) => !mergedPages.has(p));
            for (const pageNo of stillPending) {
                throwIfSignalAborted(signal);
                progressCallback?.({
                    step: 'ocr',
                    message: `OCR: stranica ${pageNo} (${fileName})...`,
                });
                try {
                    const page = await doc.getPage(pageNo);
                    const buf = await renderPageToJpeg(page);
                    const response = await withGeminiRetry(
                        () => withGeminiTimeout(
                            (reqSignal) => trackUsageInvoke(client, [{
                                role: 'user',
                                content: [
                                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}` } },
                                    { type: 'text', text: buildOcrSinglePagePrompt() },
                                ],
                            }], {
                                signal: reqSignal || signal,
                                tracker,
                                onUsage,
                            }),
                            { timeoutMs: resolveOcrTimeoutMs() },
                        ),
                    );
                    const pageText = modelContentToText(response?.content).trim();
                    if (pageText) {
                        mergedPages.set(pageNo, pageText);
                        writeCachedPage(contentHash, pageNo, pageText, sqliteStore, modelId);
                    }
                } catch (err) {
                    if (signal?.aborted) throw err;
                    firstFailure = firstFailure || err;
                    break;
                }
            }
        }

        const orderedPageNums = [...mergedPages.keys()].sort((a, b) => a - b);
        const orderedTexts = orderedPageNums
            .map((p) => ({ pageNumber: p, text: String(mergedPages.get(p) || '') }))
            .filter((entry) => entry.text.length > 0);
        if (orderedTexts.length === 0) {
            const isTimeout = /abort|timed out|timeout/i.test(String(firstFailure?.message || ''));
            return buildExtractionResult({
                method: 'ocr',
                pages: 0,
                truncated,
                skippedPageRanges,
                error: isTimeout ? EXTRACTION_ERROR_CODES.OCR_TIMEOUT : EXTRACTION_ERROR_CODES.OCR_FAILED,
            });
        }

        const isPartialOcr = selectedPages.some((p) => !mergedPages.has(p));
        return buildExtractionResult({
            text: orderedTexts.map((e) => e.text).join('\n\n'),
            method: 'ocr',
            ocrEngine: modelId,
            pages: orderedTexts.length,
            pageRanges: buildPageRanges(orderedTexts.map((e) => e.text), orderedTexts.map((e) => e.pageNumber)),
            truncated: truncated || isPartialOcr,
            skippedPageRanges,
            error: isPartialOcr ? EXTRACTION_ERROR_CODES.OCR_PARTIAL : null,
        });
    } catch (err) {
        if (signal?.aborted) throw err;
        const isTimeout = /abort|timed out|timeout/i.test(String(err?.message || ''));
        return buildExtractionResult({
            method: 'ocr',
            pages: 0,
            error: isTimeout ? EXTRACTION_ERROR_CODES.OCR_TIMEOUT : EXTRACTION_ERROR_CODES.OCR_FAILED,
        });
    } finally {
        if (doc && typeof doc.destroy === 'function') {
            await doc.destroy().catch(() => {});
        }
    }
}

module.exports = {
    DEFAULT_BATCH_WINDOW_PAGES,
    DEFAULT_MAX_DOC_OCR_PAGES,
    DEFAULT_MAX_OCR_WINDOW_BYTES,
    GEMMA_RASTER_MODEL,
    GEMINI_RASTER_MODEL,
    GEMMA_PROVIDER_PREF,
    GEMINI_PROVIDER_PREF,
    selectOcrPages,
    groupIntoPageWindows,
    buildSlicedWindows,
    buildOcrBatchInstruction,
    splitBatchedOcrPages,
    transcribeDocumentViaStageT,
    extractTextViaOCR,
    resetOcrPageCacheForTests,
    resolveBatchWindowPages,
    resolveMaxDocOcrPages,
    resolveOcrMaxPages,
    resolvePdfMaxBytes,
    resolvePdfHardMaxPages,
    resolveOcrTimeoutMs,
};
