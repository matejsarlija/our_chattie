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
                    aiResult: item.aiResult,
                    error: item.error
                }))
                : [],
            coverage: processedCase?.analysis?.coverage || null
        },
        groupMetadata: processedCase?.groupMetadata || null
    };
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
        clusterEvidencePackage: finalResult?.clusterEvidencePackage || null,
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
