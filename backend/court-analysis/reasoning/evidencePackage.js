const { deriveEntryDisplayId } = require('../utils/entryDisplayId');
const { collectMoneyFlows } = require('./moneyFlow');
const { collectPropertyFlows, reconcilePropertyFlows } = require('./propertyFlow');
const { reconcileMoneyFlows } = require('./reconciliation');
const { countGroundedClaims } = require('./grounding');
const { classifyFileFailure } = require('../../helpers/friendlyAnalysisError');

function normalizeAcquisition(entry) {
    const acquisition = entry?.acquisition || entry?.caseInfo?.acquisition || {};

    return {
        mode: acquisition.mode || 'unknown',
        currentPage: acquisition.currentPage ?? null,
        sourceCaseNumber: acquisition.sourceCaseNumber || entry?.caseNumber || entry?.caseInfo?.caseNumber || null,
        pass: acquisition.pass ?? null,
        strategy: acquisition.strategy || null,
        reason: acquisition.reason || null
    };
}

function mapDocumentLink(link, entry, entryIndex, linkIndex) {
    const acquisition = normalizeAcquisition(entry);
    const caseNumber = entry?.caseNumber || entry?.caseInfo?.caseNumber || null;

    return {
        id: `${caseNumber || 'unknown'}::entry-${entryIndex + 1}::doc-${linkIndex + 1}`,
        url: link?.url || null,
        text: link?.text || null,
        entryIndex,
        entryTitle: entry?.caseInfo?.title || null,
        entryDisplayId: deriveEntryDisplayId(entry?.caseInfo?.detailLink),
        caseNumber,
        acquisition,
        sourceProvenance: {
            acquisitionMode: acquisition.mode,
            currentPage: acquisition.currentPage,
            sourceCaseNumber: acquisition.sourceCaseNumber,
            pass: acquisition.pass,
            strategy: acquisition.strategy,
            reason: acquisition.reason,
            entryDetailLink: entry?.caseInfo?.detailLink || null
        }
    };
}

function mapEntry(entry, entryIndex) {
    const caseInfo = entry?.caseInfo || {};
    const acquisition = normalizeAcquisition(entry);
    const documentLinks = Array.isArray(entry?.documentLinks)
        ? entry.documentLinks.map((link, linkIndex) => mapDocumentLink(link, entry, entryIndex, linkIndex))
        : [];

    return {
        index: entryIndex,
        caseNumber: entry?.caseNumber || caseInfo.caseNumber || null,
        title: caseInfo.title || null,
        court: caseInfo.court || null,
        date: caseInfo.date || caseInfo.datePublished || null,
        detailLink: caseInfo.detailLink || null,
        entryDisplayId: deriveEntryDisplayId(caseInfo.detailLink),
        participants: Array.isArray(caseInfo.participants) ? caseInfo.participants : [],
        acquisition,
        documentLinks
    };
}

