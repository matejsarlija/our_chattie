// analysis-agent.js

require("dotenv").config();
const { Tool } = require("@langchain/core/tools");
const { HumanMessage } = require("@langchain/core/messages");
const fs = require("fs");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const { buildRetrievalChunks, splitTextIntoChunks } = require("../reasoning/chunker");
const agentLog = require("../../helpers/agentLog");

const { GEMINI_MODEL, GEMINI_API_KEY, createGeminiClient, outputCapWarning } = require("../../helpers/geminiConfig");
const { classifyFileFailure } = require("../../helpers/friendlyAnalysisError");
const { extractJsonBlock } = require("../../helpers/jsonExtract");
const { applyGroundingToAnalysis } = require("../reasoning/grounding");
const ocrPageStore = require("../../helpers/ocrPageStore");
// Two role-scoped clients: document JSON analysis and vision OCR differ in
// temperature and output-token policy.
const gemini = createGeminiClient("analysis");
const ocrGemini = createGeminiClient("ocr");
const ocrBatchGemini = createGeminiClient("ocr-batch");

const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { withGeminiRetry, withGeminiTimeout } = require("../../helpers/geminiRetry");
const { trackGeminiInvoke } = require("../../helpers/geminiUsage");

// Explicitly set the worker script path for Node.js. The legacy main-thread
// build must be paired with the legacy worker (not the default build worker).
pdfjsLib.GlobalWorkerOptions.workerSrc =
    require.resolve("pdfjs-dist/legacy/build/pdf.worker.js");

// Point pdf.js at its bundled standard_fonts directory. Without this, every
// document referencing a non-embedded standard font (LiberationSans, FoxitSerif,
// ...) logs a fetch warning and can degrade glyph-to-unicode mapping during
// getTextContent(). In Node the legacy build reads baseUrl from disk
// (NodeStandardFontDataFactory -> fs.readFile), so a filesystem path + separator
// is the correct format.
const PDFJS_STANDARD_FONT_DATA_URL = (() => {
    const fontsDir = path.join(
        path.dirname(require.resolve("pdfjs-dist/legacy/build/pdf.js")),
        "..",
        "..",
        "standard_fonts",
    );
    return fs.existsSync(fontsDir) ? fontsDir + path.sep : null;
})();

const { createCanvas } = require("canvas");

const DIRECT_TEXT_LIMIT = 25000;
const CHUNKING_TRIGGER_TEXT_LENGTH = 25000;
const ANALYSIS_CHUNK_SIZE = 3500;
const ANALYSIS_CHUNK_OVERLAP = 350;
const ANALYSIS_RETRIEVAL_LIMIT = 6;

// Pacing for document analysis. Files are processed with bounded concurrency
// so a batch does not fan out every file in parallel and burst the provider's
// RPM/TPM limits. Default 3 (paid key); override via ANALYSIS_FILE_CONCURRENCY.
const ANALYSIS_FILE_CONCURRENCY = (() => {
    const raw = Number(process.env.ANALYSIS_FILE_CONCURRENCY);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 3;
})();
const ANALYSIS_FILE_DELAY_MS = (() => {
    const raw = Number(process.env.ANALYSIS_FILE_DELAY_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
})();

// Liveness signal emitted while a document batch is being processed. Long
// batches used to produce minutes of silence; the heartbeat carries live
// counts so the UI can show progress and detect stalls.
const ANALYSIS_HEARTBEAT_MS = (() => {
    const raw = Number(process.env.ANALYSIS_HEARTBEAT_MS);
    return Number.isFinite(raw) && raw >= 1000 ? raw : 45000;
})();

function buildRetrievalTerms(caseInfo = {}, file = {}) {
    const terms = new Set();
    if (caseInfo.caseNumber) terms.add(String(caseInfo.caseNumber).toLowerCase());
    if (file.text) terms.add(String(file.text).toLowerCase());
    if (file.url) terms.add(String(file.url).toLowerCase());

    (caseInfo.participants || []).forEach((participant) => {
        if (participant?.name) terms.add(String(participant.name).toLowerCase());
        if (participant?.oib) terms.add(String(participant.oib).toLowerCase());
    });

    return Array.from(terms).filter(Boolean);
}

function rankChunksForAnalysis(chunks = [], retrievalTerms = []) {
    return chunks
        .map((chunk, index) => {
            const lowerText = String(chunk.text || "").toLowerCase();
            const lexicalHits = retrievalTerms.reduce((hits, term) => {
                if (!term) return hits;
                return lowerText.includes(term) ? hits + 1 : hits;
            }, 0);

            return {
                chunk,
                score: lexicalHits,
                index,
            };
        })
        .sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return a.index - b.index;
        });
}

