'use strict';

const { groupEntriesByCase } = require('./utils/grouping');
const { parseCaseDateToTimestamp } = require('./utils/caseDate');
const { selectPrimaryCase } = require('./utils/primaryCaseSelector');
const { stratifyClusterEntries } = require('./utils/stratify');
const { normalizeCaseNumber } = require('./utils/caseNumber');
const {
    resolveScanDepthEntries,
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_BALANCED_FORWARD_ENTRIES,
} = require('./utils/scanDepth');
const logger = require('../services/logger');

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
    dominantClusterRatioThreshold: 0.65,
};

function resolveAnalysisScrapeLimit() {
    const raw = Number.parseInt(process.env.ANALYSIS_SCRAPE_LIMIT, 10);
    if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
    return null;
}

function computeRawScrapeLimit(poolCap) {
    const envLimit = resolveAnalysisScrapeLimit();
    if (envLimit !== null) return Math.min(envLimit, poolCap);
    return poolCap;
}

function resolveScanDepth(scanDepth) {
    const policy = resolveScanDepthEntries(scanDepth);
    return {
        ...policy,
        maxPagesScanned: policy.scanDepth === 'full'
            ? Infinity
            : Math.ceil(SCAN_DEPTH_BALANCED_FORWARD_ENTRIES / COURT_ENTRIES_PER_PAGE),
        tailSample: policy.scanDepth === 'balanced',
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
            if (participant?.name) participantNames.add(participant.name.trim());
            const oib = typeof participant?.oib === 'string' ? participant.oib.trim() : '';
            if (oib && oib !== 'N/A') oibs.add(oib);
        }
    }

    return {
        participantNames: Array.from(participantNames),
        oibs: Array.from(oibs),
        debtorOibs: Array.from(debtorOibs),
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
            reason: acquisition.reason ?? null,
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
                reason: acquisition.reason ?? null,
            });
        }
    }

    return { acquisitionModes: Array.from(acquisitionModes), acquisitionProvenance };
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

    return { entryCountsByAcquisitionMode, documentCountsByAcquisitionMode };
}

function determineIdentityConsistency(cluster, query) {
    const { participantNames, oibs, debtorOibs } = collectClusterParticipantSignals(cluster);
    const identityOibs = debtorOibs.length > 0 ? debtorOibs : oibs;

    if (query?.type === 'oib' && query?.value) {
        if (identityOibs.length === 1 && identityOibs[0] === query.value) {
            return { identityConsistency: 'consistent', identityNotes: [] };
        }
        if (identityOibs.length === 0) {
            return {
                identityConsistency: 'unresolved',
                identityNotes: [`Queried OIB ${query.value} is not visible in captured entity metadata.`],
            };
        }
        return {
            identityConsistency: 'ambiguous',
            identityNotes: [`Captured entity OIBs (${identityOibs.join(', ')}) do not cleanly match queried OIB ${query.value}.`],
        };
    }

    if (identityOibs.length > 1) {
        return {
            identityConsistency: 'ambiguous',
            identityNotes: [`Multiple entity OIBs detected in cluster: ${identityOibs.join(', ')}.`],
        };
    }
    if (identityOibs.length === 1) {
        return {
            identityConsistency: 'consistent',
            identityNotes: query?.type === 'text'
                ? ['Text query matched a single visible OIB in captured entries; same-name matches alone are not treated as proof beyond this cluster.']
                : [],
        };
    }
    return {
        identityConsistency: 'unresolved',
        identityNotes: participantNames.length > 0
            ? ['Identity remains name-based only because participant OIB data is missing in captured entries.']
            : ['Identity could not be validated because participant metadata is missing in captured entries.'],
    };
}

