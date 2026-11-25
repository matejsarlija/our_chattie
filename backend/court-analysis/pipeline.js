// pipeline.js

const { createDiscoveryClient } = require('../scraper/discoveryClient');
const { downloadClusterAttachments } = require('./agents/download-agent');
const { extractArchiveFiles } = require('./agents/extract-tool');
const { analyzeClusterDocuments } = require('./agents/analysis-agent');
const { enrichParticipants } = require('../court-registry/enricher');
const { groupEntriesByCase } = require('./utils/grouping');
const { parseCaseDateToTimestamp } = require('./utils/caseDate');
const { selectPrimaryCase } = require('./utils/primaryCaseSelector');
const { stratifyClusterEntries } = require('./utils/stratify');
const { buildStageCounterEvent } = require('../helpers/analysisStage');
const { normalizeCaseNumber } = require('./utils/caseNumber');
const { resolveScanDepthEntries, COURT_ENTRIES_PER_PAGE } = require('./utils/scanDepth');
const { buildClusterEvidencePackage, attachAnalysesToEvidencePackage } = require('./reasoning/evidencePackage');
const { generateClusterReport, composeOverviewMarkdown } = require('./reasoning/reportService');
const { createUsageTracker } = require('../helpers/geminiUsage');
const fs = require('fs');
const path = require('path');
const logger = require('../helpers/logger');
const agentLog = require('../helpers/agentLog');

/**
 * Error carrying whatever partial results were accumulated before a pipeline stage
 * failed. Allows the API layer to persist discovery/partial data alongside a
 * transparent error instead of discarding everything.
 */
class PartialAnalysisError extends Error {
    constructor(message, partialResult = null, options = {}) {
        super(message);
        this.name = 'PartialAnalysisError';
        this.partialResult = partialResult || null;
        this.stage = options.stage || null;
    }
}

function buildEmptyPartialResult() {
    return {
        processedCases: [],
        comparativeAnalysis: null,
        discoverySummary: null,
        primaryCluster: null,
        secondaryClusters: [],
        clusterEvidencePackage: null,
        report: null,
        reportError: null,
        usage: null
    };
}

// Reuses the per-case coverage objects the analysis tool already computed —
// never recomputed here, so the summary can never disagree with them.
function sumDocumentCoverage(processedCases) {
    return (processedCases || []).reduce(
        (totals, processedCase) => ({
            analyzed: totals.analyzed + (processedCase?.analysis?.coverage?.analyzed ?? 0),
            failed: totals.failed + (processedCase?.analysis?.coverage?.failed ?? 0),
        }),
        { analyzed: 0, failed: 0 }
    );
}

// Degraded-but-useful overview for when generateClusterReport fails (dense-
// cluster JSON truncation, model hiccups, etc.). The per-document analyses
// already cost real Gemini calls and are real, verified content — losing them
// just because the cross-document synthesis pass failed would throw away the
// expensive part to protect the cheap part. Mirrors composeOverviewMarkdown's
// shape (plain markdown sections) without inventing cross-document findings.
function composeFallbackOverviewMarkdown(allProcessedCases) {
    const lines = [];
    for (const processedCase of allProcessedCases || []) {
        const individualAnalyses = Array.isArray(processedCase?.analysis?.individualAnalyses)
            ? processedCase.analysis.individualAnalyses
            : [];
        for (const item of individualAnalyses) {
            const summary = String(item?.aiResult?.summary || '').trim();
            if (summary) lines.push(`- ${summary}`);
        }
    }
    if (lines.length === 0) return '';
    return (
        `## Sa\u017eeci pojedina\u010dnih dokumenata\n${lines.join('\n')}\n\n` +
        '_Napomena: cjeloviti stru\u010dni izvje\u0161taj trenutno nije dostupan, ali su pojedina\u010dne analize dokumenata prikazane iznad._'
    );
}

// Placeholder strings emitted by the reasoning layer when synthesis has no
// usable evidence (createEmptyReport). They carry no analyzable substance, so



// ANALYSIS_SCRAPE_LIMIT is a composed safety valve, not an override that
// ignores the scan-depth selection. Given an explicit positive limit, the
// smaller of that value and the current scan-depth entry cap wins.
function resolveAnalysisScrapeLimit() {
    const raw = Number.parseInt(process.env.ANALYSIS_SCRAPE_LIMIT, 10);
    if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
    return null;
}

const CLUSTER_SELECTION_DEFAULTS = {
    entryCountScoreWeight: 0.35,
    entryDateSpanScoreWeight: 0.30,
    recencyScoreWeight: 0.20,
    dominanceScoreWeight: 0.10,
    documentScoreWeight: 0.05,
    targetPrimaryClusterEntries: 10,
    strongPrimaryClusterSpanDays: 730,
};
const DISCOVERY_HEURISTICS_DEFAULTS = {
    maxPagesScanned: 5,
    minEntriesBeforeStop: 8,
    targetPrimaryClusterEntries: 10,
    noNewClusterPageLimit: 2,
    sufficientPrimaryClusterSpanDays: 365,
    strongPrimaryClusterSpanDays: 730,
    dominantClusterRatioThreshold: 0.65
};

function computeRawScrapeLimit(maxEntries) {
    const envLimit = resolveAnalysisScrapeLimit();
    if (envLimit !== null) return Math.min(envLimit, maxEntries);
    return maxEntries;
}

// Resolves the scan-depth dial into court-entry counts, then derives the
// page-based fields still required by the Puppeteer fallback. One court entry
// is one e-Oglasna announcement row; a court case or cluster can span many
// court entries.
function resolveScanDepth(scanDepth) {
    const depth = resolveScanDepthEntries(scanDepth);
    return {
        scanDepth: depth.scanDepth,
        maxPagesScanned: depth.scanDepth === 'full'
            ? Infinity
            : Math.ceil(depth.forwardEntries / COURT_ENTRIES_PER_PAGE),
        tailSample: depth.tailEntries > 0,
        maxEntries: depth.maxEntries
    };
}

function collectClusterParticipantSignals(cluster) {
    const participantNames = new Set();
    const oibs = new Set();
    const debtorOibs = new Set();

    for (const entry of cluster.entries || []) {
        const debtorOib = entry?.caseInfo?.debtorOib;
        if (typeof debtorOib === 'string' && debtorOib.trim() && debtorOib.trim() !== 'N/A') {
            debtorOibs.add(debtorOib.trim());
        }

        for (const participant of entry?.caseInfo?.participants || []) {
            if (participant?.name) {
                participantNames.add(participant.name.trim());
            }

            const oib = typeof participant?.oib === 'string' ? participant.oib.trim() : '';
            if (oib && oib !== 'N/A') {
                oibs.add(oib);
            }
        }
    }

    return {
        participantNames: Array.from(participantNames),
        oibs: Array.from(oibs),
        debtorOibs: Array.from(debtorOibs)
    };
}