function buildAnalysisInputText(text, caseInfo, file) {
    if (!text || text.length <= CHUNKING_TRIGGER_TEXT_LENGTH) {
        return {
            analysisText: String(text || "").slice(0, DIRECT_TEXT_LIMIT),
            usedChunking: false,
            chunkCount: 0,
            retrievedChunkCount: 0,
        };
    }

    const docId = path.basename(file?.filePath || file?.text || "analysis-doc");
    const chunks = splitTextIntoChunks(text, {
        chunkSize: ANALYSIS_CHUNK_SIZE,
        chunkOverlap: ANALYSIS_CHUNK_OVERLAP,
        docId,
    });

    if (!chunks || chunks.length === 0) {
        return {
            analysisText: text.slice(0, DIRECT_TEXT_LIMIT),
            usedChunking: false,
            chunkCount: 0,
            retrievedChunkCount: 0,
        };
    }

    const retrievalTerms = buildRetrievalTerms(caseInfo, file);
    const ranked = rankChunksForAnalysis(chunks, retrievalTerms);
    const selected = ranked
        .slice(0, ANALYSIS_RETRIEVAL_LIMIT)
        .map(({ chunk }) => chunk);

    const analysisText = selected
        .map(
            (chunk, index) =>
                `[Chunk ${index + 1} | ${chunk.id || "no-id"}]\n${chunk.text}`,
        )
        .join("\n\n")
        .slice(0, DIRECT_TEXT_LIMIT);

    return {
        analysisText,
        usedChunking: true,
        chunkCount: chunks.length,
        retrievedChunkCount: selected.length,
    };
}

/**
 * Stable reason codes attached to failed extractions so callers (coverage
 * metadata, UI) can distinguish "scanned document" from "corrupt file" from
 * "OCR timed out" instead of collapsing everything into an empty string.
 */
const EXTRACTION_ERROR_CODES = {
    FILE_NOT_FOUND: "file-not-found",
    UNSUPPORTED_TYPE: "unsupported-type",
    PDF_PARSE_FAILED: "pdf-parse-failed",
    DOCX_PARSE_FAILED: "docx-parse-failed",
    DOC_PARSE_FAILED: "doc-parse-failed",
    TXT_READ_FAILED: "txt-read-failed",
    OCR_TIMEOUT: "ocr-timeout",
    OCR_FAILED: "ocr-failed",
    OCR_PARTIAL: "ocr-partial",
};

function buildExtractionResult(overrides = {}) {
    return {
        text: "",
        method: null,
        pages: 0,
        truncated: false,
        error: null,
        ...overrides,
    };
}

// Compact fact line for extraction outcomes, emitted once per analyzed file
// so logs answer "how was this file's text obtained and how much did we
// actually get" without needing debug verbosity.
function summarizeExtraction(extraction) {
    return [
        `method=${extraction?.method || "none"}`,
        `pages=${extraction?.pages ?? 0}`,
        `chars=${(extraction?.text || "").length}`,
        `truncated=${Boolean(extraction?.truncated)}`,
        `error=${extraction?.error || "null"}`,
    ].join(" ");
}

/**
 * Extracts raw text from a file based on its extension.
 * @param {string} filePath
 * @returns {Promise<{text: string, method: string|null, pages: number, truncated: boolean, error: string|null}>}
 * Never rejects: failures are reported via `error` with `text: ""`.
 */
async function extractTextFromFile(filePath) {
    const lowerPath = String(filePath).toLowerCase();

    if (!fs.existsSync(filePath)) {
        return buildExtractionResult({ error: EXTRACTION_ERROR_CODES.FILE_NOT_FOUND });
    }

    try {
        if (lowerPath.endsWith(".pdf")) {
            const data = new Uint8Array(fs.readFileSync(filePath));
            const doc = await pdfjsLib.getDocument({
                data,
                standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
            }).promise;
            const pageTexts = [];
            for (let i = 1; i <= doc.numPages; i++) {
                const page = await doc.getPage(i);
                const content = await page.getTextContent();
                const pageText = content.items
                    .filter((item) => typeof item.str === "string")
                    .map((item) => item.str)
                    .join(" ");
                pageTexts.push(pageText);
            }
            await doc.destroy();
            return buildExtractionResult({
                text: pageTexts.join("\n\n").trim(),
                method: "pdf-text",
                pages: pageTexts.length,
            });
        }
        if (lowerPath.endsWith(".docx")) {
            const result = await mammoth.extractRawText({ path: filePath });
            return buildExtractionResult({
                text: result.value,
                method: "docx",
                pages: 1,
            });
        }
        if (lowerPath.endsWith(".doc")) {
            const extractor = new WordExtractor();
            const doc = await extractor.extract(filePath);
            return buildExtractionResult({
                text: doc.getBody(),
                method: "doc",
                pages: 1,
            });
        }
        if (lowerPath.endsWith(".txt")) {
            return buildExtractionResult({
                text: fs.readFileSync(filePath, "utf8"),
                method: "txt",
                pages: 1,
            });
        }
    } catch (error) {
        let errorCode = EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE;
        if (lowerPath.endsWith(".pdf")) errorCode = EXTRACTION_ERROR_CODES.PDF_PARSE_FAILED;
        else if (lowerPath.endsWith(".docx")) errorCode = EXTRACTION_ERROR_CODES.DOCX_PARSE_FAILED;
        else if (lowerPath.endsWith(".doc")) errorCode = EXTRACTION_ERROR_CODES.DOC_PARSE_FAILED;
        else if (lowerPath.endsWith(".txt")) errorCode = EXTRACTION_ERROR_CODES.TXT_READ_FAILED;
        agentLog.error(
            `Failed to extract text from ${filePath} (error=${errorCode}):`,
            error.message,
        );
        return buildExtractionResult({ error: errorCode });
    }
    return buildExtractionResult({ error: EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE });
}

