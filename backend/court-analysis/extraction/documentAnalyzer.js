'use strict';

require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const logger = require('../../services/logger');
const { buildRetrievalChunks } = require('../reasoning/retrieval/chunker');
const { applyGroundingToAnalysis } = require('../reasoning/ledger/grounding');
const {
    validateExtraction,
    parseFieldRepairResponse,
    hasUsableExtraction,
    hasReceivableAssignmentCue,
    REPAIRABLE_FIELDS,
    EXTRACTION_SCHEMA_VERSION,
} = require('../reasoning/schema/extractionSchema');
const {
    PROMPT_HASH_V5,
    EXTRACTION_SIGNATURE_V5,
    buildAnalysisMessages,
    buildFieldRepairPrompt,
    buildFullRepairPrompt,
} = require('./prompts');
const {
    EXTRACTION_ERROR_CODES,
    extractTextFromFile,
    isPdfJsMocked,
    pageRangesFromMarkedText,
    pageNumbersForRange,
} = require('./pdfText');
const { runPdfPreflight } = require('./pdfPreflight');
const { canUseAdminFastPath, extractAdminNoticeFastPath } = require('./adminFastPath');
const { transcribeDocumentViaStageT, extractTextViaOCR } = require('./ocrRouter');
const { mergeAnalysisChunkResults } = require('./chunkMerge');
const { deriveEntryDisplayId } = require('../utils/entryDisplayId');
const { createOpenRouterRoleClient, outputCapWarning, resolveRoleConfig } = require('../../llm/openrouterConfig');
const openrouterClientModule = require('../../llm/openrouterClient');
const { createOpenRouterClient } = openrouterClientModule;
const { createTaskRouter } = require('../../llm/taskRouter');
const { createCreditExhaustedLatch, isCreditExhaustedError } = require('../../llm/creditLatch');
const {
    buildAdaptiveSegments,
    resolveTokenBudget,
    analyzeCompletionTelemetry,
    bisectSegmentOnNewline,
} = require('../../llm/tokenBudgetPolicy');
const usageModule = require('../../llm/usage');
const { trackUsageInvoke } = usageModule;
const { withGeminiRetry, withGeminiTimeout } = require('../../llm/retry');
const { extractJsonBlock, modelContentToText } = require('../../helpers/jsonExtract');
const { classifyFileFailure, classifyFileFailureDetailed } = require('../../http/friendlyAnalysisError');
const { buildStageCounterEvent } = require('../../http/analysisStage');

const ANALYSIS_FILE_CONCURRENCY = (() => {
    const raw = Number(process.env.ANALYSIS_FILE_CONCURRENCY);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 4;
})();
const ANALYSIS_FILE_DELAY_MS = (() => {
    const raw = Number(process.env.ANALYSIS_FILE_DELAY_MS);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
})();
const ANALYSIS_HEARTBEAT_MS = (() => {
    const raw = Number(process.env.ANALYSIS_HEARTBEAT_MS);
    return Number.isFinite(raw) && raw >= 1000 ? raw : 45000;
})();
const MAX_BENCH_CANDIDATES_PER_RUN = 5;

function throwIfSignalAborted(signal) {
    if (signal?.aborted) {
        throw signal.reason || Object.assign(new Error('Analysis aborted.'), { name: 'AbortError' });
    }
}

function isUsingMockLlm() {
    return Boolean(
        !openrouterClientModule.OPENROUTER_URL
        || typeof usageModule.createUsageTracker !== 'function'
        || createOpenRouterClient?._isMockFunction
        || trackUsageInvoke?._isMockFunction,
    );
}

function computeStableDocId(file, contentHash = null) {
    const base = contentHash || file?.filePath || path.basename(file?.text || 'analysis-doc');
    const linkId = file?.sourceDocumentLinkId || file?.documentLinkId || '';
    const entryIndex = file?.sourceEntryIndex ?? file?.entryIndex ?? '';
    return crypto.createHash('sha256')
        .update([base, linkId, entryIndex].join('\0'))
        .digest('hex');
}

function buildCheckpointKey({ contentHash, segmentId, modelId }) {
    return crypto.createHash('sha256')
        .update([contentHash, segmentId, modelId, PROMPT_HASH_V5, EXTRACTION_SCHEMA_VERSION].join('|'))
        .digest('hex');
}

function summarizeExtractionMetadata(extraction, text) {
    if (!extraction) return null;
    return {
        method: extraction.method || null,
        pages: Number.isFinite(extraction.pages) ? extraction.pages : 0,
        chars: String(text || '').length,
        truncated: extraction.truncated === true,
        error: extraction.error || null,
        fallbackError: extraction.fallbackError || null,
        ...(extraction.ocrEngine ? { ocrEngine: extraction.ocrEngine } : {}),
        ...(Array.isArray(extraction.skippedPageRanges) && extraction.skippedPageRanges.length > 0
            ? { skippedPageRanges: extraction.skippedPageRanges }
            : {}),
    };
}

function summarizeExtraction(extraction) {
    return [
        `method=${extraction?.method || 'none'}`,
        `pages=${extraction?.pages ?? 0}`,
        `chars=${(extraction?.text || '').length}`,
        `truncated=${Boolean(extraction?.truncated)}`,
        `error=${extraction?.error || 'null'}`,
        `fallbackError=${extraction?.fallbackError || 'null'}`,
    ].join(' ');
}

