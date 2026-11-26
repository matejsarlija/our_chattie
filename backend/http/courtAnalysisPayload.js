const { sanitizeMarkdown } = require('./sanitize');
const { deriveEntryDisplayId } = require('../court-analysis/utils/entryDisplayId');

function mapProcessedCase(processedCase) {
    return {
        caseResult: {
            title: processedCase?.caseResult?.title,
            caseNumber: processedCase?.caseResult?.caseNumber,
            court: processedCase?.caseResult?.court,
            date: processedCase?.caseResult?.date,
            detailLink: processedCase?.caseResult?.detailLink,
            entryDisplayId: deriveEntryDisplayId(processedCase?.caseResult?.detailLink),
            participants: processedCase?.caseResult?.participants,
        },
        files: Array.isArray(processedCase?.files)
            ? processedCase.files.map((file) => ({ url: file.url, text: file.text }))
            : [],
        analysis: {
            individualAnalyses: Array.isArray(processedCase?.analysis?.individualAnalyses)
                ? processedCase.analysis.individualAnalyses.map((item) => ({
                    fileName: item.text,
                    error: item.error,
                    ...(item.docId !== undefined ? { docId: item.docId } : {}),
                    ...(item.docClass !== undefined ? { docClass: item.docClass } : {}),
                    ...(item.ocrEngine !== undefined ? { ocrEngine: item.ocrEngine } : {}),
                    ...(item.fromCache !== undefined ? { fromCache: Boolean(item.fromCache) } : {}),
                    ...(item.adminFastPath !== undefined ? { adminFastPath: Boolean(item.adminFastPath) } : {}),
                    ...(item.pageCount !== undefined ? { pageCount: item.pageCount } : {}),
                    ...(Array.isArray(item.skippedPageRanges) && item.skippedPageRanges.length > 0
                        ? { skippedPageRanges: item.skippedPageRanges }
                        : {}),
                    ...(item.reasonCode !== undefined ? { reasonCode: item.reasonCode } : {}),
                }))
                : [],
            coverage: processedCase?.analysis?.coverage || null
        },
        groupMetadata: processedCase?.groupMetadata || null
    };
}
function slimAnalysisForArtifact(analysis) {
    if (!analysis || typeof analysis !== 'object') return analysis;
    return {
        id: analysis.id ?? null,
        docId: analysis.docId ?? null,
        fileName: analysis.fileName ?? null,
        caseNumber: analysis.caseNumber ?? null,
        decisionDate: analysis.decisionDate ?? null,
        decisionOutcome: analysis.decisionOutcome ?? null,
        entryDate: analysis.entryDate ?? null,
        sourceEntryIndex: analysis.sourceEntryIndex ?? null,
        sourceDocumentLinkId: analysis.sourceDocumentLinkId ?? null,
        extraction: analysis.extraction ?? null,
        summary: analysis.summary ?? null,
        ...(analysis.truncated ? { truncated: true } : {}),
        ...(analysis.degraded ? { degraded: true } : {}),
    };
}

function mapClusterEvidencePackage(pkg) {
    if (!pkg || typeof pkg !== 'object') return pkg || null;
    const { chunks, factLedger, analyses, ...rest } = pkg;
    const mapped = { ...rest };
    if (Array.isArray(chunks) && chunks.length > 0) {
        mapped.chunkCount = chunks.length;
    }
    if (Array.isArray(factLedger)) {
        mapped.factLedgerCount = factLedger.length;
    }
    if (Array.isArray(analyses)) {
        mapped.analyses = analyses.map(slimAnalysisForArtifact);
    }
    return mapped;
}


function buildCourtAnalysisPayload(finalResult) {
    const sanitizedComparativeAnalysis = sanitizeMarkdown(finalResult?.comparativeAnalysis || '');

    return {
        processedCases: Array.isArray(finalResult?.processedCases)
            ? finalResult.processedCases.map(mapProcessedCase)
            : [],
        comparativeAnalysis: sanitizedComparativeAnalysis,
        discoverySummary: finalResult?.discoverySummary || null,
        primaryCluster: finalResult?.primaryCluster || null,
        secondaryClusters: Array.isArray(finalResult?.secondaryClusters)
            ? finalResult.secondaryClusters
            : [],
        clusterEvidencePackage: mapClusterEvidencePackage(finalResult?.clusterEvidencePackage),
        report: finalResult?.report || null,
        // Present only when generateClusterReport failed but per-document analyses
        // still succeeded (see pipeline.js processScrapedCases); null on the
        // normal, fully-synthesized path.
        reportError: finalResult?.reportError || null,
        usage: finalResult?.usage || null
    };
}

module.exports = {
    buildCourtAnalysisPayload
};