function collectClusterAcquisitionSignals(cluster) {
    const acquisitionModes = new Set();
    const acquisitionProvenance = [];
    const seen = new Set();

    for (const entry of cluster.entries || []) {
        const acquisition = entry?.acquisition || entry?.caseInfo?.acquisition;
        if (!acquisition || !acquisition.mode) continue;

        acquisitionModes.add(acquisition.mode);
        const key = JSON.stringify({
            mode: acquisition.mode,
            sampling: acquisition.sampling ?? null,
            currentPage: acquisition.currentPage ?? null,
            sourceCaseNumber: entry?.caseNumber || entry?.caseInfo?.caseNumber || null,
            pass: acquisition.pass ?? null,
            strategy: acquisition.strategy ?? null,
            reason: acquisition.reason ?? null
        });

        if (!seen.has(key)) {
            seen.add(key);
            acquisitionProvenance.push({
                mode: acquisition.mode,
                sampling: acquisition.sampling ?? null,
                currentPage: acquisition.currentPage ?? null,
                sourceCaseNumber: entry?.caseNumber || entry?.caseInfo?.caseNumber || null,
                pass: acquisition.pass ?? null,
                strategy: acquisition.strategy ?? null,
                reason: acquisition.reason ?? null
            });
        }
    }

    return {
        acquisitionModes: Array.from(acquisitionModes),
        acquisitionProvenance
    };
}

function collectClusterAcquisitionModeCounts(cluster) {
    const entryCountsByAcquisitionMode = {};
    const documentCountsByAcquisitionMode = {};

    for (const entry of cluster.entries || []) {
        const mode = entry?.acquisition?.mode || entry?.caseInfo?.acquisition?.mode || 'unknown';
        entryCountsByAcquisitionMode[mode] = (entryCountsByAcquisitionMode[mode] || 0) + 1;
        documentCountsByAcquisitionMode[mode] = (documentCountsByAcquisitionMode[mode] || 0)
            + (Array.isArray(entry?.documentLinks) ? entry.documentLinks.length : 0);
    }

    return {
        entryCountsByAcquisitionMode,
        documentCountsByAcquisitionMode
    };
}

function determineIdentityConsistency(cluster, query) {
    const { participantNames, oibs, debtorOibs } = collectClusterParticipantSignals(cluster);

    // Authoritative entity OIB when the discovery source exposes a dedicated
    // debtor OIB column (CSV export); otherwise fall back to participant OIBs.
    // This prevents non-debtor participants (creditors, other parties) from
    // polluting the entity-identity signal for an OIB/entity query.
    const identityOibs = debtorOibs.length > 0 ? debtorOibs : oibs;

    if (query?.type === 'oib' && query?.value) {
        if (identityOibs.length === 1 && identityOibs[0] === query.value) {
            return { identityConsistency: 'consistent', identityNotes: [] };
        }

        if (identityOibs.length === 0) {
            return {
                identityConsistency: 'unresolved',
                identityNotes: [`Queried OIB ${query.value} is not visible in captured entity metadata.`]
            };
        }

        return {
            identityConsistency: 'ambiguous',
            identityNotes: [`Captured entity OIBs (${identityOibs.join(', ')}) do not cleanly match queried OIB ${query.value}.`]
        };
    }

    if (identityOibs.length > 1) {
        return {
            identityConsistency: 'ambiguous',
            identityNotes: [`Multiple entity OIBs detected in cluster: ${identityOibs.join(', ')}.`]
        };
    }

    if (identityOibs.length === 1) {
        return {
            identityConsistency: 'consistent',
            identityNotes: query?.type === 'text'
                ? ['Text query matched a single visible OIB in captured entries; same-name matches alone are not treated as proof beyond this cluster.']
                : []
        };
    }

    return {
        identityConsistency: 'unresolved',
        identityNotes: participantNames.length > 0
            ? ['Identity remains name-based only because participant OIB data is missing in captured entries.']
            : ['Identity could not be validated because participant metadata is missing in captured entries.']
    };
}

function summarizeCluster(cluster, index, query) {
    const entries = Array.isArray(cluster.entries) ? cluster.entries : [];
    const timestamps = entries
        .map(entry => parseCaseDateToTimestamp(entry?.caseInfo?.date || entry?.caseInfo?.datePublished))
        .filter(ts => ts !== null)
        .sort((a, b) => a - b);

    const oldestTimestamp = timestamps.length > 0 ? timestamps[0] : null;
    const newestTimestamp = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
    const documentCount = entries.reduce((sum, entry) => {
        return sum + (Array.isArray(entry?.documentLinks) ? entry.documentLinks.length : 0);
    }, 0);
    const { identityConsistency, identityNotes } = determineIdentityConsistency(cluster, query);
    const { participantNames, oibs } = collectClusterParticipantSignals(cluster);
    const { acquisitionModes, acquisitionProvenance } = collectClusterAcquisitionSignals(cluster);
    const { entryCountsByAcquisitionMode, documentCountsByAcquisitionMode } = collectClusterAcquisitionModeCounts(cluster);

    return {
        clusterId: cluster.clusterId || cluster.caseNumber || `anonymous-${index + 1}`,
        primaryCaseNumber: cluster.caseNumber || 'N/A',
        entryCount: entries.length,
        documentCount,
        oldestEntryDate: oldestTimestamp === null ? null : new Date(oldestTimestamp).toISOString(),
        newestEntryDate: newestTimestamp === null ? null : new Date(newestTimestamp).toISOString(),
        entryDateSpanDays: oldestTimestamp !== null && newestTimestamp !== null
            ? Math.round((newestTimestamp - oldestTimestamp) / (24 * 60 * 60 * 1000))
            : 0,
        score: 0,
        selectionReason: 'ranked by deterministic coverage-aware selection policy',
        participantNames,
        participantOibs: oibs,
        identityConsistency,
        identityNotes,
        acquisitionModes,
        acquisitionProvenance,
        entryCountsByAcquisitionMode,
        documentCountsByAcquisitionMode
    };
}

function scoreRecency(newestTimestamp, oldestNewestTimestamp, latestNewestTimestamp) {
    if (newestTimestamp === null) return 0;
    if (oldestNewestTimestamp === null || latestNewestTimestamp === null) return 0;
    if (latestNewestTimestamp === oldestNewestTimestamp) return 1;
    return (newestTimestamp - oldestNewestTimestamp) / (latestNewestTimestamp - oldestNewestTimestamp);
}

function getIdentitySelectionMultiplier(identityConsistency, queryType) {
    if (queryType === 'oib') {
        if (identityConsistency === 'consistent') return 1;
        if (identityConsistency === 'unresolved') return 0.6;
        return 0.2;
    }

    if (queryType === 'text') {
        if (identityConsistency === 'consistent') return 1;
        if (identityConsistency === 'unresolved') return 0.75;
        return 0.35;
    }

    return 1;
}