// --- OCR FALLBACK FUNCTION ---

/**
 * Resolves the OCR page cap at call time so tests (and operators) can tune it
 * via `OCR_MAX_PAGES` without reloading the module. A scanned 100-page PDF
 * would otherwise trigger one Gemini vision call per page.
 */
function resolveOcrMaxPages() {
    const raw = Number.parseInt(process.env.OCR_MAX_PAGES, 10);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 5;
}

function isTimeoutLikeError(err) {
    return /abort|timed out|timeout/i.test(String(err?.message || err || ""));
}

// Vision requests legitimately run longer than text JSON calls: rasterized
// pages upload large payloads and generation is slower. A separate ceiling
// keeps the shared 30s text-call default from starving OCR mid-page.
function resolveOcrTimeoutMs() {
    const raw = Number(process.env.GEMINI_OCR_TIMEOUT_MS);
    return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 90000;
}

// Measured on real e-Oglasna scans: JPEG payloads run ~5x smaller than PNG at
// equal scale (scanner sensor noise defeats deflate), while the per-page
// vision token cost is tile-based and format-independent. The long-edge cap
// only engages for oversized page formats; A4 at scale 2 stays as-is.
const OCR_IMAGE_LONG_EDGE = 2000;

async function renderPageToJpeg(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const longestEdge = Math.max(baseViewport.width, baseViewport.height);
    const scale = longestEdge > OCR_IMAGE_LONG_EDGE
        ? OCR_IMAGE_LONG_EDGE / longestEdge
        : 1;
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toBuffer("image/jpeg");
}

// Page-level OCR memo keyed by document content hash, so transient second-pass
// retries (and re-runs) never re-spend vision quota on pages already read.
// Two tiers: an in-process LRU (L1) in front of a persistent disk store (L2,
// helpers/ocrPageStore.js) so pages survive backend restarts. The store is
// versioned by prompt/model and never fails a run — see its header for the
// invalidation contract.
const OCR_PAGE_CACHE_MAX_ENTRIES = 200;
const ocrPageCache = new Map();

function splitOcrCacheKey(key) {
    const separator = key.lastIndexOf(":");
    if (separator <= 0) return null;
    const pageNumber = Number.parseInt(key.slice(separator + 1), 10);
    if (!Number.isFinite(pageNumber)) return null;
    return { contentHash: key.slice(0, separator), pageNumber };
}

function readCachedOcrPage(key) {
    if (ocrPageCache.has(key)) {
        const value = ocrPageCache.get(key);
        ocrPageCache.delete(key);
        ocrPageCache.set(key, value);
        return value;
    }
    // L2: restart-persistent tier. A hit hydrates L1 and still counts as a
    // cache hit upstream (zero vision spend).
    const parts = splitOcrCacheKey(key);
    if (!parts) return null;
    const fromDisk = ocrPageStore.readOcrPageFromDisk(parts.contentHash, parts.pageNumber);
    if (fromDisk === null) return null;
    agentLog.log(`[OCR] Persistent cache hit: ${parts.contentHash.slice(0, 8)} page ${parts.pageNumber}`);
    ocrPageCache.set(key, fromDisk);
    return fromDisk;
}

function writeCachedOcrPage(key, value) {
    if (ocrPageCache.has(key)) ocrPageCache.delete(key);
    ocrPageCache.set(key, value);
    while (ocrPageCache.size > OCR_PAGE_CACHE_MAX_ENTRIES) {
        ocrPageCache.delete(ocrPageCache.keys().next().value);
    }
    const parts = splitOcrCacheKey(key);
    if (parts) {
        ocrPageStore.writeOcrPageToDisk(parts.contentHash, parts.pageNumber, value);
    }
}

// --- Multi-page batching ---
// One multimodal request carries every pending page image; the model marks
// each section with a `=== STRANICA N ===` header line numbered by the
// image's POSITION in this message (first image = 1). Parsed positions are
// remapped to original document page numbers afterwards: cache hits leave a
// NON-CONTIGUOUS pending set, and the model never sees original numbers, so
// delegating numbering to it would silently shift text across pages. If the
// batch request fails or returns unparseable sections, we fall back to the
// per-page loop — the page cache makes that fallback free for anything the
// batch did deliver.
const OCR_BATCH_MARKER_RE = /^===\s*STRANICA\s+(\d+)\s*===/gim;

function buildOcrBatchInstruction() {
    return (
        "Extract all text from each document image. Images are provided in a fixed order. " +
        "For EACH image, start with a header line exactly '=== STRANICA N ===' " +
        "(N is the 1-based position of that image in THIS message: the first image is 1, the second is 2, and so on), " +
        "followed by that page's raw text on the following lines. " +
        "Provide no commentary outside the page sections."
    );
}

/**
 * Splits a batched OCR response into per-page text segments, aligned to the
 * POSITION of each image in the request (1..expectedPages), not to original
 * document page numbers.
 * @returns {Array<string|null>} null where the model omitted a marker,
 * duplicated one (first occurrence wins), or produced no text for a marked
 * section.
 */
