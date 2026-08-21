// analysis-agent.js

require("dotenv").config();
const { Tool } = require("@langchain/core/tools");
const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
const { HumanMessage } = require("@langchain/core/messages");
const fs = require("fs");
const os = require("os");
const path = require("path");
const mammoth = require("mammoth");
const WordExtractor = require("word-extractor");
const { splitTextIntoChunks } = require("../reasoning/chunker");
const agentLog = require("../../helpers/agentLog");

const { GEMINI_MODEL, GEMINI_API_KEY } = require("../../helpers/geminiConfig");
const gemini = new ChatGoogleGenerativeAI({
    model: GEMINI_MODEL,
    apiKey: GEMINI_API_KEY,
});

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

// Pacing for document analysis. Free-tier quota is exhausted the moment many
// files hit Gemini in parallel, so within a batch we process files with bounded
// concurrency. On the free plan keep it serial; on a paid key allow more.
const ANALYSIS_FILE_CONCURRENCY = (() => {
    const raw = Number(process.env.ANALYSIS_FILE_CONCURRENCY);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1;
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
        agentLog.error(
            `Failed to extract text from ${filePath}:`,
            error.message,
        );
        let errorCode = EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE;
        if (lowerPath.endsWith(".pdf")) errorCode = EXTRACTION_ERROR_CODES.PDF_PARSE_FAILED;
        else if (lowerPath.endsWith(".docx")) errorCode = EXTRACTION_ERROR_CODES.DOCX_PARSE_FAILED;
        else if (lowerPath.endsWith(".doc")) errorCode = EXTRACTION_ERROR_CODES.DOC_PARSE_FAILED;
        else if (lowerPath.endsWith(".txt")) errorCode = EXTRACTION_ERROR_CODES.TXT_READ_FAILED;
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
    let combinedText = "";
    let pagesProcessed = 0;

    try {
        const data = new Uint8Array(fs.readFileSync(filePath));
        const pdf = await pdfjsLib.getDocument({
            data,
            standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
        }).promise;
        const numPages = pdf.numPages;
        const maxPages = Math.min(numPages, resolveOcrMaxPages());

        for (let i = 1; i <= maxPages; i++) {
            progressCallback &&
                progressCallback({
                    step: "analyzing",
                    message: `OCR: čitam stranicu ${i}/${maxPages} (${path.basename(filePath)})...`,
                });
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale = higher resolution image
            const canvas = createCanvas(viewport.width, viewport.height);
            const context = canvas.getContext("2d");

            await page.render({ canvasContext: context, viewport: viewport })
                .promise;

            const imageBuffer = canvas.toBuffer("image/png");
            const imageAsBase64 = imageBuffer.toString("base64");

            const message = new HumanMessage({
                content: [
                    {
                        type: "text",
                        text: "Extract all text from this document image. Provide only the raw text.",
                    },
                    {
                        type: "image_url",
                        image_url: `data:image/png;base64,${imageAsBase64}`,
                    },
                ],
            });

            const response = await withGeminiRetry(
                () => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, [message], { signal, tracker: options.tracker, onUsage: options.onUsage })),
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
            combinedText += response.content + "\n\n";
            pagesProcessed = i;
        }

        const truncated = numPages > maxPages;
        if (truncated) {
            agentLog.log(
                `[OCR] Page cap reached: processed ${maxPages} of ${numPages} pages (OCR_MAX_PAGES).`,
            );
        }

        agentLog.log(
            `[OCR] Successfully extracted ~${combinedText.length} characters.`,
        );
        return buildExtractionResult({
            text: combinedText.trim(),
            method: "ocr",
            pages: pagesProcessed,
            truncated,
        });
    } catch (err) {
        agentLog.error(`[OCR] Failed during OCR process for ${filePath}:`, err);
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
            try {
                let extraction = await extractTextFromFile(file.filePath);
                let text = extraction.text;

                // If initial extraction fails, try OCR for PDFs
                if (
                    (!text || text.trim().length === 0) &&
                    file.filePath.toLowerCase().endsWith(".pdf")
                ) {
                    agentLog.log(
                        `[Analyzer] Standard text extraction failed for ${path.basename(file.filePath)}. Falling back to OCR.`,
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

                // Final check: if still no text, return error, file failed analysis
                if (!text || text.trim().length === 0) {
                    throw new Error(buildExtractionErrorMessage(extraction));
                }

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
                Also extract any financial amounts (payments, claims, costs, reservations) into an optional "amounts" array, each item being a JSON object with: "description" (what the money is for, in Croatian), "amount" (number), "currency" ("EUR" or "HRK"), and "date" (if known). If the document contains no amounts, set "amounts" to an empty array.
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

                // --- THIS IS THE FIX ---
                // 1. Get the raw content from the AI.
                const rawContent = response.content;

                // 2. Clean the string by removing the Markdown wrapper.
                const cleanedContent = rawContent
                    .replace(/```json\n|```/g, "")
                    .trim();

                // Added an extra check to see if the response looks like JSON before parsing
                if (
                    !cleanedContent.startsWith("{") ||
                    !cleanedContent.endsWith("}")
                ) {
                    throw new Error(
                        `AI returned non-JSON response: "${cleanedContent.slice(0, 100)}..."`,
                    );
                }

                // 3. Parse the CLEANED string.
                const aiResultPartial = JSON.parse(cleanedContent);

                const aiResult = {
                    ...aiResultPartial,
                    // Inject the reliably scraped parties into the final result object.
                    parties: caseInfo.participants || [],
                };
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
                return { ...file, aiResult };
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
                return { ...file, aiResult: null, error: err.message };
            }
        };

        try {
            // First pass with bounded concurrency so free-tier quota is not
            // exhausted by a parallel fan-out of every file in the batch.
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

    return {
        analyzed: analyzed.length,
        failed: failed.length,
        total,
        coverageRatio,
        complete: total > 0 && analyzed.length === total,
        failedFiles: failed.map((item) => ({
            fileName: item?.text || item?.filePath || "nepoznata datoteka",
            reason: item?.error || "nepoznata greška",
        })),
    };
}

// --- NEW FUNCTION FOR THE FINAL STEP ---

/**
 * Generates a high-level comparative analysis or a detailed summary.
 * @param {Array<object>} allProcessedCases - The array of fully processed cases from the pipeline.
 * @returns {Promise<string>} The final comparative analysis text.
 */
async function generateComparativeAnalysis(allProcessedCases, options = {}) {
    if (!allProcessedCases || allProcessedCases.length === 0) {
        return "Nema dostupnih podataka za generiranje analize.";
    }

    // --- SCENARIO 1: Only ONE case entry was processed ---
    if (allProcessedCases.length === 1) {
        const singleCase = allProcessedCases[0];
        const successfulSummaries = singleCase.analysis.individualAnalyses
            .filter((f) => f.aiResult && f.aiResult.summary)
            .map((f) => f.aiResult.summary)
            .join("\n\n---\n\n");

        if (!successfulSummaries) {
            return "Analiza dokumenata nije uspješno izvršena za jedinu pronađenu objavu.";
        }

        // Old prompt was:
        const prompt = `Synthesize the following summaries into a coherent overview (in Croatian):\n\n${successfulSummaries}. 
        Try to extrapolate what might happen next in the case going forward, and what the next steps are for the parties involved.`;

        // The prompt is slightly different: it asks for a deep dive and next steps, not a comparison.
        //const prompt = `This is the only recent court entry found. Synthesize the following document summaries into a single, coherent, and detailed overview IN CROATIAN. Explain the significance of this entry in the context of the case. Based on the information, what are the likely next steps for the parties involved?\n\nSUMMARIES:\n${successfulSummaries}`;

        try {
            const response = await withGeminiRetry(() => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })));
            return response.content;
        } catch (err) {
            agentLog.error("Failed to generate summary for single case:", err);
            return "Greška pri generiranju završnog sažetka.";
        }
    }

    // --- SCENARIO 2: MULTIPLE case entries were processed ---
    // This is where the real comparison happens.
    let comparativeContext = "";
    allProcessedCases.forEach((processedCase, index) => {
        const caseInfo = processedCase.caseResult;
        const summaries = processedCase.analysis.individualAnalyses
            .filter((f) => f.aiResult && f.aiResult.summary)
            .map((f) => f.aiResult.summary)
            .join("\n");

        comparativeContext += `--- Case Entry ${index + 1} ---\n`;
        comparativeContext += `Title: ${caseInfo.title}\n`;
        comparativeContext += `Date: ${caseInfo.date}\n`;
        comparativeContext += `Summary of Documents:\n${summaries}\n\n`;
    });

    // const prompt = `You are a legal analyst assistant. Below are summaries from documents of ${allProcessedCases.length} different court entries for the same case. Please provide a comparative analysis IN CROATIAN.
    // Your analysis should:
    // 1.  Start by focusing on the most recent entry, explaining its significance.
    // 2.  Compare it to the previous entry/entries, highlighting what has changed or progressed.
    // 3.  Synthesize the information into a single, overarching narrative of what has happened.
    // 4.  Based on the entire history, predict the most likely next steps or future developments in the case.

    // Here is the data:
    // ${comparativeContext}`;

    const prompt = `Synthesize the following ${allProcessedCases.length} summaries into a coherent overview, in Croatian. Try to predict the most likely developments in the case, as well as what the next steps are for the parties involved.
    Here is the data:\n${comparativeContext}.`;

    //console.log("Comparative context contains the following data:", comparativeContext);

    try {
        const response = await withGeminiRetry(() => withGeminiTimeout((signal) => trackGeminiInvoke(gemini, prompt, { signal, tracker: options.tracker, onUsage: options.onUsage })));
        return response.content;
    } catch (err) {
        agentLog.error("Failed to generate comparative analysis:", err);
        return "Greška pri generiranju usporedne analize.";
    }
}

module.exports = { AnalyzeDocumentsTool, generateComparativeAnalysis, extractTextFromFile, extractTextViaOCR };