function buildClusterSummaries(allClusters, query) {
    const baseSummaries = allClusters.map((cluster, index) => summarizeCluster(cluster, index, query));
    const totalEntries = baseSummaries.reduce((sum, cluster) => sum + cluster.entryCount, 0);
    const newestTimestamps = baseSummaries
        .map((cluster) => cluster.newestEntryDate ? Date.parse(cluster.newestEntryDate) : null)
        .filter((timestamp) => timestamp !== null && !Number.isNaN(timestamp));
    const oldestNewestTimestamp = newestTimestamps.length > 0 ? Math.min(...newestTimestamps) : null;
    const latestNewestTimestamp = newestTimestamps.length > 0 ? Math.max(...newestTimestamps) : null;

    return baseSummaries.map((summary) => {
        const newestTimestamp = summary.newestEntryDate ? Date.parse(summary.newestEntryDate) : null;
        const entryCoverageScore = Math.min(
            summary.entryCount / CLUSTER_SELECTION_DEFAULTS.targetPrimaryClusterEntries,
            1
        );
        const spanCoverageScore = Math.min(
            summary.entryDateSpanDays / CLUSTER_SELECTION_DEFAULTS.strongPrimaryClusterSpanDays,
            1
        );
        const recencyScore = scoreRecency(newestTimestamp, oldestNewestTimestamp, latestNewestTimestamp);
        const dominanceScore = totalEntries > 0 ? summary.entryCount / totalEntries : 0;
        const documentCoverageScore = Math.min(
            summary.documentCount / CLUSTER_SELECTION_DEFAULTS.targetPrimaryClusterEntries,
            1
        );
        const weightedScore =
            (entryCoverageScore * CLUSTER_SELECTION_DEFAULTS.entryCountScoreWeight) +
            (spanCoverageScore * CLUSTER_SELECTION_DEFAULTS.entryDateSpanScoreWeight) +
            (recencyScore * CLUSTER_SELECTION_DEFAULTS.recencyScoreWeight) +
            (dominanceScore * CLUSTER_SELECTION_DEFAULTS.dominanceScoreWeight) +
            (documentCoverageScore * CLUSTER_SELECTION_DEFAULTS.documentScoreWeight);
        const identityMultiplier = getIdentitySelectionMultiplier(summary.identityConsistency, query?.type);
        const rawWeightedScore = Number(weightedScore.toFixed(4));
        const finalSelectionScore = Number((weightedScore * identityMultiplier).toFixed(4));

        return {
            ...summary,
            score: finalSelectionScore,
            selectionReason: 'ranked by deterministic coverage-aware selection policy (entry count, date span, recency, dominance, document coverage, and identity confidence when query intent is entity-oriented)',
            selectionDiagnostics: {
                queryType: query?.type || null,
                rawWeightedScore,
                identityMultiplier,
                finalSelectionScore,
                entryCoverageScore: Number(entryCoverageScore.toFixed(4)),
                spanCoverageScore: Number(spanCoverageScore.toFixed(4)),
                recencyScore: Number(recencyScore.toFixed(4)),
                dominanceScore: Number(dominanceScore.toFixed(4)),
                documentCoverageScore: Number(documentCoverageScore.toFixed(4))
            }
        };
    });
}

function selectClustersForProcessing(allClusters, clusterSummaries) {
    if (!Array.isArray(allClusters) || allClusters.length === 0) {
        return [];
    }

    const scoreByClusterId = new Map(
        (clusterSummaries || []).map((summary) => [summary.clusterId, summary])
    );

    const scored = allClusters.map((cluster, originalIndex) => {
        const clusterId = cluster.clusterId || cluster.caseNumber || `anonymous-${originalIndex + 1}`;
        const summary = scoreByClusterId.get(clusterId);
        const newestTimestamp = summary?.newestEntryDate ? Date.parse(summary.newestEntryDate) : null;

        return {
            cluster,
            originalIndex,
            score: summary?.score ?? 0,
            newestTimestamp,
            documentCount: summary?.documentCount ?? 0,
        };
    });

    scored.sort((a, b) => {
        if (a.score !== b.score) {
            return b.score - a.score;
        }

        if (a.newestTimestamp !== null && b.newestTimestamp !== null && a.newestTimestamp !== b.newestTimestamp) {
            return b.newestTimestamp - a.newestTimestamp;
        }
        if (a.newestTimestamp !== null && b.newestTimestamp === null) return -1;
        if (a.newestTimestamp === null && b.newestTimestamp !== null) return 1;

        if (a.documentCount !== b.documentCount) {
            return b.documentCount - a.documentCount;
        }

        return a.originalIndex - b.originalIndex;
    });

    return scored.map((item) => item.cluster);
}

function evaluateDiscoveryHeuristics(summary, query) {
    const pagesScanned = summary.pagesScanned || 0;
    const hasNextPage = summary.hasNextPage || false;
    const capturedDistinctCaseCount = summary.capturedDistinctCaseCount || 0;
    
    const primaryClusterId = summary.recommendedPrimaryClusterId;
    const primaryClusterSummary = summary.clusters.find(c => c.clusterId === primaryClusterId) || null;
    const dominantClusterRatio = summary.dominantClusterRatio || 0;

    if (pagesScanned >= DISCOVERY_HEURISTICS_DEFAULTS.maxPagesScanned) {
        return { action: 'stop', reason: 'max-pages-reached', details: { pagesScanned } };
    }

    if (!primaryClusterSummary) {
        return hasNextPage 
            ? { action: 'paginate', reason: 'no-primary-cluster-found-yet', details: {} }
            : { action: 'stop', reason: 'no-more-pages-and-no-cluster', details: {} };
    }

    const primaryEntryCount = primaryClusterSummary.entryCount || 0;
    const primarySpanDays = primaryClusterSummary.entryDateSpanDays || 0;

    if (capturedDistinctCaseCount === 1) {
        if (primaryEntryCount >= DISCOVERY_HEURISTICS_DEFAULTS.targetPrimaryClusterEntries &&
            primarySpanDays >= DISCOVERY_HEURISTICS_DEFAULTS.sufficientPrimaryClusterSpanDays) {
            return { action: 'stop', reason: 'single-cluster-sufficient-coverage', details: { primaryEntryCount, primarySpanDays } };
        }
        if (hasNextPage) {
            return { action: 'paginate', reason: 'single-cluster-under-covered', details: { primaryEntryCount, primarySpanDays } };
        }
    }

    if (dominantClusterRatio >= DISCOVERY_HEURISTICS_DEFAULTS.dominantClusterRatioThreshold &&
        primarySpanDays >= DISCOVERY_HEURISTICS_DEFAULTS.strongPrimaryClusterSpanDays) {
        return { action: 'stop', reason: 'dominant-cluster-strong-coverage', details: { dominantClusterRatio, primarySpanDays } };
    }

    if ((primaryEntryCount < DISCOVERY_HEURISTICS_DEFAULTS.targetPrimaryClusterEntries ||
         primarySpanDays < DISCOVERY_HEURISTICS_DEFAULTS.sufficientPrimaryClusterSpanDays) &&
        !hasNextPage) {
        return { action: 'stop', reason: 'search-window-exhausted-before-target', details: { primaryEntryCount, primarySpanDays } };
    }

    if (hasNextPage) {
        return { action: 'paginate', reason: 'continue-search-window', details: { pagesScanned } };
    }

    return { action: 'stop', reason: 'exhausted-search-window', details: {} };
}