function buildClusterEvidencePackage({ cluster, clusterSummary, discoverySummary, query }) {
    if (!cluster) {
        return null;
    }

    const clusterId = cluster.clusterId || cluster.caseNumber || clusterSummary?.clusterId || null;
    const reasoningClusterId = discoverySummary?.reasoningClusterId || discoverySummary?.recommendedPrimaryClusterId || null;

    if (reasoningClusterId && clusterId !== reasoningClusterId) {
        throw new Error(`ClusterEvidencePackage can only be built for the selected reasoning cluster (${reasoningClusterId}); received ${clusterId}.`);
    }

    const entries = (Array.isArray(cluster.entries) ? cluster.entries : []).map(mapEntry);
    const documentLinks = entries.flatMap((entry) => entry.documentLinks || []);

    return {
        packageType: 'ClusterEvidencePackage',
        schemaVersion: 1,
        reasoningScope: 'single-cluster',
        selectedClusterIds: clusterId ? [clusterId] : [],
        clusterId,
        primaryCaseNumber: clusterSummary?.primaryCaseNumber || cluster.caseNumber || null,
        query: query || discoverySummary?.query || null,
        identity: {
            consistency: clusterSummary?.identityConsistency || 'unresolved',
            notes: clusterSummary?.identityNotes || [],
            participantNames: clusterSummary?.participantNames || [],
            participantOibs: clusterSummary?.participantOibs || []
        },
        discovery: {
            reasoningClusterId,
            recommendedPrimaryClusterId: discoverySummary?.recommendedPrimaryClusterId || null,
            secondaryClusterIds: discoverySummary?.secondaryClusterIds || [],
            discoveryMode: discoverySummary?.discoveryMode || null,
            acquisitionModes: discoverySummary?.acquisitionModes || [],
            acquisitionProvenance: discoverySummary?.acquisitionProvenance || [],
            totalResults: discoverySummary?.totalResults ?? null,
            totalPages: discoverySummary?.totalPages ?? null,
            pagesScanned: discoverySummary?.pagesScanned ?? null,
            rawEntryCount: discoverySummary?.rawEntryCount ?? null,
            capturedDistinctCaseCount: discoverySummary?.capturedDistinctCaseCount ?? null,
            coverageConfidence: discoverySummary?.coverageConfidence || null
        },
        selection: {
            selectedForReasoning: true,
            score: clusterSummary?.score ?? null,
            reason: clusterSummary?.selectionReason || null,
            diagnostics: clusterSummary?.selectionDiagnostics || null
        },
        expansion: {
            eligibility: clusterSummary?.expansionEligibility || discoverySummary?.expansionEligibility || null,
            plan: clusterSummary?.expansionPlan || discoverySummary?.expansionPlan || null,
            execution: clusterSummary?.expansion || discoverySummary?.expansion || null
        },
        acquisition: {
            modes: clusterSummary?.acquisitionModes || [],
            provenance: clusterSummary?.acquisitionProvenance || [],
            entryCountsByMode: clusterSummary?.entryCountsByAcquisitionMode || {},
            documentCountsByMode: clusterSummary?.documentCountsByAcquisitionMode || {}
        },
        entries,
        documentLinks
    };
}

/**
 * Attaches per-document AI analysis results to a cluster evidence package so the
 * reasoning engine (synthesizer + lexical retriever) can ground claims in real
 * document content instead of structural metadata (titles/links) alone.
 *
 * Only successful analyses (`aiResult` present) become first-class sources;
 * failures are surfaced via the `coverage` block for transparency.
 *
 * @param {object|null} pkg - The cluster evidence package (pre-analysis).
 * @param {Array<object>} processedCases - Fully processed cases from the pipeline.
 * @param {string|null} [clusterId] - Only attach analyses belonging to this cluster.
 * @returns {object|null} A shallow-copied package enriched with `analyses` + `coverage`.
 */
function attachAnalysesToEvidencePackage(pkg, processedCases, clusterId = null) {
    if (!pkg) return pkg;

    const selectedCase = (Array.isArray(processedCases) ? processedCases : []).find((processedCase) => {
        const candidateId = processedCase?.groupMetadata?.clusterId || processedCase?.caseResult?.caseNumber;
        return !clusterId || candidateId === clusterId;
    });

    const individualAnalyses = Array.isArray(selectedCase?.analysis?.individualAnalyses)
        ? selectedCase.analysis.individualAnalyses
        : [];

    const analyses = [];
    // Ground-truth chunks (Phase 0.1): collected from BOTH successful analyses
    // and analysis-failures-with-extracted-text. The chunk-only branch is the
    // point of the exercise — quota-failed files keep contributing grounding.
    const chunks = [];
    for (const item of individualAnalyses) {
        const itemChunks = Array.isArray(item?.retrievalChunks) ? item.retrievalChunks : [];
        if (itemChunks.length === 0) continue;
        const itemFileName = item.text || item.filePath || 'nepoznata datoteka';
        for (const chunk of itemChunks) {
            chunks.push({
                id: chunk.id,
                text: chunk.text,
                metadata: {
                    fileName: itemFileName,
                    caseNumber: pkg.clusterId || null,
                    startIndex: chunk.metadata?.startIndex ?? null,
                    endIndex: chunk.metadata?.endIndex ?? null
                }
            });
        }
    }

    for (const item of individualAnalyses) {
        if (!item?.aiResult) continue;
        analyses.push({
            id: item.filePath || item.text || `analysis-${analyses.length + 1}`,
            fileName: item.text || item.filePath || null,
            filePath: item.filePath || null,
            caseNumber: item.aiResult.caseNumber || pkg.clusterId || null,
            decisionDate: item.aiResult.decisionDate || null,
            summary: item.aiResult.summary || null,
            parties: Array.isArray(item.aiResult.parties) ? item.aiResult.parties : [],
            amounts: Array.isArray(item.aiResult.amounts) ? item.aiResult.amounts : [],
            propertyFlow: Array.isArray(item.aiResult.propertyFlow) ? item.aiResult.propertyFlow : []
        });
    }

    const moneyFlow = collectMoneyFlows(analyses);
    const propertyFlow = collectPropertyFlows(analyses);
    // Deterministic reconciliation (Phase 0.3): arithmetic conflicts are
    // computed here and seeded into the report by the synthesizer — the
    // single ownership chain pkg.reconciliation → meta → report.conflicts.
    const moneyReconciliation = reconcileMoneyFlows(moneyFlow);
    const propertyReconciliation = reconcilePropertyFlows(propertyFlow);
    const reconciliation = {
        conflicts: [...(moneyReconciliation.conflicts || []), ...(propertyReconciliation.conflicts || [])],
        openQuestions: [...(moneyReconciliation.openQuestions || []), ...(propertyReconciliation.openQuestions || [])],
    };

    const total = individualAnalyses.length;
    const analyzed = analyses.length;
    const failedFiles = individualAnalyses
        .filter((item) => !item?.aiResult)
        .map((item) => {
            const classified = classifyFileFailure(item.error);
            return {
                fileName: item.text || item.filePath || 'nepoznata datoteka',
                code: classified.code,
                reason: classified.reason,
            };
        });

    const coverage = {
        analyzed,
        failed: total - analyzed,
        total,
        coverageRatio: total > 0 ? Number((analyzed / total).toFixed(2)) : 0,
        complete: total > 0 && analyzed === total,
        failedFiles,
        ...countGroundedClaims(analyses),
    };

    return {
        ...pkg,
        analyses,
        chunks,
        coverage,
        moneyFlow,
        propertyFlow,
        propertyReconciliation,
        reconciliation
    };
}