function summarizeCluster(cluster, index, query) {
    const entries = Array.isArray(cluster.entries) ? cluster.entries : [];
    const timestamps = entries
        .map((entry) => parseCaseDateToTimestamp(entry?.caseInfo?.date || entry?.caseInfo?.datePublished))
        .filter((ts) => ts !== null)
        .sort((a, b) => a - b);

    const oldestTimestamp = timestamps.length > 0 ? timestamps[0] : null;
    const newestTimestamp = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
    const documentCount = entries.reduce((sum, entry) => (
        sum + (Array.isArray(entry?.documentLinks) ? entry.documentLinks.length : 0)
    ), 0);
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
        documentCountsByAcquisitionMode,
    };
}

function scoreRecency(newestTimestamp, oldestNewestTimestamp, latestNewestTimestamp) {
    if (newestTimestamp === null || oldestNewestTimestamp === null || latestNewestTimestamp === null) return 0;
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
        .map((cluster) => (cluster.newestEntryDate ? Date.parse(cluster.newestEntryDate) : null))
        .filter((ts) => ts !== null && !Number.isNaN(ts));
    const oldestNewestTimestamp = newestTimestamps.length > 0 ? Math.min(...newestTimestamps) : null;
    const latestNewestTimestamp = newestTimestamps.length > 0 ? Math.max(...newestTimestamps) : null;

    return baseSummaries.map((summary) => {
        const newestTimestamp = summary.newestEntryDate ? Date.parse(summary.newestEntryDate) : null;
        const entryCoverageScore = Math.min(summary.entryCount / CLUSTER_SELECTION_DEFAULTS.targetPrimaryClusterEntries, 1);
        const spanCoverageScore = Math.min(summary.entryDateSpanDays / CLUSTER_SELECTION_DEFAULTS.strongPrimaryClusterSpanDays, 1);
        const recencyScore = scoreRecency(newestTimestamp, oldestNewestTimestamp, latestNewestTimestamp);
        const dominanceScore = totalEntries > 0 ? summary.entryCount / totalEntries : 0;
        const documentCoverageScore = Math.min(summary.documentCount / CLUSTER_SELECTION_DEFAULTS.targetPrimaryClusterEntries, 1);
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
                documentCoverageScore: Number(documentCoverageScore.toFixed(4)),
            },
        };
    });
}

function selectClustersForProcessing(allClusters, clusterSummaries) {
    if (!Array.isArray(allClusters) || allClusters.length === 0) {
        return [];
    }

    const scoreByClusterId = new Map(
        (clusterSummaries || []).map((summary) => [summary.clusterId, summary]),
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
        if (a.score !== b.score) return b.score - a.score;
        if (a.newestTimestamp !== null && b.newestTimestamp !== null && a.newestTimestamp !== b.newestTimestamp) {
            return b.newestTimestamp - a.newestTimestamp;
        }
        if (a.newestTimestamp !== null && b.newestTimestamp === null) return -1;
        if (a.newestTimestamp === null && b.newestTimestamp !== null) return 1;
        if (a.documentCount !== b.documentCount) return b.documentCount - a.documentCount;
        return a.originalIndex - b.originalIndex;
    });

    return scored.map((item) => item.cluster);
}

