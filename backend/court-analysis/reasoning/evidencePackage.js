const { deriveEntryDisplayId } = require('../utils/entryDisplayId');

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
    validateClusterEvidencePackage
};