function describeExtractionFailure(extraction) {
    switch (extraction?.error) {
        case EXTRACTION_ERROR_CODES.FILE_NOT_FOUND:
            return 'file not found.';
        case EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE:
            return 'unsupported file type.';
        case EXTRACTION_ERROR_CODES.HTML_AS_PDF:
            return 'html-as-pdf masquerading document.';
        case EXTRACTION_ERROR_CODES.PDF_ENCRYPTED:
            return 'pdf-encrypted document cannot be opened.';
        case EXTRACTION_ERROR_CODES.PDF_CORRUPT:
            return 'pdf-corrupt structure cannot be parsed.';
        case EXTRACTION_ERROR_CODES.PDF_PARSE_FAILED:
            return 'the PDF could not be parsed (it may be corrupt or unreadable).';
        case EXTRACTION_ERROR_CODES.DOCX_PARSE_FAILED:
            return 'the DOCX could not be parsed.';
        case EXTRACTION_ERROR_CODES.DOC_PARSE_FAILED:
            return 'the DOC could not be parsed.';
        case EXTRACTION_ERROR_CODES.TXT_READ_FAILED:
            return 'the text file could not be read.';
        case EXTRACTION_ERROR_CODES.OCR_TIMEOUT:
            return 'OCR timed out while reading the scanned document.';
        case EXTRACTION_ERROR_CODES.OCR_PARTIAL:
            return 'OCR extracted only part of the scanned document before being interrupted.';
        case EXTRACTION_ERROR_CODES.OCR_FAILED:
            return 'OCR failed while reading the scanned document.';
        case EXTRACTION_ERROR_CODES.PDF_TOO_LARGE:
            return 'the PDF exceeds the maximum file size for OCR.';
        case EXTRACTION_ERROR_CODES.PDF_PAGE_LIMIT_EXCEEDED:
            return 'the PDF exceeds the maximum page count for OCR.';
        default:
            return 'no readable text was found in the document.';
    }
}

function buildExtractionErrorMessage(extraction) {
    const fallbackFailure = extraction?.fallbackError
        ? ` OCR fallback also failed: ${describeExtractionFailure({ error: extraction.fallbackError })}`
        : '';
    return `Could not extract text from file: ${describeExtractionFailure(extraction)}${fallbackFailure}`;
}

function buildKnownPartiesText(caseInfo) {
    if (!Array.isArray(caseInfo?.participants) || caseInfo.participants.length === 0) {
        return 'Participant information was not available from the source page.';
    }
    return caseInfo.participants.map((p) => {
        let info = `- ${p.name} (${p.role || 'sudionik'})`;
        if (p.oib) info += ` [OIB: ${p.oib}]`;
        if (p.companyData) {
            const cd = p.companyData;
            info += `\n  - Official Name: ${cd.officialName}`;
            info += `\n  - Status: ${cd.status === 1 ? 'Active' : cd.status === 5 ? 'Deleted' : cd.status}`;
            if (cd.founders) info += `\n  - Founders: ${cd.founders}`;
            if (cd.directors) info += `\n  - Directors: ${cd.directors}`;
        }
        return info;
    }).join('\n');
}

function appendSegment1Parties(baseKnownParties, segment1Result) {
    const found = segment1Result?.value?.documentParties;
    if (!Array.isArray(found) || found.length === 0) return baseKnownParties;
    const extra = found.map((p) => `- ${p.name || 'Nepoznata stranka'} (OIB: ${p.oib}${p.role ? `, ${p.role}` : ''})`).join('\n');
    return `${baseKnownParties}\n\nDocument Segment-1 Parties:\n${extra}`;
}

function checkTotalVsPartsClosure(aiResult) {
    const amounts = Array.isArray(aiResult?.amounts) ? aiResult.amounts : [];
    const byCurrency = new Map();
    for (const item of amounts) {
        const cur = item?.currency || 'EUR';
        if (!byCurrency.has(cur)) byCurrency.set(cur, { totals: [], parts: [] });
        const bucket = byCurrency.get(cur);
        const val = Number.isFinite(item?.amount) ? item.amount : item?.amountEur;
        if (!Number.isFinite(val)) continue;
        if (item.amountRole === 'total') bucket.totals.push(val);
        else if (item.amountRole === 'line_item') bucket.parts.push(val);
    }

    const gaps = [];
    for (const [cur, bucket] of byCurrency.entries()) {
        if (bucket.totals.length === 0 || bucket.parts.length < 2) continue;
        const maxTotal = Math.max(...bucket.totals);
        const sumParts = bucket.parts.reduce((acc, v) => acc + v, 0);
        if (maxTotal > 0 && Math.abs(sumParts - maxTotal) / maxTotal > 0.05) {
            gaps.push({
                field: 'amounts',
                code: 'total-parts-mismatch',
                detail: `Zbroj stavki (${sumParts.toFixed(2)} ${cur}) odstupa >5% od ukupnog iznosa (${maxTotal.toFixed(2)} ${cur}).`,
            });
        }
    }
    return gaps;
}

function isTransientAnalysisFailure(error) {
    if (!error) return false;
    if (isCreditExhaustedError(error)) return false;
    const message = String(error?.message || error).toLowerCase();
    return /abort|timed out|timeout|429|rate limit|overloaded|too many requests|resource has been exhausted|err_stream_idle_timeout/i.test(message);
}

function repairGapFields(validated) {
    const fields = new Set();
    for (const g of validated.gaps || []) {
        const top = String(g.field || '').split('.')[0];
        if (REPAIRABLE_FIELDS.includes(top)) fields.add(top);
    }
    return [...fields];
}

function buildSourceDocumentRecord(item, { failedClassified = null } = {}) {
    const fileName = item?.text || item?.filePath || 'nepoznata datoteka';
    const docClass = item?.docClass || item?.preflight?.docClass || null;
    const reasonCode = item?.reasonCode || failedClassified?.code || item?.extraction?.error || null;
    const reason = item?.reason || failedClassified?.reason || null;
    return {
        docId: item?.docId || null,
        fileName,
        contentHash: item?.contentHash || null,
        sourceEntryIndex: item?.sourceEntryIndex ?? item?.entryIndex ?? null,
        sourceDocumentLinkId: item?.sourceDocumentLinkId ?? item?.documentLinkId ?? null,
        entryDisplayId: item?.entryDisplayId || deriveEntryDisplayId(item?.detailLink),
        entryDate: item?.entryDate || null,
        entryTitle: item?.entryTitle || null,
        pageCount: item?.pageCount ?? item?.extraction?.pages ?? null,
        docClass,
        ocrEngine: item?.ocrEngine || item?.extraction?.ocrEngine || null,
        fromCache: Boolean(item?.fromCache),
        adminFastPath: Boolean(item?.adminFastPath),
        skippedPageRanges: Array.isArray(item?.skippedPageRanges)
            ? item.skippedPageRanges
            : (Array.isArray(item?.extraction?.skippedPageRanges) ? item.extraction.skippedPageRanges : []),
        reasonCode,
        reason,
    };
}