function validateClusterEvidencePackage(pkg) {
    if (!pkg || typeof pkg !== 'object') {
        return { valid: false, error: 'ClusterEvidencePackage must be an object.' };
    }

    if (pkg.packageType !== 'ClusterEvidencePackage') {
        return { valid: false, error: 'ClusterEvidencePackage packageType must be "ClusterEvidencePackage".' };
    }

    if (pkg.reasoningScope !== 'single-cluster') {
        return { valid: false, error: 'ClusterEvidencePackage reasoningScope must be "single-cluster".' };
    }

    if (!Array.isArray(pkg.selectedClusterIds) || pkg.selectedClusterIds.length !== 1) {
        return { valid: false, error: 'ClusterEvidencePackage must contain exactly one selectedClusterIds item.' };
    }

    if (!pkg.clusterId || pkg.selectedClusterIds[0] !== pkg.clusterId) {
        return { valid: false, error: 'ClusterEvidencePackage clusterId must match its only selectedClusterIds item.' };
    }

    const reasoningClusterId = pkg.discovery?.reasoningClusterId;
    if (reasoningClusterId && reasoningClusterId !== pkg.clusterId) {
        return { valid: false, error: 'ClusterEvidencePackage clusterId must match discovery.reasoningClusterId.' };
    }

    if (Array.isArray(pkg.discovery?.secondaryClusterIds) && pkg.discovery.secondaryClusterIds.includes(pkg.clusterId)) {
        return { valid: false, error: 'ClusterEvidencePackage clusterId cannot be listed as a secondary cluster.' };
    }

    const entries = Array.isArray(pkg.entries) ? pkg.entries : [];
    const mixedEntry = entries.find((entry) => entry?.caseNumber && entry.caseNumber !== pkg.clusterId);
    if (mixedEntry) {
        return { valid: false, error: `ClusterEvidencePackage contains an entry from a different cluster: ${mixedEntry.caseNumber}.` };
    }

    const documentLinks = Array.isArray(pkg.documentLinks) ? pkg.documentLinks : [];
    const mixedDocument = documentLinks.find((link) => link?.caseNumber && link.caseNumber !== pkg.clusterId);
    if (mixedDocument) {
        return { valid: false, error: `ClusterEvidencePackage contains a document link from a different cluster: ${mixedDocument.caseNumber}.` };
    }

    return { valid: true };
}

module.exports = {
    buildClusterEvidencePackage,
    attachAnalysesToEvidencePackage,
    validateClusterEvidencePackage
};