function buildDiscoverySummary(clusterSummaries, selectedClusters, query, discoveryMetadata = null) {
    const clusters = Array.isArray(clusterSummaries) ? clusterSummaries : [];
    const primaryCluster = selectedClusters[0];
    const primaryClusterId = primaryCluster
        ? (primaryCluster.clusterId || primaryCluster.caseNumber || 'anonymous-1')
        : null;
    const totalEntries = clusters.reduce((sum, cluster) => sum + cluster.entryCount, 0);
    const primaryClusterSummary = clusters.find(cluster => cluster.clusterId === primaryClusterId) || null;
    const normalizedDiscoveryMetadata = discoveryMetadata && typeof discoveryMetadata === 'object'
        ? discoveryMetadata
        : {};
    const acquisitionModes = Array.from(new Set([
        ...(Array.isArray(normalizedDiscoveryMetadata.acquisitionModes)
            ? normalizedDiscoveryMetadata.acquisitionModes
            : []),
        ...clusters.flatMap(cluster => cluster.acquisitionModes || [])
    ]));
    const queryLevelAcquisitionProvenance = Array.isArray(normalizedDiscoveryMetadata.searchWindows)
        ? normalizedDiscoveryMetadata.searchWindows
        : [];
    const annotatedClusters = clusters.map((cluster) => ({
        ...cluster,
        selectedForReasoning: cluster.clusterId === primaryClusterId
    }));

    const baseSummary = {
        query: query || null,
        discoveryMode: normalizedDiscoveryMetadata.discoveryMode || 'search-window',
        acquisitionModes,
        acquisitionProvenance: queryLevelAcquisitionProvenance,
        totalResults: normalizedDiscoveryMetadata.totalResults ?? null,
        totalPages: normalizedDiscoveryMetadata.totalPages ?? null,
        pagesScanned: normalizedDiscoveryMetadata.pagesScanned ?? null,
        currentPage: normalizedDiscoveryMetadata.currentPage ?? null,
        hasNextPage: normalizedDiscoveryMetadata.hasNextPage ?? null,
        rawEntryCount: normalizedDiscoveryMetadata.rawParsedEntryCount ?? totalEntries,
        capturedDistinctCaseCount: clusters.length,
        // Shared primary-case selection (T0-1): which key bounded acquisition
        // served, which candidate cases were considered (with entry/document
        // counts), and which rule ran. This is how a single-cluster
        // discoverySummary still knows the full multi-case discovery picture.
        selection: normalizedDiscoveryMetadata.selection ?? null,
        clusters: annotatedClusters,
        dominantClusterRatio: primaryClusterSummary
            ? Number((primaryClusterSummary.entryCount / Math.max(1, totalEntries)).toFixed(2))
            : 0,
        coverageConfidence: primaryClusterSummary ? 'partial' : 'low',
        reasoningScope: 'single-cluster',
        reasoningClusterId: primaryClusterId,
        recommendedPrimaryClusterId: primaryClusterId,
        secondaryClusterIds: clusters
            .map(cluster => cluster.clusterId)
            .filter(clusterId => clusterId !== primaryClusterId)
    };

    baseSummary.heuristics = evaluateDiscoveryHeuristics(baseSummary, query);

    return baseSummary;
}

function normalizeScraperResult(scrapeResult) {
    if (Array.isArray(scrapeResult)) {
        return {
            casesToProcess: scrapeResult,
            discoveryMetadata: null
        };
    }

    return {
        casesToProcess: Array.isArray(scrapeResult?.casesToProcess) ? scrapeResult.casesToProcess : [],
        discoveryMetadata: scrapeResult?.discoveryMetadata || null
    };
}

function normalizeEntryForGrouping(entry) {
    const normalizedCaseNumber = normalizeCaseNumber(entry?.caseInfo?.caseNumber || entry?.caseNumber) || 'N/A';

    return {
        ...entry,
        caseNumber: normalizedCaseNumber,
        caseInfo: entry?.caseInfo
            ? {
                ...entry.caseInfo,
                caseNumber: normalizedCaseNumber
            }
            : entry.caseInfo
    };
}

/**
 * Promotes an explicit case-number query or discovery-provided primary key;
 * otherwise the coverage-aware score order selects the primary cluster.
 */
function resolveReasoningPrimary(allClusters, scoredClusters, resolution = {}) {
    const { query = null, providedSelection = null } = resolution;
    const clusters = Array.isArray(scoredClusters) ? scoredClusters : [];
    const clusterIdOf = (cluster) => cluster?.clusterId || cluster?.caseNumber || null;
    const known = (key) => (Array.isArray(allClusters) ? allClusters : []).some((cluster) => clusterIdOf(cluster) === key);

    const promote = (key, method) => {
        const atIndex = clusters.findIndex((cluster) => clusterIdOf(cluster) === key);
        if (atIndex > 0) {
            const [picked] = clusters.splice(atIndex, 1);
            clusters.unshift(picked);
        }
        return { clusters, primarySelection: { selectedCaseKey: key, method, source: 'shared-selector' } };
    };

    const queriedKey = query?.type === 'case_number' ? normalizeCaseNumber(query?.value) : null;
    if (queriedKey && known(queriedKey)) {
        return promote(queriedKey, 'case-number-query');
    }

    const providedKey = providedSelection?.selectedCaseKey || null;
    if (providedKey && known(providedKey)) {
        return promote(providedKey, providedSelection.method || 'discovery-selection');
    }

    const [head] = clusters;
    return {
        clusters,
        primarySelection: {
            selectedCaseKey: head ? clusterIdOf(head) : null,
            method: 'coverage-scoring',
            source: 'scoring-fallback'
        }
    };
}