function splitBatchedOcrPages(responseText, expectedPages) {
    const segments = new Array(expectedPages).fill(null);
    const marks = [];
    const re = new RegExp(OCR_BATCH_MARKER_RE.source, "gim");
    let match;
    while ((match = re.exec(String(responseText || ""))) !== null) {
        marks.push({
            pageNumber: Number.parseInt(match[1], 10),
            // Where the next section's header line begins — the correct END
            // of this section's body, so headers never leak into page text.
            headerStart: match.index,
            // Where this section's own text begins (right after its header).
            bodyStart: match.index + match[0].length,
        });
    }
    for (let i = 0; i < marks.length; i++) {
        const { pageNumber, bodyStart } = marks[i];
        if (!(pageNumber >= 1 && pageNumber <= expectedPages)) continue;
        if (segments[pageNumber - 1] !== null) continue;
        const end = i + 1 < marks.length ? marks[i + 1].headerStart : String(responseText).length;
        const body = String(responseText).slice(bodyStart, end).trim();
        segments[pageNumber - 1] = body.length > 0 ? body : null;
    }
    return segments;
}

/**
 * Extracts text from an image-based PDF using pdf.js and Gemini Vision.
 * This method has NO external system dependencies like Ghostscript.
 * @param {string} filePath The path to the PDF file.
 * @param {function} [progressCallback] Receives per-page and retry progress events.
 * @param {{ tracker?: object, onUsage?: function }} [options]
 * @returns {Promise<{text: string, method: string|null, pages: number, truncated: boolean, error: string|null}>}
 * Never rejects: failures are reported via `error` with `text: ""`.
 */