function buildAnalysisCoverage(individualAnalyses) {
    const items = Array.isArray(individualAnalyses) ? individualAnalyses : [];
    const total = items.length;
    const analyzed = items.filter((item) => Boolean(item?.aiResult));
    const failed = items.filter((item) => !item?.aiResult);
    const partial = analyzed.filter((item) => item?.truncated || item?.degraded);
    const coverageRatio = total > 0 ? Number((analyzed.length / total).toFixed(2)) : 0;

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
        partial: partial.length,
        total,
        coverageRatio,
        complete: total > 0 && analyzed.length === total && partial.length === 0,
        groundedClaims,
        totalClaims,
        partialFiles: partial.map((item) => ({
            ...buildSourceDocumentRecord(item),
            extraction: item?.extraction || null,
            truncated: item?.truncated === true,
            degraded: item?.degraded === true,
            analysisChunks: item?.analysisChunks || null,
        })),
        gaps: partial.map((item) => {
            const name = item?.text || item?.filePath || 'nepoznata datoteka';
            if (item?.degraded) return `Djelomična analiza odlomaka: ${name}`;
            return `Djelomično izdvajanje teksta: ${name}`;
        }),
        failedFiles: failed.map((item) => {
            const classified = classifyFileFailureDetailed(item?.errorObj || item?.error);
            const reasonCode = item?.reasonCode || classified.code;
            const record = buildSourceDocumentRecord(item, { failedClassified: classified });
            return {
                ...record,
                code: reasonCode,
                reasonCode,
                reason: classified.reason,
                causalChain: classified.causalChain,
            };
        }),
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, worker, options = {}) {
    const { delayMs = 0 } = options;
    const safeWorker = async (item) => {
        try {
            return await worker(item);
        } catch (err) {
            return { error: err.message || String(err), errorObj: err };
        }
    };
    const results = new Array(items.length);
    let nextIndex = 0;
    const boundedLoop = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            if (delayMs > 0 && index > 0) await sleep(delayMs);
            results[index] = await safeWorker(items[index]);
        }
    };
    const poolSize = Math.max(1, Math.min(concurrency || 1, items.length));
    await Promise.all(Array.from({ length: poolSize }, () => boundedLoop()));
    return results;
}