function buildDiscoveryResult(casesToProcess, options = {}, progressCallback) {
    const emitProgress = progressCallback;

    if (!casesToProcess || casesToProcess.length === 0) {
        throw new Error('Nije pronađen nijedan predmet za traženi pojam.');
    }

    emitProgress?.({ step: 'grouping', progress: 15, message: 'Grupiram pronađene objave po predmetima...' });

    const entriesForGrouping = casesToProcess.map(normalizeEntryForGrouping);
    // Selection is deterministic across the complete discovered set. The
    // reasoning resolver honors an explicit case-number query or discovery key.
    const localSelection = selectPrimaryCase(entriesForGrouping, options.query || null);
    const providedSelection = options.discoveryMetadata?.selection || null;
    const discoveryProvidedKey = providedSelection?.selectedCaseKey || null;
    if (discoveryProvidedKey
        && localSelection.selectedCaseKey
        && discoveryProvidedKey !== localSelection.selectedCaseKey) {
        logger.warn('pipeline.buildDiscoveryResult', 'Discovery-provided primary key disagrees with local selection; discovery key still drives reasoning.', {
            runId: options?.runId || null,
            discoveryProvidedKey,
            localKey: localSelection.selectedCaseKey,
            method: localSelection.method
        });
    }
    const resolution = { query: options.query || null, providedSelection };
    const allClusters = groupEntriesByCase(entriesForGrouping);
    const clusterSummaries = buildClusterSummaries(allClusters, options.query);
    const { clusters, primarySelection } = resolveReasoningPrimary(
        allClusters,
        selectClustersForProcessing(allClusters, clusterSummaries),
        resolution
    );
    // TS-2 — stratified analysis scope: when discovery served a candidate
    // pool with an explicit analysis budget (balanced CSV path), the primary
    // cluster's entries are allocated AFTER grouping. Discovery-level counts
    // (summaries, spans) keep describing the pool; only the reasoning input
    // is bounded. Paths without a budget (puppeteer, mocks, legacy metadata)
    // pass through untouched.
    const analysisBudget = options.discoveryMetadata?.selection?.analysisBudget;
    let coverageLedger = null;
    if (Number.isFinite(analysisBudget)) {
        const primaryIndex = clusters.findIndex(
            (cluster) => (cluster?.clusterId || cluster?.caseNumber) === primarySelection.selectedCaseKey
        );
        if (primaryIndex >= 0) {
            const stratified = stratifyClusterEntries(clusters[primaryIndex].entries, { budget: analysisBudget });
            clusters[primaryIndex] = { ...clusters[primaryIndex], entries: stratified.entries };
            coverageLedger = stratified.ledger;
        }
    }
    const discoverySummary = buildDiscoverySummary(
        clusterSummaries,
        clusters,
        options.query,
        options.discoveryMetadata
    );
    discoverySummary.primarySelection = {
        ...primarySelection,
        discoveryProvidedKey
    };
    discoverySummary.coverageLedger = coverageLedger;

    const primaryClusterId = discoverySummary.recommendedPrimaryClusterId;


    logger.info('pipeline.buildDiscoveryResult', 'Discovery completed', {
        runId: options?.runId || null,
        clusters,
        allClusters: allClusters.length,
        primaryClusterId: primaryClusterId || null,
        queryType: options.query?.type || null,
    });

    emitProgress?.({
        step: 'grouping',
        progress: 20,
        message: `Pronađeno ${clusters.length} jedinstvenih predmeta (odabrano od ${allClusters.length} grupa iz ${casesToProcess.length} objava) za analizu.`
    });

    const primaryClusterSummary = discoverySummary.clusters.find((cluster) => cluster.clusterId === primaryClusterId) || null;
    if (primaryClusterSummary) {
        const IDENTITY_LABELS_HR = {
            consistent: 'konzistentan',
            unresolved: 'nepotvrđen',
            ambiguous: 'dvosmislen',
        };
        emitProgress?.({
            step: 'grouping',
            progress: 22,
            message: `Glavni predmet: ${primaryClusterSummary.primaryCaseNumber} — ${primaryClusterSummary.entryCount} objava, raspon ${primaryClusterSummary.entryDateSpanDays} dana, identitet: ${IDENTITY_LABELS_HR[primaryClusterSummary.identityConsistency] || primaryClusterSummary.identityConsistency}.`
        });
    }

    return {
        allClusters,
        clusters,
        discoverySummary,
        primaryClusterId,
        primaryCluster: discoverySummary.clusters.find((cluster) => cluster.clusterId === primaryClusterId) || null,
        secondaryClusters: discoverySummary.clusters.filter((cluster) => cluster.clusterId !== primaryClusterId)
    };
}

function resolveAnalysisArgs(optionsOrProgressCallback, maybeProgressCallback) {
    const options = optionsOrProgressCallback && typeof optionsOrProgressCallback === 'object'
        ? optionsOrProgressCallback
        : {};
    const depth = resolveScanDepth(options.scanDepth);
    return {
        scrapeLimit: computeRawScrapeLimit(depth.maxEntries),
        query: options.query || null,
        discoverySource: options.discoverySource || null,
        runId: options.runId || null,
        ...depth,
        progressCallback: typeof optionsOrProgressCallback === 'function'
            ? optionsOrProgressCallback
            : maybeProgressCallback,
    };
}

/**
 * Scrapes a search term and analyzes its selected primary cluster.
 * @param {string} searchTerm
 * @param {object|function} optionsOrProgressCallback
 * @param {function} progressCallback
 */
async function runCourtAnalysis(searchTerm, optionsOrProgressCallback, progressCallback) {
    const resolved = resolveAnalysisArgs(optionsOrProgressCallback, progressCallback);
    const callback = resolved.progressCallback;
    const automator = createDiscoveryClient({ discoverySource: resolved.discoverySource });

    try {
        // 1. Scrape for the N latest cases
        logger.info('pipeline.runCourtAnalysis', 'Starting court analysis', {
            runId: resolved.runId || null,
            queryType: resolved.query?.type || null,
            scrapeLimit: resolved.scrapeLimit,
        });
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCasesWithDocuments(
            searchTerm,
            resolved.scrapeLimit,
            resolved.maxPagesScanned,
            resolved.tailSample,
            resolved.query?.type === 'oib' ? resolved.query.value : null,
            resolved.query || null
        );
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        callback?.({
            step: 'discovering',
            progress: 12,
            message: `Pronađeno ${casesToProcess.length} objava na ${discoveryMetadata?.pagesScanned ?? '?'} stranica${discoveryMetadata?.hasNextPage ? ' (postoji više stranica)' : ''}.`
        });

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }
        logger.info('pipeline.runCourtAnalysis', 'Scrape completed', {
            runId: resolved.runId || null,
            cases: casesToProcess.length,
            discoveryMode: discoveryMetadata?.discoveryMode || null,
        });

        return await processScrapedCases(casesToProcess, callback, {
            query: resolved.query || { value: searchTerm },
            discoveryMetadata,
            runId: resolved.runId || null,
        });


    } catch (error) {
        logger.error('pipeline.runCourtAnalysis', 'Court analysis failed', { runId: resolved.runId || null, error: error.message });
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        // Always close automator here - simpler logic
        await automator.close();
    }
}

async function runCourtDiscovery(searchTerm, optionsOrProgressCallback, progressCallback) {
    const resolved = resolveAnalysisArgs(optionsOrProgressCallback, progressCallback);
    const callback = resolved.progressCallback;
    const automator = createDiscoveryClient({ discoverySource: resolved.discoverySource });

    try {
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCases(
            searchTerm,
            null,
            resolved.maxPagesScanned,
            resolved.tailSample,
            resolved.query?.type === 'oib' ? resolved.query.value : null
        );
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        return buildDiscoveryResult(casesToProcess, {
            query: resolved.query || { value: searchTerm },
            discoveryMetadata,
        }, callback);
    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        await automator.close();
    }
}