async function extractTextViaOCR(filePath, progressCallback, options = {}) {
    agentLog.log(
        `[OCR] Attempting OCR for ${path.basename(filePath)} with pdf.js`,
    );
    let pagesProcessed = 0;
    // Hoisted so the outer failure path can still report how many pages made
    // it into memory before the error.
    const pageTexts = new Map();

    try {
        const fileBytes = fs.readFileSync(filePath);
        const contentHash = crypto.createHash("sha256").update(fileBytes).digest("hex");
        const pdf = await pdfjsLib.getDocument({
            data: new Uint8Array(fileBytes),
            standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
        }).promise;
        const numPages = pdf.numPages;
        const maxPages = Math.min(numPages, resolveOcrMaxPages());

        // Cache-first: whatever this process already read costs nothing.
        const pendingPageNumbers = [];
        let cachedPagesHit = 0;
        for (let i = 1; i <= maxPages; i++) {
            const cached = readCachedOcrPage(`${contentHash}:${i}`);
            if (cached === null) pendingPageNumbers.push(i);
            else {
                pageTexts.set(i, cached);
                cachedPagesHit += 1;
            }
        }

        // Batch attempt: every pending page in ONE multimodal request. Only
        // taken when more than one page is missing — a single page gains
        // nothing from batching and would only add marker-parsing risk.
        if (pendingPageNumbers.length > 1) {
            progressCallback &&
                progressCallback({
                    step: "analyzing",
                    message: `OCR: šaljem ${pendingPageNumbers.length} stranica u jednom zahtjevu (${path.basename(filePath)})...`,
                });
            try {
                const content = [
                    { type: "text", text: buildOcrBatchInstruction() },
                ];
                for (const pageNumber of pendingPageNumbers) {
                    const page = await pdf.getPage(pageNumber);
                    const imageBuffer = await renderPageToJpeg(page);
                    content.push({
                        type: "image_url",
                        image_url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                    });
                }
                const message = new HumanMessage({ content });

                const response = await withGeminiRetry(
                    () => withGeminiTimeout(
                        (signal) => trackGeminiInvoke(ocrBatchGemini, [message], { signal, tracker: options.tracker, onUsage: options.onUsage }),
                        { timeoutMs: resolveOcrTimeoutMs() },
                    ),
                    {
                        onRetry: ({ attempt, delayMs }) => {
                            progressCallback &&
                                progressCallback({
                                    step: "ocr_retry",
                                    message: `OCR batch retry ${attempt}. Waiting ${Math.round(delayMs / 1000)}s...`,
                                });
                        },
                    },
                );

                // Segments are aligned to image POSITIONS in the request;
                // remap each position to its original document page number.
                const segments = splitBatchedOcrPages(response?.content, pendingPageNumbers.length);
                let batchCovered = 0;
                pendingPageNumbers.forEach((pageNumber, positionIndex) => {
                    const segment = segments[positionIndex];
                    if (typeof segment === "string") {
                        pageTexts.set(pageNumber, segment);
                        writeCachedOcrPage(`${contentHash}:${pageNumber}`, segment);
                        batchCovered += 1;
                    }
                });
                agentLog.log(
                    `[OCR] Batch request covered ${batchCovered}/${pendingPageNumbers.length} pending pages.`,
                );
            } catch (batchErr) {
                agentLog.error(
                    `[OCR] Batch request failed for ${filePath}:`,
                    batchErr?.name === "AbortError" ? batchErr.message : batchErr,
                );
                agentLog.log("[OCR] Falling back to per-page OCR.");
            }
        }

        // Sequential fill for single-page documents and anything the batch
        // left unresolved. Partial-yield semantics per page.
        let firstFailure = null;
        for (let i = 1; i <= maxPages; i++) {
            if (pageTexts.has(i)) continue;

            progressCallback &&
                progressCallback({
                    step: "analyzing",
                    message: `OCR: čitam stranicu ${i}/${maxPages} (${path.basename(filePath)})...`,
                });

            // Page acquisition, rendering, and the vision call all sit inside
            // the same guard: any of them failing yields the pages already
            // read instead of discarding them.
            try {
                const page = await pdf.getPage(i);
                const imageBuffer = await renderPageToJpeg(page);

                const message = new HumanMessage({
                    content: [
                        {
                            type: "text",
                            text: "Extract all text from this document image. Provide only the raw text.",
                        },
                        {
                            type: "image_url",
                            image_url: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
                        },
                    ],
                });

                const response = await withGeminiRetry(
                    () => withGeminiTimeout(
                        (signal) => trackGeminiInvoke(ocrGemini, [message], { signal, tracker: options.tracker, onUsage: options.onUsage }),
                        { timeoutMs: resolveOcrTimeoutMs() },
                    ),
                    {
                        onRetry: ({ attempt, delayMs }) => {
                            progressCallback &&
                                progressCallback({
                                    step: "ocr_retry",
                                    message: `OCR retry ${attempt}. Waiting ${Math.round(delayMs / 1000)}s...`,
                                });
                        },
                    },
                );
                const pageText = String(response?.content || "");
                pageTexts.set(i, pageText);
                writeCachedOcrPage(`${contentHash}:${i}`, pageText);
            } catch (pageErr) {
                agentLog.error(
                    `[OCR] Page ${i}/${maxPages} failed for ${filePath}:`,
                    pageErr?.name === "AbortError" ? pageErr.message : pageErr,
                );
                firstFailure = pageErr;
                break;
            }
        }

        // Assemble in page order and report exactly what was obtained.
        const obtainedPages = [...pageTexts.keys()].sort((a, b) => a - b);
        pagesProcessed = obtainedPages.length;

        if (pagesProcessed === 0) {
            throw firstFailure || new Error("No OCR pages were processed.");
        }

        const combinedText = obtainedPages.map((pageNumber) => pageTexts.get(pageNumber)).join("\n\n") + "\n\n";
        const truncated = numPages > maxPages;

        if (firstFailure || pagesProcessed < maxPages) {
            agentLog.log(
                `[OCR] Returning partial result: ${pagesProcessed}/${maxPages} pages extracted` +
                    `${firstFailure ? " after a page failure" : ""}.`,
            );
            return buildExtractionResult({
                text: combinedText.trim(),
                method: "ocr",
                pages: pagesProcessed,
                truncated,
                error: EXTRACTION_ERROR_CODES.OCR_PARTIAL,
            });
        }

        agentLog.log(
            `[OCR] Extracted ~${combinedText.length} chars from ${pagesProcessed}/${numPages} pages` +
                (cachedPagesHit > 0 ? ` (${cachedPagesHit} from cache)` : "") +
                `${truncated ? ` (capped at OCR_MAX_PAGES=${maxPages})` : ""}.`,
        );
        return buildExtractionResult({
            text: combinedText.trim(),
            method: "ocr",
            pages: pagesProcessed,
            truncated,
        });
    } catch (err) {
        // Timeout aborts carry only internal timer frames from the timeout
        // guard — their stack is pure noise. Log the message alone and keep
        // full stacks/inspect formatting for unexpected errors.
        agentLog.error(
            `[OCR] Failed during OCR process for ${filePath}:`,
            err?.name === "AbortError" ? err.message : err,
        );
        // Whatever reached memory before the failure still counts.
        pagesProcessed = Math.max(pagesProcessed, pageTexts.size);
        return buildExtractionResult({
            method: "ocr",
            pages: pagesProcessed,
            error: isTimeoutLikeError(err)
                ? EXTRACTION_ERROR_CODES.OCR_TIMEOUT
                : EXTRACTION_ERROR_CODES.OCR_FAILED,
        });
    }
}

/**
 * Turns an extraction failure into a precise, user-facing message. The
 * "Could not extract text from file" prefix is kept stable because downstream
 * classification (e.g. transient-failure detection) matches on it.
 */
function describeExtractionFailure(extraction) {
    switch (extraction?.error) {
        case EXTRACTION_ERROR_CODES.FILE_NOT_FOUND:
            return "file not found.";
        case EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE:
            return "unsupported file type.";
        case EXTRACTION_ERROR_CODES.PDF_PARSE_FAILED:
            return "the PDF could not be parsed (it may be corrupt or unreadable).";
        case EXTRACTION_ERROR_CODES.DOCX_PARSE_FAILED:
            return "the DOCX could not be parsed.";
        case EXTRACTION_ERROR_CODES.DOC_PARSE_FAILED:
            return "the DOC could not be parsed.";
        case EXTRACTION_ERROR_CODES.TXT_READ_FAILED:
            return "the text file could not be read.";
        case EXTRACTION_ERROR_CODES.OCR_TIMEOUT:
            return "OCR timed out while reading the scanned document.";
        case EXTRACTION_ERROR_CODES.OCR_PARTIAL:
            // Reachable on the empty-partial edge: a page can come back from
            // the model as whitespace, producing a partial result whose
            // combined text is still empty.
            return "OCR extracted only part of the scanned document before being interrupted.";
        case EXTRACTION_ERROR_CODES.OCR_FAILED:
            return "OCR failed while reading the scanned document.";
        default:
            return "no readable text was found in the document.";
    }
}