async function analyzeClusterDocuments(input = {}) {
    const {
        files = [],
        caseInfo = {},
        progressCallback,
        usageTracker,
        onUsage,
        runId = null,
        sqliteStore = null,
        workerPool = null,
        taskRouter: providedRouter = null,
        creditLatch: providedLatch = null,
        signal = null,
    } = input;

    const total = Array.isArray(files) ? files.length : 0;
    const mockMode = isUsingMockLlm();
    if (sqliteStore?.upsertPromptRegistry) {
        try {
            sqliteStore.upsertPromptRegistry({
                promptHash: EXTRACTION_SIGNATURE_V5.promptHash,
                promptName: EXTRACTION_SIGNATURE_V5.promptName,
                schemaVersion: EXTRACTION_SIGNATURE_V5.version,
                systemPrompt: EXTRACTION_SIGNATURE_V5.systemPrompt,
            });
        } catch (err) {
            logger.warn(`[DocumentAnalyzer] Failed to upsert prompt registry: ${err.message}`);
        }
    }
    const analysisModelId = resolveRoleConfig('analysis').model || 'z-ai/glm-5.3-flash';
    const creditLatch = providedLatch || createCreditExhaustedLatch({ runId, sqliteStore });
    const taskRouter = providedRouter || (mockMode ? null : createTaskRouter({
        creditLatch,
        sqliteStore,
        runId,
    }));

    const analysisClient = mockMode ? createOpenRouterRoleClient('analysis') : null;
    const repairClient = mockMode ? createOpenRouterRoleClient('repair') : null;

    const batchCounters = { done: 0, failed: 0 };
    const completedByHash = new Map();
    let benchCandidatesInserted = 0;
    let currentFileName = null;

    const invokeModel = async ({ taskType, messages, budget, fileName, docHash, segmentId }) => {
        throwIfSignalAborted(signal);
        if (taskRouter && !mockMode) {
            return taskRouter.invokeTask(taskType, messages, {
                maxTokens: budget?.maxTokens,
                reasoning: budget?.reasoning,
                docHash,
                segmentId,
                promptHash: PROMPT_HASH_V5,
                tracker: usageTracker,
                onUsage,
                signal,
                retryOptions: {
                    onRetry: ({ attempt, delayMs }) => {
                        progressCallback?.({
                            step: 'analyze_retry',
                            message: `Retry ${attempt} for ${fileName}. Waiting ${Math.round(delayMs / 1000)}s...`,
                        });
                    },
                },
            });
        }
        const client = taskType === 'FieldRepair' || taskType === 'FullRepair' ? repairClient : analysisClient;
        return withGeminiRetry(
            () => withGeminiTimeout((reqSignal) => trackUsageInvoke(client, messages, {
                signal: reqSignal || signal,
                tracker: usageTracker,
                onUsage,
            })),
            {
                signal,
                onRetry: ({ attempt, delayMs }) => {
                    progressCallback?.({
                        step: 'analyze_retry',
                        message: `Retry ${attempt} for ${fileName}. Waiting ${Math.round(delayMs / 1000)}s...`,
                    });
                },
            },
        );
    };

    const invokeRepair = async (promptText, { file, docHash, segmentId }) => {
        const fileName = file?.text || path.basename(file?.filePath || 'document');
        progressCallback?.({
            step: 'analyze_repair',
            message: `Popravljam ekstrakciju za ${fileName}...`,
        });
        const response = await invokeModel({
            taskType: 'FieldRepair',
            messages: [{ role: 'user', content: promptText }],
            budget: { maxTokens: 4096 },
            fileName: `repair of ${fileName}`,
            docHash,
            segmentId,
        });
        return modelContentToText(response?.content);
    };

    const validateAndRepairSegment = async (response, segment, file, docHash) => {
        let repaired = false;
        let validated = validateExtraction(extractJsonBlock(response?.content));
        const rootUnparseable = !validated.value;

        if (rootUnparseable || !hasUsableExtraction(validated.value)) {
            repaired = true;
            logger.agent.warn(outputCapWarning('analysis'));
            try {
                const repairContent = await invokeRepair(
                    buildFullRepairPrompt({ sourceText: segment.text }),
                    { file, docHash, segmentId: `${segment.id}:full-repair` },
                );
                const salvaged = validateExtraction(extractJsonBlock(repairContent));
                if (salvaged.value) validated = salvaged;
            } catch (repairErr) {
                if (isCreditExhaustedError(repairErr)) throw repairErr;
                logger.agent.warn(`[Analyzer] Full repair failed for ${file.text}: ${repairErr.message}`);
            }
            if (!validated.value || !hasUsableExtraction(validated.value)) {
                if (!rootUnparseable) {
                    throw new Error(`Extraction schema mismatch in ${file.text || file.filePath}; no usable content salvaged.`);
                }
                throw new Error(`AI returned non-JSON response: "${String(response?.content || '').slice(0, 100)}..."`);
            }
        } else if (!validated.valid) {
            repaired = true;
            for (const field of repairGapFields(validated)) {
                try {
                    const repairContent = await invokeRepair(
                        buildFieldRepairPrompt({ field, sourceText: segment.text }),
                        { file, docHash, segmentId: `${segment.id}:repair:${field}` },
                    );
                    const repair = parseFieldRepairResponse(repairContent, field);
                    if (repair.ok) {
                        const fallbackVal = field === 'decisionOutcome' ? null : [];
                        validated = validateExtraction({
                            ...validated.value,
                            [field]: repair.absent ? fallbackVal : repair.value,
                        });
                    } else {
                        logger.agent.warn(`[Analyzer] Field repair rejected for ${file.text} field ${field}: ${repair.reason}`);
                    }
                } catch (repairErr) {
                    if (isCreditExhaustedError(repairErr)) throw repairErr;
                    logger.agent.warn(`[Analyzer] Field repair failed for ${file.text} field ${field}: ${repairErr.message}`);
                }
            }
            if (!hasUsableExtraction(validated.value)) {
                const remaining = repairGapFields(validated);
                throw new Error(
                    `Extraction schema mismatch for field(s) ${(remaining.length > 0 ? remaining : ['document']).join(', ')} in ${file.text || file.filePath}; no usable content salvaged.`,
                );
            }
        }

        let assignmentCueGap = null;
        if (hasReceivableAssignmentCue(segment.text) && Array.isArray(validated.value?.propertyFlow) && validated.value.propertyFlow.length === 0) {
            repaired = true;
            try {
                const repairContent = await invokeRepair(
                    buildFieldRepairPrompt({ field: 'propertyFlow', sourceText: segment.text }),
                    { file, docHash, segmentId: `${segment.id}:repair:propertyFlow` },
                );
                const repair = parseFieldRepairResponse(repairContent, 'propertyFlow');
                if (repair.ok && !repair.absent && repair.value.length > 0) {
                    validated = validateExtraction({
                        ...validated.value,
                        propertyFlow: repair.value,
                    });
                } else {
                    assignmentCueGap = {
                        field: 'propertyFlow',
                        code: 'source-cue-empty',
                        detail: repair.ok
                            ? 'source states a receivable assignment but targeted property-flow repair returned no entry'
                            : `source states a receivable assignment but targeted property-flow repair was unusable: ${repair.reason}`,
                    };
                }
            } catch (repairErr) {
                if (isCreditExhaustedError(repairErr)) throw repairErr;
                assignmentCueGap = {
                    field: 'propertyFlow',
                    code: 'source-cue-empty',
                    detail: `source states a receivable assignment but targeted property-flow repair failed: ${repairErr.message}`,
                };
            }
        }

        return {
            value: validated.value,
            gaps: validated.gaps,
            assignmentCueGap,
            repaired,
        };
    };

    const analyzeOneSegmentWithBisect = async ({ segment, segIndex, totalSegs, knownParties, file, docHash }) => {
        const checkpointKey = (sqliteStore?.getSegmentCheckpoint && docHash)
            ? buildCheckpointKey({ contentHash: docHash, segmentId: segment.id, modelId: analysisModelId })
            : null;
        const cachedSegment = checkpointKey ? sqliteStore.getSegmentCheckpoint(checkpointKey) : null;
        if (cachedSegment?.parsed) {
            return { results: [{ segment, ...cachedSegment.parsed }], fromCheckpoint: true, bisected: false, repaired: false };
        }

        creditLatch.assertNotTripped();
        const isTableDense = segment.densityClass === 'table_dense';
        const budget = resolveTokenBudget({
            taskType: isTableDense ? 'ExtractTableChunk' : 'ExtractProseChunk',
            modelId: analysisModelId,
            segmentLength: segment.text.length,
            isTableDense,
        });
        const messages = buildAnalysisMessages(knownParties, segment.text, { segmentIndex: segIndex, totalSegments: totalSegs });
        const startedAt = Date.now();
        const response = await invokeModel({
            taskType: isTableDense ? 'ExtractTableChunk' : 'ExtractProseChunk',
            messages,
            budget,
            fileName: file.text,
            docHash,
            segmentId: segment.id,
        });

        const telemetry = analyzeCompletionTelemetry(response, { budget });
        const parsedRoot = extractJsonBlock(response?.content);
        if ((telemetry.isTruncated || !parsedRoot) && telemetry.hitLengthCap) {
            const bisectedChildren = bisectSegmentOnNewline(segment);
            if (bisectedChildren) {
                const subResults = [];
                let anyRepaired = false;
                for (const child of bisectedChildren) {
                    const childOut = await analyzeOneSegmentWithBisect({
                        segment: child,
                        segIndex,
                        totalSegs,
                        knownParties,
                        file,
                        docHash,
                    });
                    subResults.push(...childOut.results);
                    if (childOut.repaired) anyRepaired = true;
                }
                return { results: subResults, fromCheckpoint: false, bisected: true, repaired: anyRepaired };
            }
        }

        const segResult = await validateAndRepairSegment(response, segment, file, docHash);
        if (checkpointKey && sqliteStore?.putSegmentCheckpoint && (!segResult.gaps || segResult.gaps.length === 0) && !segResult.assignmentCueGap) {
            try {
                sqliteStore.putSegmentCheckpoint({
                    checkpointKey,
                    contentHash: docHash,
                    segmentId: segment.id,
                    modelId: analysisModelId,
                    promptHash: PROMPT_HASH_V5,
                    schemaVersion: EXTRACTION_SCHEMA_VERSION,
                    parsed: segResult,
                    inputTokens: response?.usage_metadata?.input_tokens ?? null,
                    outputTokens: response?.usage_metadata?.output_tokens ?? null,
                    reasoningTokens: response?.response_metadata?.usageDetails?.reasoning_tokens ?? null,
                    costUsd: response?.response_metadata?.usageDetails?.cost_usd ?? null,
                    latencyMs: Date.now() - startedAt,
                });
            } catch {
                // Non-fatal checkpoint save error.
            }
        }
        return { results: [{ segment, ...segResult }], fromCheckpoint: false, bisected: false, repaired: segResult.repaired };
    };

    // Run Stage T0 preflight upfront for real multi-PDF batches when pdfjs is not mocked
    const hasPdfFiles = files.some((f) => String(f?.filePath || '').toLowerCase().endsWith('.pdf'));
    const preflightByFile = new Map();
    if (hasPdfFiles && !isPdfJsMocked() && files.some((f) => f?.filePath && fs.existsSync(f.filePath) && String(f.filePath).toLowerCase().endsWith('.pdf'))) {
        try {
            const pdfCandidates = files.filter((f) => f?.filePath && fs.existsSync(f.filePath) && String(f.filePath).toLowerCase().endsWith('.pdf'));
            const manifest = await runPdfPreflight({
                files: pdfCandidates,
                sqliteStore,
                workerPool,
                runId,
                progressCallback,
                signal,
            });
            for (const docManifest of manifest.docs || []) {
                preflightByFile.set(docManifest.filePath, docManifest);
            }
        } catch (preflightErr) {
            if (signal?.aborted) throw preflightErr;
            logger.agent.warn(`[Stage T0] Preflight failed; falling back to per-file extraction: ${preflightErr.message}`);
        }
    }

    const emitFileEvent = (file, status, extra = {}) => {
        const classified = status === 'failed'
            ? classifyFileFailure(extra.errorObj || extra.error)
            : null;
        progressCallback?.({
            step: 'analyzing',
            kind: 'file',
            message: status === 'ok'
                ? `Analiziran dokument ${batchCounters.done + batchCounters.failed}/${total}: ${file.text || path.basename(file.filePath || '')}`
                : `Neuspješna analiza ${batchCounters.done + batchCounters.failed}/${total}: ${file.text || path.basename(file.filePath || '')}`,
            metadata: {
                kind: 'file',
                fileName: file.text || path.basename(file.filePath || ''),
                docId: extra.docId || null,
                status,
                done: batchCounters.done,
                failed: batchCounters.failed,
                total,
                ...(classified ? { reasonCode: classified.code, reason: classified.reason } : {}),
                ...extra,
            },
        });
        progressCallback?.(buildStageCounterEvent({
            stage: 'reasoning',
            done: batchCounters.done + batchCounters.failed,
            failed: batchCounters.failed,
            total,
            unit: 'dokument',
        }));
    };

    const emitHeartbeat = () => {
        progressCallback?.({
            step: 'analyzing',
            kind: 'heartbeat',
            metadata: {
                kind: 'heartbeat',
                done: batchCounters.done,
                failed: batchCounters.failed,
                total,
                currentFile: currentFileName,
            },
        });
    };

    const heartbeatTimer = total > 0 ? setInterval(emitHeartbeat, ANALYSIS_HEARTBEAT_MS) : null;

    const analyzeFile = async (file, { retried = false } = {}) => {
        throwIfSignalAborted(signal);
        const startedAt = Date.now();
        currentFileName = file.text || path.basename(file.filePath || '');
        const preflightDoc = preflightByFile.get(file.filePath) || null;
        let contentHash = preflightDoc?.contentHash || null;
        let docId = computeStableDocId(file, contentHash);
        let retrievalChunks = null;
        let extraction = null;
        let text = '';
        let analysisChunks = null;
        let docClass = preflightDoc?.docClass || null;
        let ocrEngine = null;
        let fromCache = false;
        let adminFastPath = false;
        let skippedPageRanges = [];
        let pageCount = preflightDoc?.pageCount || null;
        let reasonCode = null;

        try {
            // Check intra-run duplicate PDF identified by Stage T0
            if (preflightDoc?.duplicateOfHash && completedByHash.has(preflightDoc.duplicateOfHash)) {
                const canonical = completedByHash.get(preflightDoc.duplicateOfHash);
                batchCounters.done += 1;
                fromCache = true;
                emitFileEvent(file, 'ok', { docId, durationMs: Date.now() - startedAt, retried, fromCache: true });
                return {
                    ...file,
                    docId,
                    contentHash,
                    docClass: canonical.docClass,
                    ocrEngine: canonical.ocrEngine,
                    pageCount: canonical.pageCount,
                    fromCache: true,
                    adminFastPath: canonical.adminFastPath,
                    skippedPageRanges: canonical.skippedPageRanges || [],
                    aiResult: canonical.aiResult,
                    extraction: canonical.extraction,
                    truncated: canonical.truncated,
                    degraded: canonical.degraded,
                    analysisChunks: canonical.analysisChunks,
                    ...(canonical.retrievalChunks ? { retrievalChunks: canonical.retrievalChunks } : {}),
                };
            }

            if (preflightDoc) {
                if (preflightDoc.docClass === 'empty_or_corrupt') {
                    reasonCode = preflightDoc.errorCode || EXTRACTION_ERROR_CODES.PDF_CORRUPT;
                    extraction = { error: reasonCode, pages: preflightDoc.pageCount || 0, method: null, text: '' };
                    throw Object.assign(new Error(buildExtractionErrorMessage(extraction)), { reasonCode });
                }
                if (preflightDoc.docClass === 'digital_text') {
                    text = preflightDoc.text || '';
                    extraction = {
                        text,
                        method: 'pdf-text',
                        pages: preflightDoc.pageCount,
                        pageRanges: preflightDoc.pageRanges || [],
                        truncated: false,
                        error: null,
                    };
                } else {
                    creditLatch.assertNotTripped();
                    const ocrRes = await transcribeDocumentViaStageT({
                        filePath: file.filePath,
                        preflightDoc,
                        progressCallback,
                        sqliteStore,
                        workerPool,
                        tracker: usageTracker,
                        onUsage,
                        signal,
                    });
                    text = ocrRes.text || '';
                    extraction = ocrRes;
                    ocrEngine = ocrRes.ocrEngine || null;
                    fromCache = Boolean(ocrRes.fromCache);
                    skippedPageRanges = Array.isArray(ocrRes.skippedPageRanges) ? ocrRes.skippedPageRanges : [];
                    if (!text.trim()) {
                        reasonCode = ocrRes.error || EXTRACTION_ERROR_CODES.OCR_FAILED;
                        throw Object.assign(new Error(buildExtractionErrorMessage(ocrRes)), { reasonCode });
                    }
                }
            } else {
                extraction = await extractTextFromFile(file.filePath);
                text = extraction.text;
                if ((!text || text.trim().length === 0) && String(file.filePath || '').toLowerCase().endsWith('.pdf')) {
                    logger.agent.log(extraction.error
                        ? `[Analyzer] Text extraction failed for ${path.basename(file.filePath)} (error=${extraction.error}); trying OCR fallback`
                        : `[Analyzer] No embedded text layer in ${path.basename(file.filePath)} (likely scanned); trying OCR fallback`);
                    progressCallback?.({
                        step: 'ocr',
                        message: `Pokrećem OCR za ${path.basename(file.filePath)}.`,
                        metadata: { stage: 'ocr', done: 0, total: 1, unit: 'dokument' },
                    });
                    const ocrResult = await extractTextViaOCR(
                        file.filePath,
                        progressCallback,
                        { tracker: usageTracker, onUsage, sqliteStore, signal },
                    );
                    progressCallback?.({
                        step: 'ocr',
                        message: `OCR završen za ${path.basename(file.filePath)}.`,
                        metadata: { stage: 'ocr', done: 1, total: 1, unit: 'dokument' },
                    });
                    if (ocrResult.text && ocrResult.text.trim().length > 0) {
                        text = ocrResult.text;
                        extraction = ocrResult;
                        docClass = docClass || 'scanned_full';
                        ocrEngine = ocrResult.ocrEngine || null;
                    } else {
                        const primaryError = extraction.error;
                        extraction = {
                            ...extraction,
                            ...ocrResult,
                            error: primaryError || ocrResult.error || EXTRACTION_ERROR_CODES.OCR_FAILED,
                            ...(primaryError && ocrResult.error ? { fallbackError: ocrResult.error } : {}),
                        };
                    }
                } else if (!docClass && extraction?.method === 'pdf-text') {
                    docClass = 'digital_text';
                }
                if (!text || text.trim().length === 0) {
                    reasonCode = extraction?.error || EXTRACTION_ERROR_CODES.EMPTY_DOCUMENT;
                    throw Object.assign(new Error(buildExtractionErrorMessage(extraction)), { reasonCode });
                }
            }

            pageCount = pageCount || extraction?.pages || null;
            logger.agent.log(`[Extractor] ${path.basename(file.filePath)}: ${summarizeExtraction(extraction)}`);

            if (!contentHash) {
                try {
                    contentHash = crypto.createHash('sha256').update(fs.readFileSync(file.filePath)).digest('hex');
                    docId = computeStableDocId(file, contentHash);
                } catch (hashErr) {
                    logger.agent.warn(`[Analyzer] Could not hash source bytes for ${file.text}: ${hashErr.message}`);
                }
            }

            // Dedupe identical non-PDF or unpreflighted files intra-run as well
            if (contentHash && completedByHash.has(contentHash)) {
                const canonical = completedByHash.get(contentHash);
                batchCounters.done += 1;
                emitFileEvent(file, 'ok', { docId, durationMs: Date.now() - startedAt, retried, fromCache: true });
                return {
                    ...file,
                    docId,
                    contentHash,
                    docClass,
                    ocrEngine: canonical.ocrEngine,
                    pageCount,
                    fromCache: true,
                    adminFastPath: canonical.adminFastPath,
                    skippedPageRanges: canonical.skippedPageRanges || [],
                    aiResult: canonical.aiResult,
                    extraction: summarizeExtractionMetadata(extraction, text),
                    truncated: canonical.truncated,
                    degraded: canonical.degraded,
                    analysisChunks: canonical.analysisChunks,
                    ...(canonical.retrievalChunks ? { retrievalChunks: canonical.retrievalChunks } : {}),
                };
            }

            const retrievalPageRanges = Array.isArray(extraction.pageRanges)
                ? extraction.pageRanges
                : pageRangesFromMarkedText(text);
            retrievalChunks = buildRetrievalChunks(text, { docId }).map((chunk) => ({
                ...chunk,
                metadata: {
                    ...chunk.metadata,
                    pageNumbers: pageNumbersForRange(retrievalPageRanges, chunk.metadata.startIndex, chunk.metadata.endIndex),
                },
            }));

            // Stage T0.5 admin notice fast-path ($0 deterministic extraction)
            const fastPathEligible = canUseAdminFastPath({
                text,
                docRole: file.role || file.entryRole || file.entryType || null,
                docClass: docClass || 'digital_text',
                file,
            });
            if (fastPathEligible) {
                const fastAiResult = extractAdminNoticeFastPath({ text, file, caseInfo });
                fastAiResult.parties = caseInfo.participants || [];
                applyGroundingToAnalysis(fastAiResult, text);
                adminFastPath = true;
                analysisChunks = { total: 1, completed: 1, failed: 0 };
                batchCounters.done += 1;
                emitFileEvent(file, 'ok', { docId, durationMs: Date.now() - startedAt, retried, adminFastPath: true });
                const record = {
                    ...file,
                    docId,
                    contentHash,
                    docClass,
                    ocrEngine,
                    pageCount,
                    fromCache,
                    adminFastPath: true,
                    skippedPageRanges,
                    aiResult: fastAiResult,
                    extraction: summarizeExtractionMetadata(extraction, text),
                    truncated: extraction?.truncated === true,
                    degraded: false,
                    analysisChunks,
                    ...(retrievalChunks ? { retrievalChunks } : {}),
                };
                if (contentHash) completedByHash.set(contentHash, record);
                return record;
            }

            const baseKnownParties = buildKnownPartiesText(caseInfo);
            const analysisInput = buildAdaptiveSegments(text, {
                docId: path.basename(file?.filePath || file?.text || 'analysis-doc'),
                pageRanges: retrievalPageRanges,
                pageCount: pageCount || 1,
                isTableDense: preflightDoc?.isTableDense ?? null,
            });

            const chunkResults = [];
            const chunkFailures = [];
            let anyBisected = false;
            let anyRepaired = false;
            let segmentsFromCheckpoint = 0;
            analysisChunks = { total: analysisInput.segments.length, completed: 0, failed: 0 };

            if (analysisInput.usedChunking) {
                progressCallback?.({
                    step: 'chunking',
                    message: `Čitam svih ${analysisInput.segments.length} odlomaka dokumenta ${file.text}.`,
                });
            }

            // Evaluate Segment 1 first to enrich knownParties with Page-1 party roster for segments 2..N
            let effectiveKnownParties = baseKnownParties;
            for (const [segmentIndex, segment] of analysisInput.segments.entries()) {
                throwIfSignalAborted(signal);
                const pageLabel = segment.pageNumbers.length > 0
                    ? `, stranice ${segment.pageNumbers[0]}-${segment.pageNumbers.at(-1)}`
                    : '';
                progressCallback?.({
                    step: 'analyzing',
                    kind: 'chunk',
                    message: `Analiziram odlomak ${segmentIndex + 1}/${analysisInput.segments.length}${pageLabel} dokumenta ${file.text}.`,
                });
                try {
                    const segOut = await analyzeOneSegmentWithBisect({
                        segment,
                        segIndex: segmentIndex,
                        totalSegs: analysisInput.segments.length,
                        knownParties: effectiveKnownParties,
                        file,
                        docHash: contentHash,
                    });
                    chunkResults.push(...segOut.results);
                    analysisChunks.completed += 1;
                    if (segOut.fromCheckpoint) segmentsFromCheckpoint += 1;
                    if (segOut.bisected) anyBisected = true;
                    if (segOut.repaired) anyRepaired = true;
                    if (segmentIndex === 0 && analysisInput.segments.length > 1 && segOut.results[0]) {
                        effectiveKnownParties = appendSegment1Parties(baseKnownParties, segOut.results[0]);
                    }
                } catch (segmentError) {
                    if (isCreditExhaustedError(segmentError)) {
                        creditLatch.guard(segmentError);
                        chunkFailures.push({ segment, error: segmentError });
                        break;
                    }
                    chunkFailures.push({ segment, error: segmentError });
                    logger.agent.warn(`[Analyzer] Chunk ${segment.id} failed for ${file.text}: ${segmentError.message}`);
                }
            }

            analysisChunks.failed = chunkFailures.length;
            analysisChunks.failedChunkIds = chunkFailures.map(({ segment }) => segment.id);
            if (chunkResults.length === 0) {
                const failureDetails = chunkFailures
                    .map(({ segment, error }) => `Chunk ${segment.id}: ${error?.message || String(error)}`)
                    .join('; ');
                const primaryErr = chunkFailures[0]?.error;
                if (isCreditExhaustedError(primaryErr)) {
                    reasonCode = EXTRACTION_ERROR_CODES.PROVIDER_CREDITS_EXHAUSTED;
                }
                throw Object.assign(
                    new Error(`All ${analysisInput.segments.length} analysis chunks failed for ${file.text}. ${failureDetails}`, { cause: primaryErr }),
                    reasonCode ? { reasonCode } : {},
                );
            }

            if (segmentsFromCheckpoint === analysisInput.segments.length) {
                fromCache = true;
            }

            const merged = mergeAnalysisChunkResults(chunkResults, text);
            const { gaps, assignmentCueGaps, ...mergedValues } = merged;
            const chunkFailureGaps = chunkFailures.map(({ segment, error }) => ({
                field: 'document',
                code: 'analysis_chunk_failed',
                detail: `Chunk ${segment.id} failed: ${error.message}`,
            }));

            const aiResult = {
                ...mergedValues,
                parties: caseInfo.participants || [],
            };
            try {
                applyGroundingToAnalysis(aiResult, text);
            } catch (groundingErr) {
                logger.warn('documentAnalyzer.grounding', 'Grounding check failed', {
                    runId,
                    filePath: file.filePath,
                    error: groundingErr?.message || String(groundingErr),
                });
            }

            const closureGaps = checkTotalVsPartsClosure(aiResult);
            const allGaps = [...gaps, ...assignmentCueGaps, ...chunkFailureGaps, ...closureGaps];
            if (allGaps.length > 0) {
                aiResult._extractionGaps = allGaps;
            }

            // Harvest bounded anomalies into bench_candidates ($0 telemetry for future bench eval)
            if (sqliteStore?.insertBenchCandidate && benchCandidatesInserted < MAX_BENCH_CANDIDATES_PER_RUN) {
                const triggerReasons = [];
                if (anyBisected) triggerReasons.push('bisected');
                if (anyRepaired) triggerReasons.push('repaired');
                if (closureGaps.length > 0) triggerReasons.push('total-parts-mismatch');
                if (chunkFailures.length > 0) triggerReasons.push('partial-chunk-failure');
                const ungrounded = [...(aiResult.amounts || []), ...(aiResult.propertyFlow || [])]
                    .filter((entry) => entry && entry.grounded === false).length;
                if (ungrounded > 0) triggerReasons.push(`ungrounded:${ungrounded}`);

                if (triggerReasons.length > 0) {
                    try {
                        sqliteStore.insertBenchCandidate({
                            runId,
                            contentHash,
                            docName: file.text || path.basename(file.filePath || 'document'),
                            frozenTranscript: text,
                            knownParties: caseInfo.participants || [],
                            prodAiResult: aiResult,
                            triggerReasons,
                        });
                        benchCandidatesInserted += 1;
                    } catch {
                        // Never abort extraction for bench_candidates logging.
                    }
                }
            }

            logger.agent.log(`Analyzed file ${file.filePath}, AI result:`, aiResult);
            batchCounters.done += 1;
            emitFileEvent(file, 'ok', { docId, durationMs: Date.now() - startedAt, retried, fromCache });

            const record = {
                ...file,
                docId,
                contentHash,
                docClass,
                ocrEngine,
                pageCount,
                fromCache,
                adminFastPath,
                skippedPageRanges,
                reasonCode: extraction?.truncated ? (extraction.reasonCode || EXTRACTION_ERROR_CODES.OCR_PAGE_CAP) : null,
                aiResult,
                extraction: summarizeExtractionMetadata(extraction, text),
                truncated: extraction?.truncated === true,
                degraded: chunkFailures.length > 0 || closureGaps.length > 0,
                analysisChunks,
                ...(retrievalChunks ? { retrievalChunks } : {}),
            };
            if (contentHash) completedByHash.set(contentHash, record);
            return record;
        } catch (err) {
            if (signal?.aborted) throwIfSignalAborted(signal);
            const finalCode = reasonCode || err?.reasonCode || (isCreditExhaustedError(err) ? EXTRACTION_ERROR_CODES.PROVIDER_CREDITS_EXHAUSTED : null);
            if (isCreditExhaustedError(err)) creditLatch.guard(err);
            logger.agent.error(`Error analyzing file ${file.filePath}:`, err.message);
            batchCounters.failed += 1;
            emitFileEvent(file, 'failed', {
                docId,
                durationMs: Date.now() - startedAt,
                retried,
                error: err.message,
                errorObj: err,
                ...(finalCode ? { reasonCode: finalCode } : {}),
            });
            return {
                ...file,
                docId,
                docClass,
                ocrEngine,
                pageCount,
                fromCache,
                adminFastPath,
                skippedPageRanges,
                reasonCode: finalCode,
                aiResult: null,
                error: err.message,
                errorObj: err,
                ...(contentHash ? { contentHash } : {}),
                extraction: summarizeExtractionMetadata(extraction, text),
                truncated: extraction?.truncated === true,
                ...(analysisChunks ? { analysisChunks } : {}),
                ...(retrievalChunks ? { retrievalChunks } : {}),
            };
        }
    };

    try {
        const firstPassResults = await mapWithConcurrency(
            files,
            ANALYSIS_FILE_CONCURRENCY,
            analyzeFile,
            { delayMs: ANALYSIS_FILE_DELAY_MS },
        );

        const retryableIndexes = creditLatch.isTripped()
            ? []
            : firstPassResults
                .map((result, index) => ({ result, index }))
                .filter(({ result }) => !result.aiResult && isTransientAnalysisFailure(result.errorObj || result.error))
                .map(({ index }) => index);

        const individualAnalyses = [...firstPassResults];
        if (retryableIndexes.length > 0) {
            logger.agent.log(`[Analyzer] ${retryableIndexes.length} file(s) failed with transient errors; retrying sequentially...`);
            const retryFiles = retryableIndexes.map((index) => files[index]);
            const retryResults = await mapWithConcurrency(
                retryFiles,
                1,
                (file) => analyzeFile(file, { retried: true }),
                { delayMs: ANALYSIS_FILE_DELAY_MS },
            );
            retryResults.forEach((result, position) => {
                individualAnalyses[retryableIndexes[position]] = result;
            });
        }

        const sanitizedAnalyses = individualAnalyses.map(({ errorObj, ...rest }) => rest);
        return {
            individualAnalyses: sanitizedAnalyses,
            sourceDocuments: sanitizedAnalyses.map((item) => buildSourceDocumentRecord(item)),
            coverage: buildAnalysisCoverage(individualAnalyses),
            partialReason: creditLatch.isTripped() ? 'provider-credits-exhausted' : null,
        };
    } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
}

module.exports = {
    analyzeClusterDocuments,
    computeStableDocId,
    checkTotalVsPartsClosure,
    summarizeExtractionMetadata,
    buildSourceDocumentRecord,
    buildAnalysisCoverage,
    isTransientAnalysisFailure,
};
