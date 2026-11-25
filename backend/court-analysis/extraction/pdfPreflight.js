'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
    EXTRACTION_ERROR_CODES,
    sniffFileMagic,
    extractTextFromFile,
    isTableDenseText,
    buildPageRanges,
} = require('./pdfText');
const { getSharedWorkerPool } = require('./workerPool');
const { canUseAdminFastPath } = require('./adminFastPath');
const { classifyDocRole } = require('../utils/docRoles');
const { buildStageCounterEvent } = require('../../http/analysisStage');

const PREFLIGHT_MISTRAL_USD_PER_PAGE = 0.002;
const PREFLIGHT_AVG_EXTRACTION_USD_PER_DOC = 0.0025;

function computeDocId(contentHash, file, fallbackIndex = 0) {
    return crypto.createHash('sha256')
        .update([
            contentHash || file?.filePath || path.basename(file?.text || 'analysis-doc'),
            file?.sourceDocumentLinkId || file?.documentLinkId || '',
            file?.sourceEntryIndex ?? file?.entryIndex ?? fallbackIndex,
        ].join('\0'))
        .digest('hex')
        .slice(0, 24);
}

function buildPreflightDocumentRecord(file, index, overrides = {}) {
    const fileName = file?.text || file?.fileName || path.basename(file?.filePath || 'nepoznata datoteka');
    const docRole = classifyDocRole({
        caseInfo: { title: file?.entryTitle || fileName },
        documentLinks: [{ text: fileName }],
    });
    return {
        index,
        docId: overrides.docId || computeDocId(overrides.contentHash || null, file, index),
        filePath: file?.filePath || null,
        fileName,
        sourceEntryIndex: file?.sourceEntryIndex ?? file?.entryIndex ?? null,
        sourceDocumentLinkId: file?.sourceDocumentLinkId ?? file?.documentLinkId ?? null,
        entryDate: file?.entryDate ?? null,
        entryTitle: file?.entryTitle ?? null,
        entryDisplayId: file?.entryDisplayId ?? null,
        docRole,
        contentHash: overrides.contentHash || null,
        docClass: overrides.docClass || 'empty_or_corrupt',
        pageCount: overrides.pageCount ?? 0,
        digitalPages: overrides.digitalPages || [],
        ocrPages: overrides.ocrPages || [],
        blankPages: overrides.blankPages || [],
        pageAnalyses: overrides.pageAnalyses || [],
        pageRanges: overrides.pageRanges || [],
        text: overrides.text || '',
        method: overrides.method || null,
        tableDense: Boolean(overrides.tableDense),
        fromCache: Boolean(overrides.fromCache),
        adminFastPathEligible: Boolean(overrides.adminFastPathEligible),
        isDuplicate: Boolean(overrides.isDuplicate),
        dedupedOfDocId: overrides.dedupedOfDocId || null,
        reasonCode: overrides.reasonCode || null,
        error: overrides.error || null,
        file,
    };
}

function estimatePreflightCostBallpark(records) {
    let cachedHits = 0;
    let ocrPages = 0;
    let digitalDocs = 0;
    let scannedDocs = 0;
    let hybridDocs = 0;
    let corruptDocs = 0;
    let duplicateDocs = 0;
    let adminFastPathDocs = 0;
    let llmDocs = 0;

    for (const rec of records) {
        if (rec.isDuplicate) {
            duplicateDocs += 1;
            continue;
        }
        if (rec.fromCache) {
            cachedHits += 1;
        }
        if (rec.docClass === 'digital_text') digitalDocs += 1;
        else if (rec.docClass === 'scanned_full') scannedDocs += 1;
        else if (rec.docClass === 'hybrid_mixed') hybridDocs += 1;
        else corruptDocs += 1;

        if (rec.adminFastPathEligible) {
            adminFastPathDocs += 1;
        } else if (rec.docClass !== 'empty_or_corrupt' && !rec.fromCache) {
            llmDocs += 1;
        }

        if (!rec.fromCache && Array.isArray(rec.ocrPages)) {
            ocrPages += Math.min(rec.ocrPages.length, 60);
        }
    }

    const ocrUsd = ocrPages * PREFLIGHT_MISTRAL_USD_PER_PAGE;
    const extractMinUsd = llmDocs * 0.0012;
    const extractExpectedUsd = llmDocs * PREFLIGHT_AVG_EXTRACTION_USD_PER_DOC;
    const synthesisExpectedUsd = records.length > 0 ? 0.02 : 0;

    return {
        estimatedMinUsd: Number((ocrUsd + extractMinUsd).toFixed(4)),
        estimatedExpectedUsd: Number((ocrUsd + extractExpectedUsd + synthesisExpectedUsd).toFixed(4)),
        cachedHits,
        ocrPages,
        digitalDocs,
        scannedDocs,
        hybridDocs,
        corruptDocs,
        duplicateDocs,
        adminFastPathDocs,
        totalDocs: records.length,
    };
}

