'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { downloadClusterAttachments } = require('./downloader');
const { extractArchiveFiles } = require('./archiveExtractor');
const { buildStageCounterEvent } = require('../../http/analysisStage');
const { deriveEntryDisplayId } = require('../utils/entryDisplayId');
const logger = require('../../services/logger');

function buildProvenanceLookups(cluster) {
    const byUrl = new Map();
    (cluster?.entries || []).forEach((rawEntry, rawEntryIndex) => {
        const rawCaseNumber = rawEntry?.caseNumber || rawEntry?.caseInfo?.caseNumber || 'unknown';
        const entryDate = rawEntry?.entryDate ?? rawEntry?.caseInfo?.date ?? null;
        const entryTitle = rawEntry?.caseInfo?.title || rawEntry?.title || null;
        const detailLink = rawEntry?.caseInfo?.detailLink || rawEntry?.detailLink || null;
        const entryDisplayId = deriveEntryDisplayId(detailLink);
        const role = rawEntry?.role || rawEntry?.entryRole || null;

        (rawEntry?.documentLinks || []).forEach((rawLink, rawLinkIndex) => {
            if (!rawLink?.url || byUrl.has(rawLink.url)) return;
            const linkId = rawLink?.id
                ?? rawLink?.documentLinkId
                ?? `${rawCaseNumber}::entry-${rawEntryIndex + 1}::doc-${rawLinkIndex + 1}`;
            byUrl.set(rawLink.url, {
                sourceEntryIndex: rawEntryIndex,
                sourceDocumentLinkId: linkId,
                entryDate,
                entryTitle,
                entryDisplayId,
                detailLink,
                role,
            });
        });
    });
    return byUrl;
}

function tagFileProvenance(file, lookupByUrl) {
    const found = file?.url && lookupByUrl.has(file.url) ? lookupByUrl.get(file.url) : {};
    return {
        sourceEntryIndex: file?.sourceEntryIndex ?? file?.entryIndex ?? found.sourceEntryIndex ?? null,
        sourceDocumentLinkId: file?.sourceDocumentLinkId ?? file?.documentLinkId ?? found.sourceDocumentLinkId ?? null,
        entryDate: file?.entryDate ?? found.entryDate ?? null,
        entryTitle: file?.entryTitle ?? found.entryTitle ?? null,
        entryDisplayId: file?.entryDisplayId ?? found.entryDisplayId ?? deriveEntryDisplayId(file?.detailLink),
        role: file?.role ?? found.role ?? null,
    };
}