function buildExtractionErrorMessage(extraction) {
    return `Could not extract text from file: ${describeExtractionFailure(extraction)}`;
}

class AnalyzeDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = "analyze_documents_for_one_case";
        this.description =
            "Analyzes a set of documents related to a single court case entry and returns structured info for each.";
    }

    async _call(input) {
        const { files, caseInfo, progressCallback, usageTracker, onUsage } = input;

        // Live-activity tracking: structured per-file events plus a periodic
        // heartbeat so the UI can show real progress (and detect stalls)
        // during long batches instead of silence.
        const total = Array.isArray(files) ? files.length : 0;
        const batchCounters = { done: 0, failed: 0 };
        let currentFileName = null;

        const emitFileEvent = (file, status, extra = {}) => {
            const classified = status === "failed"
                ? classifyFileFailure(extra.error)
                : null;
            progressCallback &&
                progressCallback({
                    step: "analyzing",
                    kind: "file",
                    message: status === "ok"
                        ? `Analiziran dokument ${batchCounters.done + batchCounters.failed}/${total}: ${file.text || path.basename(file.filePath || "")}`
                        : `Neuspješna analiza ${batchCounters.done + batchCounters.failed}/${total}: ${file.text || path.basename(file.filePath || "")}`,
                    metadata: {
                        kind: "file",
                        fileName: file.text || path.basename(file.filePath || ""),
                        status,
                        done: batchCounters.done,
                        failed: batchCounters.failed,
                        total,
                        ...(classified ? { reasonCode: classified.code, reason: classified.reason } : {}),
                        ...extra,
                    },
                });
        };

        const emitHeartbeat = () => {
            progressCallback &&
                progressCallback({
                    step: "analyzing",
                    kind: "heartbeat",
                    metadata: {
                        kind: "heartbeat",
                        done: batchCounters.done,
                        failed: batchCounters.failed,
                        total,
                        currentFile: currentFileName,
                    },
                });
        };

        const heartbeatTimer = total > 0 ? setInterval(emitHeartbeat, ANALYSIS_HEARTBEAT_MS) : null;

        const analyzeFile = async (file, { retried = false } = {}) => {
            const startedAt = Date.now();
            currentFileName = file.text || path.basename(file.filePath || "");
            // Ground-truth chunks (Phase 0.1) are captured as soon as full text
            // exists and attached to the result on BOTH outcomes: success and
            // analysis-failure-with-extracted-text. Quota-failed files whose
            // OCR text is already paid for are precisely the worst-covered
            // documents — dropping their chunks there would re-create the
            // grounding gap for the clusters that need grounding most.
            let retrievalChunks = null;
            try {
                let extraction = await extractTextFromFile(file.filePath);
                let text = extraction.text;

                // If the PDF has no usable text, try OCR. The two reasons are
                // logged separately on purpose: a parse error (corrupt or
                // unreadable structure) is a different situation from an
                // empty text layer, which is just a normal scanned document.
                if (
                    (!text || text.trim().length === 0) &&
                    file.filePath.toLowerCase().endsWith(".pdf")
                ) {
                    agentLog.log(
                        extraction.error
                            ? `[Analyzer] Text extraction failed for ${path.basename(file.filePath)} (error=${extraction.error}); trying OCR fallback`
                            : `[Analyzer] No embedded text layer in ${path.basename(file.filePath)} (likely scanned); trying OCR fallback`,
                    );
                    const ocrResult = await extractTextViaOCR(file.filePath, progressCallback, { tracker: usageTracker, onUsage });
                    if (ocrResult.text && ocrResult.text.trim().length > 0) {
                        text = ocrResult.text;
                        extraction = ocrResult;
                    } else if (!extraction.error) {
                        // The text layer was empty (likely a scanned document)
                        // and OCR could not rescue it — surface WHY it failed
                        // instead of a generic "may be empty or corrupt".
                        extraction = { ...extraction, error: ocrResult.error || EXTRACTION_ERROR_CODES.OCR_FAILED };
                    }
                }

                agentLog.log(
                    `[Extractor] ${path.basename(file.filePath)}: ${summarizeExtraction(extraction)}`,
                );

                // Final check: if still no text, return error, file failed analysis
                if (!text || text.trim().length === 0) {
                    throw new Error(buildExtractionErrorMessage(extraction));
                }

                // Full text exists — capture the capped ground-truth chunk set
                // now while the document content is in hand.
                retrievalChunks = buildRetrievalChunks(text, {
                    docId: path.basename(file?.filePath || file?.text || "analysis-doc"),
                });

                //console.log('Case info for analysis:', caseInfo);

                const knownParties = caseInfo.participants
                    ? caseInfo.participants.map(p => {
                        let info = `- ${p.name} (${p.role})`;
                        if (p.companyData) {
                            const cd = p.companyData;
                            info += `\n  - Official Name: ${cd.officialName}`;
                            info += `\n  - Status: ${cd.status === 1 ? 'Active' : cd.status === 5 ? 'Deleted' : cd.status}`;
                            if (cd.lastFinancialReportYear) info += `\n  - Last GFI Year: ${cd.lastFinancialReportYear}`;
                            if (cd.founders) info += `\n  - Founders: ${cd.founders}`;
                            if (cd.directors) info += `\n  - Directors: ${cd.directors}`;
                        }
                        return info;
                    }).join('\n')
                    : "Participant information was not available from the source page.";

                const analysisInput = buildAnalysisInputText(text, caseInfo, file);
                if (analysisInput.usedChunking) {
                    progressCallback &&
                        progressCallback({
                            step: "chunking",
                            message: `Chunked ${file.text} into ${analysisInput.chunkCount} chunks.`,
                        });
                    progressCallback &&
                        progressCallback({
                            step: "retrieving",
                            message: `Retrieved ${analysisInput.retrievedChunkCount} relevant chunks for ${file.text}.`,
                        });
                }

                //console.log(`Analyzing text from file: ${file.filePath}, the text length is: ${text.length}`);
                // alt prompt: a medium-sized paragraph, two at most, ...
                const prompt = `The main participants in this case are:\n${knownParties}\n
                The participants include enriched registry data. Use this to determine if a company is active, in bankruptcy, or has failed to file financial reports (GFI) recently.

                From the court document text below, extract key information as a JSON object with the following keys: "caseNumber", "decisionDate", and "summary" (a medium-sized paragraph, nicely formatted, to be in Croatian please, as that is what our customers speak).
                Do include any important figures (currency amounts) you find in the summary.
                Also extract any financial amounts (payments, claims, costs, reservations) into an optional "amounts" array, each item being a JSON object with: "description" (what the money is for, in Croatian), "amount" (number), "currency" ("EUR" or "HRK"), "date" (if known), and "quote" (a verbatim supporting quote copied exactly from the source text below that proves this amount; copy 1-2 sentences word-for-word, do not paraphrase). If the document contains no amounts, set "amounts" to an empty array.
                Also extract any property/asset transactions (real estate sales, movable-asset sales, receivable assignments/cessions) into an optional "propertyFlow" array, each item being a JSON object with: "description" (what the asset is, in Croatian), "identifier" (cadastral parcel, registration number, or null when absent), "assetType" (one of "nekretnina" | "pokretnina" | "tražbina" | "drugo"), "transferor" (seller/assignor, if known), "transferee" (buyer/assignee, if known), "value" (number, if known), "currency" ("EUR" or "HRK", if known), "date" (if known), and "quote" (verbatim supporting quote as above). For assetType "tražbina" (receivable/claim, e.g. "Ugovor o ustupu tražbina") additionally include "eventType" (one of "prijava" | "ustup" | "namirenje" | "drugo" — the lifecycle stage) and, when this entry continues an earlier lifecycle stage of the SAME receivable described in the analysed documents, "supersedes" (a short textual reference to that earlier entry, e.g. its description, case number, filing date or original creditor as cited in the source text). If the document contains no property transactions, set "propertyFlow" to an empty array.
                Provide ONLY the json object and nothing else. Text:\n\n${analysisInput.analysisText}`;

                const response = await withGeminiRetry(
                    () => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: usageTracker, onUsage })),
                    {
                        onRetry: ({ attempt, delayMs }) => {
                            progressCallback &&
                                progressCallback({
                                    step: "analyze_retry",
                                    message: `Retry ${attempt} for ${file.text}. Waiting ${Math.round(delayMs / 1000)}s...`,
                                });
                        },
                    },
                );

                // Recovery-parse the paid-for completion instead of failing
                // the file on fence markers or chatter around the JSON.
                const aiResultPartial = extractJsonBlock(response.content);

                if (
                    !aiResultPartial ||
                    typeof aiResultPartial !== "object" ||
                    Array.isArray(aiResultPartial)
                ) {
                    agentLog.warn(outputCapWarning("analysis"));
                    throw new Error(
                        `AI returned non-JSON response: "${String(response?.content || "").slice(0, 100)}..."`,
                    );
                }

                const aiResult = {
                    ...aiResultPartial,
                    // Inject the reliably scraped parties into the final result object.
                    parties: caseInfo.participants || [],
                };
                // Property flow is additive: a missing/malformed array from the
                // model degrades to [] (same empty-array fallback as amounts).
                if (!Array.isArray(aiResult.propertyFlow)) {
                    aiResult.propertyFlow = [];
                }
                if (!Array.isArray(aiResult.amounts)) {
                    aiResult.amounts = [];
                }
                // Per-document grounding check (deterministic containment,
                // never an LLM judge): verify each quote against the FULL
                // extracted source text and mark grounded true/false. A miss
                // never fails the run — it degrades to a UI-visible signal.
                try {
                    applyGroundingToAnalysis(aiResult, text);
                } catch (groundingErr) {
                    agentLog.warn(`[Analyzer] Grounding check failed gracefully for ${file.filePath}: ${groundingErr?.message || groundingErr}`);
                }
                // END of fix

                // added by a human
                agentLog.log(
                    `Analyzed file ${file.filePath}, AI result:`,
                    aiResult,
                );

                batchCounters.done += 1;
                emitFileEvent(file, "ok", {
                    durationMs: Date.now() - startedAt,
                    retried,
                });
                return {
                    ...file,
                    aiResult,
                    ...(retrievalChunks ? { retrievalChunks } : {}),
                };
            } catch (err) {
                agentLog.error(
                    `Error analyzing file ${file.filePath}:`,
                    err.message,
                );
                batchCounters.failed += 1;
                emitFileEvent(file, "failed", {
                    durationMs: Date.now() - startedAt,
                    retried,
                    error: err.message,
                });
                // Chunk-only branch: the AI result is gone but the extracted
                // text was real — keep its chunks so the reasoning index can
                // still ground findings in this document's content.
                return {
                    ...file,
                    aiResult: null,
                    error: err.message,
                    ...(retrievalChunks ? { retrievalChunks } : {}),
                };
            }
        };

        try {
            // First pass with bounded concurrency so a parallel fan-out of
            // every file in the batch does not burst the provider's rate limits.
            const firstPassResults = await mapWithConcurrency(
                files,
                ANALYSIS_FILE_CONCURRENCY,
                analyzeFile,
                { delayMs: ANALYSIS_FILE_DELAY_MS }
            );

            // Deferred second pass: retry only files that failed with transient
            // (recoverable) Gemini errors, e.g. quota-burst timeouts. Structural
            // failures (unreadable/corrupt files) are not retried — retrying them
            // would only burn the remaining budget.
            const retryableIndexes = firstPassResults
                .map((result, index) => ({ result, index }))
                .filter(({ result }) => !result.aiResult && isTransientAnalysisFailure(result.error))
                .map(({ index }) => index);

            let individualAnalyses = firstPassResults;
            if (retryableIndexes.length > 0) {
                agentLog.log(`[Analyzer] ${retryableIndexes.length} file(s) failed with transient errors; retrying sequentially...`);
                const retryFiles = retryableIndexes.map((index) => files[index]);
                const retryResults = await mapWithConcurrency(
                    retryFiles,
                    1,
                    (file) => analyzeFile(file, { retried: true }),
                    { delayMs: ANALYSIS_FILE_DELAY_MS }
                );
                retryResults.forEach((result, position) => {
                    individualAnalyses[retryableIndexes[position]] = result;
                });
            }

            return {
                individualAnalyses,
                coverage: buildAnalysisCoverage(individualAnalyses),
            };
        } finally {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Maps `worker` over `items` with bounded concurrency, preserving input order.
 * Each worker is wrapped so a single rejection does not kill the batch; the
 * returned array contains whatever each item resolved/rejected to.
 * @param {Array} items
 * @param {number} concurrency
 * @param {(item: any) => Promise<any>} worker
 * @param {{ delayMs?: number }} [options]
 * @returns {Promise<Array>}
 */
async function mapWithConcurrency(items, concurrency, worker, options = {}) {
    const { delayMs = 0 } = options;
    const safeWorker = async (item) => {
        try {
            return await worker(item);
        } catch (err) {
            return { error: err.message || String(err) };
        }
    };

    const results = new Array(items.length);
    let nextIndex = 0;

    const boundedLoop = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            if (delayMs > 0 && index > 0) {
                await sleep(delayMs);
            }
            results[index] = await safeWorker(items[index]);
        }
    };

    const poolSize = Math.max(1, Math.min(concurrency || 1, items.length));
    await Promise.all(Array.from({ length: poolSize }, () => boundedLoop()));

    return results;
}