async function inspectSingleDocument({ file, index, sqliteStore, workerPool, signal }) {
    if (signal?.aborted) {
        throw signal.reason || Object.assign(new Error('Preflight aborted.'), { name: 'AbortError' });
    }
    const filePath = file?.filePath;
    if (!filePath || !fs.existsSync(filePath)) {
        return buildPreflightDocumentRecord(file, index, {
            docClass: 'empty_or_corrupt',
            reasonCode: EXTRACTION_ERROR_CODES.FILE_NOT_FOUND,
            error: EXTRACTION_ERROR_CODES.FILE_NOT_FOUND,
        });
    }

    let bytes = null;
    try {
        bytes = fs.readFileSync(filePath);
        const contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
        const docId = computeDocId(contentHash, file, index);
        const magic = sniffFileMagic(bytes, filePath);

        if (!magic.valid) {
            bytes = null;
            return buildPreflightDocumentRecord(file, index, {
                docId,
                contentHash,
                docClass: 'empty_or_corrupt',
                reasonCode: magic.reasonCode,
                error: magic.reasonCode,
            });
        }

        const hasOcrCache = Boolean(sqliteStore?.hasOcrTranscript?.(contentHash));
        const hasCheckpointCache = Boolean(sqliteStore?.hasSegmentCheckpointForContentHash?.(contentHash));
        const fromCache = hasOcrCache || hasCheckpointCache;

        if (magic.kind === 'pdf') {
            const pdfBytes = new Uint8Array(bytes);
            bytes = null;
            const inspected = await workerPool.run('inspectPdf', { bytes: pdfBytes }, { signal });
            const docRole = classifyDocRole({
                caseInfo: { title: file?.entryTitle || file?.text || path.basename(filePath) },
                documentLinks: [{ text: file?.text || file?.fileName || path.basename(filePath) }],
            });
            const adminFastPathEligible = inspected.docClass === 'digital_text'
                && canUseAdminFastPath({ text: inspected.text, docRole, docClass: inspected.docClass, file });
            return buildPreflightDocumentRecord(file, index, {
                docId,
                contentHash,
                docClass: inspected.docClass,
                pageCount: inspected.pageCount,
                digitalPages: inspected.digitalPages,
                ocrPages: inspected.ocrPages,
                blankPages: inspected.blankPages,
                pageAnalyses: inspected.pageAnalyses,
                pageRanges: inspected.pageRanges,
                text: inspected.text,
                method: inspected.docClass === 'digital_text' ? 'pdf-text' : null,
                tableDense: inspected.tableDense,
                fromCache,
                adminFastPathEligible,
                reasonCode: inspected.reasonCode || null,
                error: inspected.error || null,
            });
        }

        bytes = null;
        const extracted = await extractTextFromFile(filePath);
        if (extracted.error || !extracted.text || !extracted.text.trim()) {
            const reasonCode = extracted.error || EXTRACTION_ERROR_CODES.EMPTY_DOCUMENT;
            return buildPreflightDocumentRecord(file, index, {
                docId,
                contentHash,
                docClass: 'empty_or_corrupt',
                pageCount: extracted.pages || 0,
                reasonCode,
                error: reasonCode,
            });
        }

        const docRole = classifyDocRole({
            caseInfo: { title: file?.entryTitle || file?.text || path.basename(filePath) },
            documentLinks: [{ text: file?.text || file?.fileName || path.basename(filePath) }],
        });
        const adminFastPathEligible = canUseAdminFastPath({
            text: extracted.text,
            docRole,
            docClass: 'digital_text',
            file,
        });
        return buildPreflightDocumentRecord(file, index, {
            docId,
            contentHash,
            docClass: 'digital_text',
            pageCount: extracted.pages || 1,
            digitalPages: [1],
            ocrPages: [],
            blankPages: [],
            pageRanges: extracted.pageRanges?.length ? extracted.pageRanges : buildPageRanges([extracted.text], [1]),
            text: extracted.text,
            method: extracted.method,
            tableDense: isTableDenseText(extracted.text),
            fromCache: hasCheckpointCache,
            adminFastPathEligible,
        });
    } finally {
        bytes = null;
    }
}