async function acquireClusterFiles({ cluster, caseInfo, progressCallback, signal }) {
    const documentLinks = (cluster?.entries || []).flatMap((e) => e.documentLinks || []);
    const lookupByUrl = buildProvenanceLookups(cluster);
    const extractedFilePaths = [];

    progressCallback?.({
        step: 'downloading',
        message: `Preuzimam arhivu za predmet ${caseInfo.caseNumber} (${documentLinks.length} linkova)...`,
    });

    let downloadFailed = 0;
    const downloadedFiles = await downloadClusterAttachments({
        documentLinks,
        progressCallback: (event) => {
            progressCallback?.(event);
            if (event && Number.isFinite(event.completed) && Number.isFinite(event.total)) {
                if (event.failed === true) downloadFailed += 1;
                progressCallback?.(buildStageCounterEvent({
                    stage: 'downloading',
                    done: event.completed,
                    failed: downloadFailed,
                    total: event.total,
                    unit: 'datoteka',
                }));
            }
        },
        signal,
    });

    progressCallback?.({
        step: 'downloading',
        message: `Preuzeto ${downloadedFiles.length}/${documentLinks.length} datoteka za predmet ${caseInfo.caseNumber}.`,
    });

    if (signal?.aborted) {
        throw signal.reason || Object.assign(new Error('Analysis aborted.'), { name: 'AbortError' });
    }

    progressCallback?.({
        step: 'extracting',
        message: `Raspakiram datoteke za predmet ${caseInfo.caseNumber}...`,
    });

    const filesForAnalysis = [];
    let extractedCount = 0;
    const emitExtractCounter = () => progressCallback?.(buildStageCounterEvent({
        stage: 'extracting',
        done: extractedCount,
        total: null,
        unit: 'datoteka',
    }));

    let preflightDone = 0;
    progressCallback?.(buildStageCounterEvent({
        stage: 'preflight',
        done: 0,
        total: downloadedFiles.length,
        unit: 'datoteka',
    }));

    for (const file of downloadedFiles) {
        if (signal?.aborted) {
            throw signal.reason || Object.assign(new Error('Analysis aborted.'), { name: 'AbortError' });
        }
        extractedFilePaths.push(file.filePath);
        const provenance = tagFileProvenance(file, lookupByUrl);

        if (path.extname(file.filePath).toLowerCase() === '.zip') {
            const uploadsDir = path.resolve(__dirname, '../../uploads');
            const extractionDir = path.join(uploadsDir, 'extracted', crypto.randomUUID());
            const extractionResult = await extractArchiveFiles({
                filePath: file.filePath,
                destination: extractionDir,
                ...provenance,
            });
            if (extractionResult.status !== 'success') {
                logger.agent.warn(`[ArchiveExtractor] Failed to extract ${file.filePath}: ${extractionResult.error_message}`);
            }
            for (const extracted of (extractionResult.extractedFiles || [])) {
                filesForAnalysis.push({
                    ...extracted,
                    ...provenance,
                    sourceEntryIndex: extracted.sourceEntryIndex ?? provenance.sourceEntryIndex,
                    sourceDocumentLinkId: extracted.sourceDocumentLinkId ?? provenance.sourceDocumentLinkId,
                    entryDate: extracted.entryDate ?? provenance.entryDate,
                    text: extracted.entryName,
                    url: file.url,
                });
                extractedFilePaths.push(extracted.filePath);
                extractedCount += 1;
                emitExtractCounter();
            }
            extractedFilePaths.push(extractionDir);
        } else {
            filesForAnalysis.push({ ...file, ...provenance });
            extractedCount += 1;
            emitExtractCounter();
        }

        preflightDone += 1;
        progressCallback?.(buildStageCounterEvent({
            stage: 'preflight',
            done: preflightDone,
            total: downloadedFiles.length,
            unit: 'datoteka',
        }));
    }

    const fileTypeCounts = filesForAnalysis.reduce((counts, file) => {
        const ext = (path.extname(file.filePath || '').toLowerCase().replace('.', '')) || 'ostalo';
        counts[ext] = (counts[ext] || 0) + 1;
        return counts;
    }, {});
    const typeBreakdown = Object.entries(fileTypeCounts)
        .map(([ext, count]) => `${ext.toUpperCase()}: ${count}`)
        .join(', ');

    progressCallback?.({
        step: 'extracting',
        message: `Za analizu pripremljeno ${filesForAnalysis.length} datoteka${typeBreakdown ? ` (${typeBreakdown})` : ''}.`,
    });
    progressCallback?.(buildStageCounterEvent({
        stage: 'extracting',
        done: filesForAnalysis.length,
        total: filesForAnalysis.length,
        unit: 'datoteka',
    }));

    return {
        downloadedFiles,
        filesForAnalysis,
        cleanupPaths: extractedFilePaths,
    };
}

async function cleanupFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    for (const filePath of filePaths) {
        try {
            if (fs.existsSync(filePath)) {
                const stats = await fs.promises.lstat(filePath);
                if (stats.isDirectory()) {
                    await fs.promises.rm(filePath, { recursive: true, force: true });
                } else {
                    await fs.promises.unlink(filePath);
                }
            }
        } catch (err) {
            logger.agent.warn(`Failed to delete temporary file ${filePath}: ${err.message}`);
        }
    }
}

module.exports = {
    acquireClusterFiles,
    cleanupFiles,
};