function evaluateDiscoveryHeuristics(summary) {
    const pagesScanned = summary.pagesScanned || 0;
    const hasNextPage = summary.hasNextPage || false;
    const capturedDistinctCaseCount = summary.capturedDistinctCaseCount || 0;
    const primaryClusterId = summary.recommendedPrimaryClusterId;
    const primaryClusterSummary = summary.clusters.find((c) => c.clusterId === primaryClusterId) || null;
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
        if (primaryEntryCount >= DISCOVERY_HEURISTICS_DEFAULTS.targetPrimaryClusterEntries
            && primarySpanDays >= DISCOVERY_HEURISTICS_DEFAULTS.sufficientPrimaryClusterSpanDays) {
            return { action: 'stop', reason: 'single-cluster-sufficient-coverage', details: { primaryEntryCount, primarySpanDays } };
        }
        if (hasNextPage) {
            return { action: 'paginate', reason: 'single-cluster-under-covered', details: { primaryEntryCount, primarySpanDays } };
        }
    }

    if (dominantClusterRatio >= DISCOVERY_HEURISTICS_DEFAULTS.dominantClusterRatioThreshold
        && primarySpanDays >= DISCOVERY_HEURISTICS_DEFAULTS.strongPrimaryClusterSpanDays) {
        return { action: 'stop', reason: 'dominant-cluster-strong-coverage', details: { dominantClusterRatio, primarySpanDays } };
    }
    if ((primaryEntryCount < DISCOVERY_HEURISTICS_DEFAULTS.targetPrimaryClusterEntries
        || primarySpanDays < DISCOVERY_HEURISTICS_DEFAULTS.sufficientPrimaryClusterSpanDays)
        && !hasNextPage) {
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
    const primaryClusterId = primaryCluster ? (primaryCluster.clusterId || primaryCluster.caseNumber || 'anonymous-1') : null;
    const totalEntries = clusters.reduce((sum, cluster) => sum + cluster.entryCount, 0);
    const primaryClusterSummary = clusters.find((cluster) => cluster.clusterId === primaryClusterId) || null;
    const normalizedDiscoveryMetadata = discoveryMetadata && typeof discoveryMetadata === 'object' ? discoveryMetadata : {};
    const acquisitionModes = Array.from(new Set([
        ...(Array.isArray(normalizedDiscoveryMetadata.acquisitionModes) ? normalizedDiscoveryMetadata.acquisitionModes : []),
        ...clusters.flatMap((cluster) => cluster.acquisitionModes || []),
    ]));
    const queryLevelAcquisitionProvenance = Array.isArray(normalizedDiscoveryMetadata.searchWindows)
        ? normalizedDiscoveryMetadata.searchWindows
        : [];
    const annotatedClusters = clusters.map((cluster) => ({
        ...cluster,
        selectedForReasoning: cluster.clusterId === primaryClusterId,
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
        selection: normalizedDiscoveryMetadata.selection ?? null,
        clusters: annotatedClusters,
        dominantClusterRatio: primaryClusterSummary
            ? Number((primaryClusterSummary.entryCount / Math.max(1, totalEntries)).toFixed(2))
            : 0,
        coverageConfidence: primaryClusterSummary ? 'partial' : 'low',
        reasoningScope: 'single-cluster',
        reasoningClusterId: primaryClusterId,
        recommendedPrimaryClusterId: primaryClusterId,
        secondaryClusterIds: clusters.map((cluster) => cluster.clusterId).filter((id) => id !== primaryClusterId),
    };
    baseSummary.heuristics = evaluateDiscoveryHeuristics(baseSummary, query);
    return baseSummary;
}

function normalizeScraperResult(scrapeResult) {
    if (Array.isArray(scrapeResult)) {
        return { casesToProcess: scrapeResult, discoveryMetadata: null };
    }
    return {
        casesToProcess: Array.isArray(scrapeResult?.casesToProcess) ? scrapeResult.casesToProcess : [],
        discoveryMetadata: scrapeResult?.discoveryMetadata || null,
    };
}

function normalizeEntryForGrouping(entry) {
    const normalizedCaseNumber = normalizeCaseNumber(entry?.caseInfo?.caseNumber || entry?.caseNumber) || 'N/A';
    return {
        ...entry,
        caseNumber: normalizedCaseNumber,
        caseInfo: entry?.caseInfo ? { ...entry.caseInfo, caseNumber: normalizedCaseNumber } : entry.caseInfo,
    };
}

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
    if (queriedKey && known(queriedKey)) return promote(queriedKey, 'case-number-query');

    const providedKey = providedSelection?.selectedCaseKey || null;
    if (providedKey && known(providedKey)) return promote(providedKey, providedSelection.method || 'discovery-selection');

    const [head] = clusters;
    return {
        clusters,
        primarySelection: {
            selectedCaseKey: head ? clusterIdOf(head) : null,
            method: 'coverage-scoring',
            source: 'scoring-fallback',
        },
    };
}

function buildDiscoveryResult(casesToProcess, options = {}, progressCallback) {
    const emitProgress = progressCallback;
    if (!casesToProcess || casesToProcess.length === 0) {
        throw new Error('Nije pronađen nijedan predmet za traženi pojam.');
    }

    emitProgress?.({ step: 'grouping', progress: 15, message: 'Grupiram pronađene objave po predmetima...' });
    const entriesForGrouping = casesToProcess.map(normalizeEntryForGrouping);
    const localSelection = selectPrimaryCase(entriesForGrouping, options.query || null);
    const providedSelection = options.discoveryMetadata?.selection || null;
    const discoveryProvidedKey = providedSelection?.selectedCaseKey || null;
    if (discoveryProvidedKey && localSelection.selectedCaseKey && discoveryProvidedKey !== localSelection.selectedCaseKey) {
        logger.warn('pipeline.buildDiscoveryResult', 'Discovery-provided primary key disagrees with local selection; discovery key still drives reasoning.', {
            runId: options?.runId || null,
            discoveryProvidedKey,
            localKey: localSelection.selectedCaseKey,
            method: localSelection.method,
        });
    }

    const allClusters = groupEntriesByCase(entriesForGrouping);
    const clusterSummaries = buildClusterSummaries(allClusters, options.query);
    const { clusters, primarySelection } = resolveReasoningPrimary(
        allClusters,
        selectClustersForProcessing(allClusters, clusterSummaries),
        { query: options.query || null, providedSelection },
    );

    const selection = options.discoveryMetadata?.selection || {};
    const analysisBudget = selection.analysisBudget;
    let coverageLedger = null;
    if (Number.isFinite(analysisBudget) || selection.allocation === 'all') {
        const primaryIndex = clusters.findIndex(
            (cluster) => (cluster?.clusterId || cluster?.caseNumber) === primarySelection.selectedCaseKey,
        );
        if (primaryIndex >= 0) {
            const entries = clusters[primaryIndex].entries;
            const stratified = stratifyClusterEntries(entries, {
                budget: selection.allocation === 'all' ? entries.length : analysisBudget,
            });
            if (selection.allocation !== 'all') {
                clusters[primaryIndex] = { ...clusters[primaryIndex], entries: stratified.entries };
            }
            coverageLedger = stratified.ledger;
        }
    }

    const discoverySummary = buildDiscoverySummary(clusterSummaries, clusters, options.query, options.discoveryMetadata);
    discoverySummary.primarySelection = { ...primarySelection, discoveryProvidedKey };
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
        message: `Pronađeno ${clusters.length} jedinstvenih predmeta (odabrano od ${allClusters.length} grupa iz ${casesToProcess.length} objava) za analizu.`,
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
            message: `Glavni predmet: ${primaryClusterSummary.primaryCaseNumber} — ${primaryClusterSummary.entryCount} objava, raspon ${primaryClusterSummary.entryDateSpanDays} dana, identitet: ${IDENTITY_LABELS_HR[primaryClusterSummary.identityConsistency] || primaryClusterSummary.identityConsistency}.`,
        });
    }

    return {
        allClusters,
        clusters,
        discoverySummary,
        primaryClusterId,
        primaryCluster: discoverySummary.clusters.find((cluster) => cluster.clusterId === primaryClusterId) || null,
        secondaryClusters: discoverySummary.clusters.filter((cluster) => cluster.clusterId !== primaryClusterId),
    };
}

module.exports = {
    CLUSTER_SELECTION_DEFAULTS,
    DISCOVERY_HEURISTICS_DEFAULTS,
    computeRawScrapeLimit,
    resolveScanDepth,
    buildClusterSummaries,
    evaluateDiscoveryHeuristics,
    buildDiscoverySummary,
    normalizeScraperResult,
    buildDiscoveryResult,
};