/**
 * The CORE processing function. It takes pre-scraped cases and performs
 * the download, unzip, analysis, and comparison steps.
 * @param {Array<object>} casesToProcess - The array of case objects from the scraper.
 * @param {function} progressCallback - The callback for sending progress updates.
 * @returns {Promise<object>} The final result with processed cases and comparative analysis.
 */
async function processScrapedCases(casesToProcess, progressCallback, options = {}) {
    const resolvedOptions = {
        ...options,
    };
    // Run correlation: server.js mints a run id per analysis request and
    // threads it here via options (same plumbing shape as usageTracker).
    // Every logger.* call in this function carries it in meta so concurrent
    // runs can be isolated with a single grep. Null outside HTTP requests.
    const runId = resolvedOptions.runId || null;
    const runStartedAt = Date.now();
    const allProcessedCases = [];
    let allFilesToCleanup = [];
    let lastStage = null;

    const usageTracker = createUsageTracker();
    const stageAwareProgress = (event) => {
        if (event?.step) lastStage = event.step;
        progressCallback?.(event);
    };
    const emitUsage = (snapshot) => {
        stageAwareProgress({
            step: lastStage || 'reasoning',
            usage: snapshot,
        });
    };

    let partialResult = buildEmptyPartialResult();

    try {
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // --- GROUPING + DISCOVERY SUMMARY ---
        // Selection policy (B-08):
        // 1) rank clusters by deterministic weighted coverage score
        // 2) use newest entry date, then document count, then discovery order as tie-breakers
        // 3) apply explicit identity-confidence penalties for entity-oriented queries
        const {
            clusters,
            discoverySummary,
            primaryClusterId,
            primaryCluster,
            secondaryClusters
        } = buildDiscoveryResult(casesToProcess, resolvedOptions, stageAwareProgress);
        partialResult = {
            ...partialResult,
            discoverySummary,
            primaryCluster,
            secondaryClusters
        };
        stageAwareProgress(buildStageCounterEvent({
            stage: 'discovering',
            done: 0,
            total: discoverySummary.rawEntryCount ?? null,
            unit: 'objava',
        }));
        const selectedReasoningCluster = primaryClusterId
            ? clusters.find((cluster) => (cluster.clusterId || cluster.caseNumber) === primaryClusterId) || null
            : clusters[0] || null;
        const selectedClusterSummary = selectedReasoningCluster
            ? discoverySummary.clusters.find((summary) => summary.clusterId === (
                selectedReasoningCluster.clusterId || selectedReasoningCluster.caseNumber
            ))
            : null;
        const clusterEvidencePackage = buildClusterEvidencePackage({
            cluster: selectedReasoningCluster,
            clusterSummary: selectedClusterSummary,
            discoverySummary,
            query: resolvedOptions.query || null
        });
        partialResult.clusterEvidencePackage = clusterEvidencePackage;

        logger.info('pipeline.processScrapedCases', 'Discovery grouped', {
            runId,
            clusters: clusters.length,
            reasoningClusters: selectedReasoningCluster ? 1 : 0,
            primaryClusterId: primaryClusterId || null,
            secondaryClusters: secondaryClusters.length,
            queryType: resolvedOptions.query?.type || null,
        });



        if (selectedReasoningCluster) {
            const cluster = selectedReasoningCluster;
            const clusterId = cluster.clusterId || cluster.caseNumber || 'anonymous-1';
            const clusterSummary = discoverySummary.clusters.find((summary) => summary.clusterId === clusterId);
            
            // Use the first entry as the primary metadata source (most recent usually)
            const primaryEntry = cluster.entries[0];
            const { caseInfo } = primaryEntry;
            
            // Merge document links from all entries in the cluster
            const documentLinks = cluster.entries.flatMap(e => e.documentLinks || []);

            let downloadedFiles = [];
            let extractedFilePaths = [];

            stageAwareProgress?.({ step: 'downloading', progress: 25, message: `Obrađujem predmet ${caseInfo.caseNumber} (${cluster.entries.length} objava)` });

            // --- ENRICHMENT STEP ---
            if (caseInfo.participants && caseInfo.participants.length > 0) {
                stageAwareProgress?.({ step: 'discovering', message: `Dohvaćam podatke iz Sudskog registra za sudionike...` });
                try {
                    caseInfo.participants = await enrichParticipants(caseInfo.participants);
                } catch (err) {
                    agentLog.error('Enrichment failed gracefully:', err.message);
                }
            }
            // -----------------------

            // 2a. Download
            stageAwareProgress?.({ step: 'downloading', message: `Preuzimam arhivu za predmet ${caseInfo.caseNumber} (${documentLinks.length} linkova)...` });
            let downloadFailed = 0;
            downloadedFiles = await downloadClusterAttachments({
                documentLinks,
                progressCallback: (event) => {
                    stageAwareProgress?.(event);
                    if (event && Number.isFinite(event.completed) && Number.isFinite(event.total)) {
                        if (event.failed === true) downloadFailed++;
                        stageAwareProgress?.(buildStageCounterEvent({
                            stage: 'downloading',
                            done: event.completed,
                            failed: downloadFailed,
                            total: event.total,
                            unit: 'datoteka',
                        }));
                    }
                },
            });
            stageAwareProgress?.({ step: 'downloading', message: `Preuzeto ${downloadedFiles.length}/${documentLinks.length} datoteka za predmet ${caseInfo.caseNumber}.` });

            // 2b. Unzip
            stageAwareProgress?.({ step: 'extracting', message: `Raspakiram datoteke za predmet ${caseInfo.caseNumber}...` });
            const filesForAnalysis = [];
            // Explicit file→entry provenance: the raw cluster entries are the
            // authority here (pre-evidencePackage, so no mapped link ids yet).
            // Tag each file with its source entry index so the attach step can
            // resolve entry dates by index instead of fuzzy filename matching.
            const entryIndexByUrl = new Map();
            const linkIdByUrl = new Map();
            (cluster.entries || []).forEach((rawEntry, rawEntryIndex) => {
                // Same deterministic id format evidencePackage.js's mapDocumentLink
                // will later synthesize for this exact entry/link position, so a
                // file tagged here resolves against the real pkg.documentLinks
                // entry instead of relying on sourceEntryIndex alone. Raw scraped
                // links never carry their own `.id` (that field is a downstream
                // reasoning-layer construct), so it must be computed here, not read.
                const rawCaseNumber = rawEntry?.caseNumber || rawEntry?.caseInfo?.caseNumber || 'unknown';
                (rawEntry?.documentLinks || []).forEach((rawLink, rawLinkIndex) => {
                    if (rawLink?.url && !entryIndexByUrl.has(rawLink.url)) {
                        entryIndexByUrl.set(rawLink.url, rawEntryIndex);
                    }
                    const rawLinkId = rawLink?.id
                        ?? rawLink?.documentLinkId
                        ?? `${rawCaseNumber}::entry-${rawEntryIndex + 1}::doc-${rawLinkIndex + 1}`;
                    if (rawLink?.url && !linkIdByUrl.has(rawLink.url)) {
                        linkIdByUrl.set(rawLink.url, rawLinkId);
                    }
                });
            });
            const tagProvenance = (file) => ({
                sourceEntryIndex: file?.sourceEntryIndex
                    ?? file?.entryIndex
                    ?? (entryIndexByUrl.has(file?.url) ? entryIndexByUrl.get(file.url) : null),
                sourceDocumentLinkId: file?.sourceDocumentLinkId
                    ?? file?.documentLinkId
                    ?? (linkIdByUrl.has(file?.url) ? linkIdByUrl.get(file.url) : null),
            });
            let extractedCount = 0;
            const emitExtractCounter = () => stageAwareProgress?.(buildStageCounterEvent({
                stage: 'extracting',
                done: extractedCount,
                total: null,
                unit: 'datoteka',
            }));
            for (const file of downloadedFiles) {
                extractedFilePaths.push(file.filePath);
                if (path.extname(file.filePath).toLowerCase() === '.zip') {
                    const extractionDir = path.dirname(file.filePath);
                    const extractionResult = await extractArchiveFiles({ filePath: file.filePath, destination: extractionDir });
                    for (const extracted of (extractionResult.extractedFiles || [])) {
                        // Zip-extracted files get a new working-copy path and an
                        // in-archive display name, but keep the parent zip's
                        // provenance (same originating court entry).
                        filesForAnalysis.push({ filePath: extracted.filePath, text: extracted.entryName, url: file.url, ...tagProvenance(file) });
                        extractedFilePaths.push(extracted.filePath);
                        extractedCount++;
                        emitExtractCounter();
                    }
                } else {
                    filesForAnalysis.push({ ...file, ...tagProvenance(file) });
                    extractedCount++;
                    emitExtractCounter();
                }
            }
            
            allFilesToCleanup.push(...extractedFilePaths);

            const fileTypeCounts = filesForAnalysis.reduce((counts, file) => {
                const ext = (path.extname(file.filePath || '').toLowerCase().replace('.', '')) || 'ostalo';
                counts[ext] = (counts[ext] || 0) + 1;
                return counts;
            }, {});
            const typeBreakdown = Object.entries(fileTypeCounts)
                .map(([ext, count]) => `${ext.toUpperCase()}: ${count}`)
                .join(', ');
            stageAwareProgress?.({
                step: 'extracting',
                message: `Za analizu pripremljeno ${filesForAnalysis.length} datoteka${typeBreakdown ? ` (${typeBreakdown})` : ''}.`
            });
            stageAwareProgress?.(buildStageCounterEvent({
                stage: 'extracting',
                done: filesForAnalysis.length,
                total: filesForAnalysis.length,
                unit: 'datoteka',
            }));

            if (filesForAnalysis.length === 0) {
                 agentLog.warn(`No files to analyze for case ${caseInfo.title}. Skipping analysis.`);
                 allProcessedCases.push({
                    caseResult: caseInfo,
                    analysis: { individualAnalyses: [], finalSummary: "Nema dokumenata za analizu." },
                    groupMetadata: {
                        clusterId,
                        primaryCaseNumber: clusterSummary?.primaryCaseNumber || cluster.caseNumber || 'N/A',
                        entryCount: cluster.entries.length,
                        isAnonymous: cluster.isAnonymous,
                        selectionScore: clusterSummary?.score ?? 0,
                        selectionDiagnostics: clusterSummary?.selectionDiagnostics || null,
                        identityConsistency: clusterSummary?.identityConsistency || 'unresolved',
                        identityNotes: clusterSummary?.identityNotes || [],
                        participantNames: clusterSummary?.participantNames || [],
                        participantOibs: clusterSummary?.participantOibs || [],
                        acquisitionModes: clusterSummary?.acquisitionModes || [],
                        acquisitionProvenance: clusterSummary?.acquisitionProvenance || [],
                        entryCountsByAcquisitionMode: clusterSummary?.entryCountsByAcquisitionMode || {},
                        documentCountsByAcquisitionMode: clusterSummary?.documentCountsByAcquisitionMode || {},
                        selectedForReasoning: clusterId === primaryClusterId
                    }
                 });
            } else {

            // 2c. Analyze THIS case's documents
            stageAwareProgress?.({ step: 'reasoning', message: `Analiziram ${filesForAnalysis.length} datoteka za predmet ${caseInfo.caseNumber}...` });
            const analysis = await analyzeClusterDocuments({ files: filesForAnalysis, caseInfo: caseInfo, progressCallback: stageAwareProgress, usageTracker, onUsage: emitUsage, runId });
            const analysisCoverage = analysis?.coverage || {};
            stageAwareProgress?.({
                step: 'reasoning',
                message: `AI analiza predmeta ${caseInfo.caseNumber} dovršena: ${analysisCoverage.analyzed ?? 0} uspješno, ${analysisCoverage.failed ?? 0} neuspjelo od ${analysisCoverage.total ?? filesForAnalysis.length} datoteka.`
            });
            logger.info('pipeline.processScrapedCases', 'Case analyzed', {
                runId,
                filesAnalyzed: filesForAnalysis.length,
                individualAnalyses: Array.isArray(analysis?.individualAnalyses) ? analysis.individualAnalyses.length : 0,
            });

            // Store the fully processed case data
            allProcessedCases.push({
                caseResult: caseInfo,
                files: downloadedFiles, 
                analysis: analysis,
                // Add metadata about the grouping for debugging/UI
                groupMetadata: {
                    clusterId,
                    primaryCaseNumber: clusterSummary?.primaryCaseNumber || cluster.caseNumber || 'N/A',
                    entryCount: cluster.entries.length,
                    isAnonymous: cluster.isAnonymous,
                    selectionScore: clusterSummary?.score ?? 0,
                    selectionDiagnostics: clusterSummary?.selectionDiagnostics || null,
                    identityConsistency: clusterSummary?.identityConsistency || 'unresolved',
                    identityNotes: clusterSummary?.identityNotes || [],
                    participantNames: clusterSummary?.participantNames || [],
                    participantOibs: clusterSummary?.participantOibs || [],
                    acquisitionModes: clusterSummary?.acquisitionModes || [],
                    acquisitionProvenance: clusterSummary?.acquisitionProvenance || [],
                    entryCountsByAcquisitionMode: clusterSummary?.entryCountsByAcquisitionMode || {},
                    documentCountsByAcquisitionMode: clusterSummary?.documentCountsByAcquisitionMode || {},
                    selectedForReasoning: clusterId === primaryClusterId
                }
            });
            }
        }

        // 3. Final Comparative Analysis
        partialResult.processedCases = allProcessedCases;

        // Enrich the evidence package with successful per-document analyses now
        // that they exist, so the report/retriever ground findings in real
        // document content and expose coverage (analyzed vs failed).
        const enrichedEvidencePackage = attachAnalysesToEvidencePackage(
            clusterEvidencePackage,
            allProcessedCases,
            primaryClusterId || null
        );
        partialResult.clusterEvidencePackage = enrichedEvidencePackage;

        stageAwareProgress?.({ step: 'reasoning', progress: 85, message: 'Generiram stručni izvještaj i zaključak...' });
        // Report generation gets its OWN try/catch, deliberately separate from the
        // outer one: a failure here (JSON truncation on a dense cluster, a schema
        // validation miss, a transient model error) must not discard the already-
        // succeeded, real-money per-document analyses in allProcessedCases. Every
        // other pipeline stage either can't fail this way or already degrades
        // gracefully (rerank/planner fall back to templates); this was the one
        // hard stop, and it sat downstream of the most expensive work in the run.
        let report = null;
        let reportError = null;
        try {
            report = await generateClusterReport(enrichedEvidencePackage, {
                onStage: (event) => stageAwareProgress?.(event),
                tracker: usageTracker,
                onUsage: emitUsage,
                runId
            });
        } catch (err) {
            reportError = err.message;
            agentLog.error('Report generation failed; returning partial per-document results without a synthesized report:', err.message);
            logger.error('pipeline.processScrapedCases', 'Report generation failed', { runId, error: reportError });
        }
        partialResult.report = report;
        partialResult.reportError = reportError;

        // One LLM narrative per run: the human-facing overview is composed
        // deterministically from the synthesized report instead of asking the
        // model for a second, overlapping summary. Falls back to a plain
        // per-document summary list when synthesis failed above.
        let comparativeAnalysis = report
            ? composeOverviewMarkdown(report)
            : composeFallbackOverviewMarkdown(allProcessedCases);
        partialResult.comparativeAnalysis = comparativeAnalysis;
        logger.info('pipeline.processScrapedCases', 'Reasoning report generated', {
            runId,
            processedCases: allProcessedCases.length,
            reportFindings: Array.isArray(report?.findings) ? report.findings.length : 0,
            verificationStatus: report?.verification?.status || null,
            reportError,
        });

        // VISUALIZATION REMOVED.
        //
        // This used to call `VisualizerTool` to have Gemini restate the
        // already-structured moneyFlow / propertyFlow entries as a Mermaid
        // flowchart, appending the raw diagram to `comparativeAnalysis`.
        //
        // Removed because it never worked and could not be made to work
        // reliably: across 13 real runs exactly one produced a diagram, and that
        // one was an empty placeholder ("Nema dostupnih podataka za
        // vizualizaciju."). The one substantive diagram in the repo - frozen
        // into the baseline fixture - fails to parse, on a stray backtick inside
        // a node label. The backend performed no parse validation at all and the
        // frontend only logged to console.error, so no failure was ever
        // observable or countable after the fact.
        //
        // Nothing is lost. The chronology it inferred from prose now renders
        // from `report.timeline`, which the page already received and never
        // displayed in full. The money and property flows it re-encoded already
        // render from their structured entries. Its speculative future branches
        // ("Ishod 1 (vjerojatnije)") were never data and remain available as
        // `report.openQuestions`.
        // -------------------------

        stageAwareProgress?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });
        logger.info('pipeline.processScrapedCases', 'Analysis complete', {
            runId,
            processedCases: allProcessedCases.length,
            hasReport: Boolean(report),
            reportError,
        });

        // Structured end-of-run summary: ONE greppable line per run carrying
        // only counts/totals that genuinely exist at this point (never full
        // arrays). Extension point: any future run-level aggregate gets one
        // more bounded field here — this is the single place to add it.
        const summaryCoverage = sumDocumentCoverage(allProcessedCases);
        logger.info('pipeline.processScrapedCases', 'Run summary', {
            runId,
            status: 'complete',
            query: {
                type: resolvedOptions.query?.type || null,
                value: resolvedOptions.query?.value || null,
            },
            discoveryMode: discoverySummary?.discoveryMode || null,
            scanDepth: resolvedOptions.scanDepth || null,
            processedCases: allProcessedCases.length,
            documentsAnalyzed: summaryCoverage.analyzed,
            documentsFailed: summaryCoverage.failed,
            groundedClaims: enrichedEvidencePackage?.coverage?.groundedClaims ?? null,
            totalClaims: enrichedEvidencePackage?.coverage?.totalClaims ?? null,
            propertyFlowEntries: enrichedEvidencePackage?.propertyFlow?.count ?? 0,
            propertyConflicts: enrichedEvidencePackage?.propertyReconciliation?.conflicts?.length ?? 0,
            usage: usageTracker.snapshot(),
            durationMs: Date.now() - runStartedAt,
            reportError,
        });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis,
            discoverySummary,
            primaryCluster,
            secondaryClusters,
            clusterEvidencePackage: enrichedEvidencePackage,
            report,
            reportError,
            usage: usageTracker.snapshot()
        };

    } catch (error) {
        // Re-throw wrapped with whatever partial results were accumulated before the
        // failing stage, so the API layer can persist discovery data + a transparent
        // error instead of discarding everything.
        partialResult.usage = usageTracker.snapshot();
        // Failure-side twin of the success summary above: same bounded shape,
        // partial counts where the run got that far, nulls where it didn't.
        const failureCoverage = sumDocumentCoverage(allProcessedCases);
        logger.error('pipeline.processScrapedCases', 'Run summary', {
            runId,
            status: 'failed',
            query: {
                type: resolvedOptions.query?.type || null,
                value: resolvedOptions.query?.value || null,
            },
            discoveryMode: partialResult.discoverySummary?.discoveryMode || null,
            scanDepth: resolvedOptions.scanDepth || null,
            processedCases: allProcessedCases.length,
            documentsAnalyzed: failureCoverage.analyzed,
            documentsFailed: failureCoverage.failed,
            groundedClaims: partialResult.clusterEvidencePackage?.coverage?.groundedClaims ?? null,
            totalClaims: partialResult.clusterEvidencePackage?.coverage?.totalClaims ?? null,
            propertyFlowEntries: partialResult.clusterEvidencePackage?.propertyFlow?.count ?? 0,
            propertyConflicts: partialResult.clusterEvidencePackage?.propertyReconciliation?.conflicts?.length ?? 0,
            usage: usageTracker.snapshot(),
            durationMs: Date.now() - runStartedAt,
            error: error.message,
        });
        throw new PartialAnalysisError(error.message, partialResult, { stage: lastStage });
    } finally {
        // The cleanup function needs to be available in the scope of this file.
        await cleanupFiles(allFilesToCleanup);
    }
}

async function cleanupFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    for (const filePath of filePaths) {
        try {
            if (fs.existsSync(filePath)) {
                await fs.promises.unlink(filePath);
            }
        } catch (err) {
            agentLog.warn(`Failed to delete temporary file ${filePath}: ${err.message}`);
        }
    }
}

module.exports = {
    runCourtAnalysis,
    runCourtDiscovery,
    resolveScanDepth,
    computeRawScrapeLimit,
    processScrapedCases,
    buildDiscoveryResult,
    PartialAnalysisError,
    buildEmptyPartialResult,
    evaluateDiscoveryHeuristics,
};