function isTransientAnalysisFailure(errorMessage) {
    const message = String(errorMessage || "").toLowerCase();
    return /abort|timed out|timeout|429|rate limit|overloaded|too many requests|resource has been exhausted/i.test(message);
}

function buildAnalysisCoverage(individualAnalyses) {
    const total = Array.isArray(individualAnalyses) ? individualAnalyses.length : 0;
    const analyzed = (individualAnalyses || []).filter((item) => Boolean(item?.aiResult));
    const failed = (individualAnalyses || []).filter((item) => !item?.aiResult);
    const coverageRatio = total > 0 ? Number((analyzed.length / total).toFixed(2)) : 0;

    // Grounding dimension: counted across amounts[] + propertyFlow[] entries
    // whose quote verified (grounded:true). Pure additive signal.
    let groundedClaims = 0;
    let totalClaims = 0;
    for (const item of analyzed) {
        for (const key of ['amounts', 'propertyFlow']) {
            const entries = item?.aiResult?.[key];
            if (!Array.isArray(entries)) continue;
            for (const entry of entries) {
                totalClaims += 1;
                if (entry?.grounded === true) groundedClaims += 1;
            }
        }
    }

    return {
        analyzed: analyzed.length,
        failed: failed.length,
        total,
        coverageRatio,
        complete: total > 0 && analyzed.length === total,
        groundedClaims,
        totalClaims,
        failedFiles: failed.map((item) => {
            const classified = classifyFileFailure(item?.error);
            return {
                fileName: item?.text || item?.filePath || "nepoznata datoteka",
                code: classified.code,
                reason: classified.reason,
            };
        }),
    };
}

// Test-only escape hatch: the page cache is module-global, so suites that
// exercise extraction must reset it to stay isolated from one another.
function resetOcrPageCacheForTests() {
    ocrPageCache.clear();
}

module.exports = {
    AnalyzeDocumentsTool,
    extractTextFromFile,
    extractTextViaOCR,
    resetOcrPageCacheForTests,
};