async function preflightClusterDocuments({
    files = [],
    sqliteStore = null,
    runBus = null,
    runId = null,
    progressCallback = null,
    workerPool = null,
    signal = null,
} = {}) {
    const pool = workerPool || getSharedWorkerPool();
    const list = Array.isArray(files) ? files : [];
    const results = new Array(list.length);
    const canonicalByHash = new Map();
    const concurrency = Math.min(4, pool.size || 2);

    let nextIndex = 0;
    let completed = 0;
    let failed = 0;

    const emitPreflightProgress = async () => {
        const counterEvent = buildStageCounterEvent({
            stage: 'preflight',
            done: completed,
            failed,
            total: list.length,
            unit: 'datoteka',
        });
        progressCallback?.(counterEvent);
        if (runBus && runId) {
            await runBus.publish({
                runId,
                eventType: 'preflight',
                message: `Priprema dokumenata (${completed}/${list.length})`,
                metadata: counterEvent.metadata,
            });
        }
    };

    const runWorker = async () => {
        while (nextIndex < list.length) {
            if (signal?.aborted) {
                throw signal.reason || Object.assign(new Error('Preflight aborted.'), { name: 'AbortError' });
            }
            const index = nextIndex;
            nextIndex += 1;
            const file = list[index];

            // Synchronously hash & claim canonical slot before any async worker dispatch
            // so byte-identical attachments never trigger redundant worker parses.
            let contentHash = null;
            let duplicateOf = null;
            if (file?.filePath && fs.existsSync(file.filePath)) {
                try {
                    const bytes = fs.readFileSync(file.filePath);
                    contentHash = crypto.createHash('sha256').update(bytes).digest('hex');
                    if (canonicalByHash.has(contentHash)) {
                        duplicateOf = canonicalByHash.get(contentHash);
                    }
                } catch {
                    // Let inspectSingleDocument classify unreadable paths.
                }
            }

            let record;
            if (duplicateOf) {
                const canonical = await duplicateOf;
                record = {
                    ...canonical,
                    index,
                    docId: computeDocId(contentHash, file, index),
                    filePath: file?.filePath || canonical.filePath,
                    fileName: file?.text || file?.fileName || path.basename(file?.filePath || 'nepoznata datoteka'),
                    sourceEntryIndex: file?.sourceEntryIndex ?? file?.entryIndex ?? null,
                    sourceDocumentLinkId: file?.sourceDocumentLinkId ?? file?.documentLinkId ?? null,
                    entryDate: file?.entryDate ?? null,
                    entryTitle: file?.entryTitle ?? null,
                    entryDisplayId: file?.entryDisplayId ?? null,
                    isDuplicate: true,
                    dedupedOfDocId: canonical.docId,
                    file,
                };
            } else {
                const inspectPromise = (async () => {
                    try {
                        return await inspectSingleDocument({ file, index, sqliteStore, workerPool: pool, signal });
                    } catch (error) {
                        if (signal?.aborted) throw error;
                        return buildPreflightDocumentRecord(file, index, {
                            contentHash,
                            docClass: 'empty_or_corrupt',
                            reasonCode: EXTRACTION_ERROR_CODES.PDF_CORRUPT,
                            error: error?.message || String(error),
                        });
                    }
                })();
                if (contentHash) canonicalByHash.set(contentHash, inspectPromise);
                record = await inspectPromise;
            }

            results[index] = record;
            completed += 1;
            if (record.docClass === 'empty_or_corrupt') failed += 1;
            await emitPreflightProgress();
        }
    };

    if (list.length > 0) {
        await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => runWorker()));
    }

    const ballpark = estimatePreflightCostBallpark(results);
    const manifest = {
        ...ballpark,
        generatedAt: new Date().toISOString(),
        documents: results.map((doc) => ({
            docId: doc.docId,
            fileName: doc.fileName,
            sourceEntryIndex: doc.sourceEntryIndex,
            docClass: doc.docClass,
            pageCount: doc.pageCount,
            ocrPagesCount: doc.ocrPages.length,
            blankPagesCount: doc.blankPages.length,
            tableDense: doc.tableDense,
            fromCache: doc.fromCache,
            adminFastPathEligible: doc.adminFastPathEligible,
            isDuplicate: doc.isDuplicate,
            dedupedOfDocId: doc.dedupedOfDocId,
            reasonCode: doc.reasonCode,
        })),
    };

    if (runId && sqliteStore?.updateAnalysisRunPreflight) {
        sqliteStore.updateAnalysisRunPreflight({ analysisId: runId, preflight: manifest });
    }
    if (runBus && runId) {
        await runBus.publish({
            runId,
            eventType: 'run.preflight',
            message: `Stage T0 preflight: ${ballpark.digitalDocs} digital, ${ballpark.scannedDocs} scan, ${ballpark.hybridDocs} hybrid (${ballpark.ocrPages} OCR str.)`,
            metadata: {
                stage: 'preflight',
                preflight: {
                    estimatedMinUsd: ballpark.estimatedMinUsd,
                    estimatedExpectedUsd: ballpark.estimatedExpectedUsd,
                    cachedHits: ballpark.cachedHits,
                    ocrPages: ballpark.ocrPages,
                    digitalDocs: ballpark.digitalDocs,
                    scannedDocs: ballpark.scannedDocs,
                    hybridDocs: ballpark.hybridDocs,
                    corruptDocs: ballpark.corruptDocs,
                    duplicateDocs: ballpark.duplicateDocs,
                    adminFastPathDocs: ballpark.adminFastPathDocs,
                    totalDocs: ballpark.totalDocs,
                },
            },
        });
    }

    return { manifest, documents: results };
}

module.exports = {
    PREFLIGHT_MISTRAL_USD_PER_PAGE,
    PREFLIGHT_AVG_EXTRACTION_USD_PER_DOC,
    computeDocId,
    estimatePreflightCostBallpark,
    preflightClusterDocuments,
    inspectSingleDocument,
};
