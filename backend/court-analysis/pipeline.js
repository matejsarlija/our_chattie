// pipeline.js

const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { DownloadDocumentsTool } = require('./agents/download-agent');
// We will modify AnalyzeDocumentsTool, so we need to import it
const { AnalyzeDocumentsTool, generateComparativeAnalysis } = require('./agents/analysis-agent');
const { VisualizerTool } = require('./agents/visualizer-agent');
const { enrichParticipants } = require('../court-registry/enricher');
const {
    DEFAULT_CASE_LIMIT,
    MIN_CASE_LIMIT,
    MAX_CASE_LIMIT,
} = require('../helpers/courtAnalysisRequest');
const { groupEntriesByCase } = require('./utils/grouping');
const { normalizeCaseNumber } = require('./utils/caseNumber');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

function clampCaseLimit(rawLimit) {
    const numeric = Number.parseInt(String(rawLimit), 10);
    if (Number.isNaN(numeric)) return DEFAULT_CASE_LIMIT;
    if (numeric < MIN_CASE_LIMIT) return MIN_CASE_LIMIT;
    if (numeric > MAX_CASE_LIMIT) return MAX_CASE_LIMIT;
    return numeric;
}

const RAW_SCRAPE_MULTIPLIER = 3;
const CLUSTER_SELECTION_DEFAULTS = {
    entryCountScoreWeight: 0.35,
    entryDateSpanScoreWeight: 0.30,
    recencyScoreWeight: 0.20,
    dominanceScoreWeight: 0.10,
    documentScoreWeight: 0.05,
    targetPrimaryClusterEntries: 10,
    strongPrimaryClusterSpanDays: 730,
};
const CLUSTER_EXPANSION_DEFAULTS = {
    sufficientPrimaryClusterSpanDays: 365,
    maxClusterExpansionPasses: 2,
};

function computeRawScrapeLimit(caseLimit) {
    const normalizedLimit = clampCaseLimit(caseLimit);
    const maxRawLimit = MAX_CASE_LIMIT * RAW_SCRAPE_MULTIPLIER;
    return Math.min(normalizedLimit * RAW_SCRAPE_MULTIPLIER, maxRawLimit);
}

function parseCaseDateToTimestamp(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return null;
    const value = rawDate.trim();
    if (!value || value.toUpperCase() === 'N/A') return null;

    const croatianDateMatch = value.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\.?$/);
    if (croatianDateMatch) {
        const day = Number.parseInt(croatianDateMatch[1], 10);
        const month = Number.parseInt(croatianDateMatch[2], 10);
        const yearRaw = Number.parseInt(croatianDateMatch[3], 10);
        const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
        const ts = Date.UTC(year, month - 1, day);
        const parsed = new Date(ts);

        if (
            parsed.getUTCFullYear() === year &&
            parsed.getUTCMonth() === month - 1 &&
            parsed.getUTCDate() === day
        ) {
            return ts;
        }
        return null;
    }

    const fallbackTs = Date.parse(value);
    return Number.isNaN(fallbackTs) ? null : fallbackTs;
}

function collectClusterParticipantSignals(cluster) {
    const participantNames = new Set();
    const oibs = new Set();

    for (const entry of cluster.entries || []) {
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
        oibs: Array.from(oibs)
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
    const { participantNames, oibs } = collectClusterParticipantSignals(cluster);

    if (query?.type === 'oib' && query?.value) {
        if (oibs.length === 1 && oibs[0] === query.value) {
            return { identityConsistency: 'consistent', identityNotes: [] };
        }

        if (oibs.length === 0) {
            return {
                identityConsistency: 'unresolved',
                identityNotes: [`Queried OIB ${query.value} is not visible in captured participant metadata.`]
            };
        }

        return {
            identityConsistency: 'ambiguous',
            identityNotes: [`Captured participant OIBs (${oibs.join(', ')}) do not cleanly match queried OIB ${query.value}.`]
        };
    }

    if (oibs.length > 1) {
        return {
            identityConsistency: 'ambiguous',
            identityNotes: [`Multiple participant OIBs detected in cluster: ${oibs.join(', ')}.`]
        };
    }

    if (oibs.length === 1) {
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

        return {
            ...summary,
            score: Number((weightedScore * identityMultiplier).toFixed(4)),
            selectionReason: 'ranked by deterministic coverage-aware selection policy (entry count, date span, recency, dominance, document coverage, and identity confidence when query intent is entity-oriented)'
        };
    });
}

function selectClustersForProcessing(allClusters, clusterSummaries, rawCaseLimit) {
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

    if (typeof rawCaseLimit !== 'number' || Number.isNaN(rawCaseLimit)) {
        return scored.map((item) => item.cluster);
    }

    const caseLimit = clampCaseLimit(rawCaseLimit);
    return scored.slice(0, caseLimit).map((item) => item.cluster);
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
    const queryLevelAcquisitionProvenance = [
        ...(Array.isArray(normalizedDiscoveryMetadata.searchWindows)
            ? normalizedDiscoveryMetadata.searchWindows
            : []),
        ...clusters.flatMap(cluster => cluster.acquisitionProvenance || [])
            .filter((provenance) => provenance.mode === 'cluster-expansion')
    ];

    return {
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
        clusters,
        dominantClusterRatio: primaryClusterSummary
            ? Number((primaryClusterSummary.entryCount / Math.max(1, totalEntries)).toFixed(2))
            : 0,
        coverageConfidence: primaryClusterSummary ? 'partial' : 'low',
        recommendedPrimaryClusterId: primaryClusterId,
        secondaryClusterIds: clusters
            .map(cluster => cluster.clusterId)
            .filter(clusterId => clusterId !== primaryClusterId)
    };
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

function resolveClusterExpansionConfig(options = {}) {
    const configuredExpansion = options.clusterExpansion || options.discoveryMetadata?.clusterExpansion;

    if (!configuredExpansion || typeof configuredExpansion !== 'object') {
        return null;
    }

    return {
        maxPasses: Number.isFinite(configuredExpansion.maxPasses)
            ? Math.max(0, configuredExpansion.maxPasses)
            : CLUSTER_EXPANSION_DEFAULTS.maxClusterExpansionPasses,
        batches: Array.isArray(configuredExpansion.batches) ? configuredExpansion.batches : []
    };
}

function shouldExpandPrimaryCluster(primaryClusterSummary) {
    if (!primaryClusterSummary) {
        return false;
    }

    return (
        primaryClusterSummary.entryCount < CLUSTER_SELECTION_DEFAULTS.targetPrimaryClusterEntries
        || primaryClusterSummary.entryDateSpanDays < CLUSTER_EXPANSION_DEFAULTS.sufficientPrimaryClusterSpanDays
    );
}

function applyConfiguredClusterExpansion(entriesForGrouping, initialDiscoverySummary, options = {}) {
    const expansionConfig = resolveClusterExpansionConfig(options);

    if (!expansionConfig) {
        return {
            entriesForGrouping,
            expansion: null
        };
    }

    const expandedClusterId = initialDiscoverySummary?.recommendedPrimaryClusterId || null;
    const primaryClusterSummary = initialDiscoverySummary?.clusters?.find(
        (cluster) => cluster.clusterId === expandedClusterId
    ) || null;

    if (!shouldExpandPrimaryCluster(primaryClusterSummary)) {
        return {
            entriesForGrouping,
            expansion: {
                status: 'skipped',
                expandedClusterId,
                appliedPasses: 0,
                appendedEntryCount: 0,
                skippedEntryCount: 0,
                reason: 'primary-cluster-already-sufficient'
            }
        };
    }

    const normalizedClusterId = normalizeCaseNumber(expandedClusterId);
    const eligibleBatches = expansionConfig.batches
        .filter((batch) => normalizeCaseNumber(batch?.clusterId) === normalizedClusterId)
        .slice(0, expansionConfig.maxPasses);

    if (eligibleBatches.length === 0) {
        return {
            entriesForGrouping,
            expansion: {
                status: 'skipped',
                expandedClusterId,
                appliedPasses: 0,
                appendedEntryCount: 0,
                skippedEntryCount: 0,
                reason: 'no-eligible-expansion-batches'
            }
        };
    }

    const appendedEntries = [];
    let skippedEntryCount = 0;

    eligibleBatches.forEach((batch, batchIndex) => {
        const pass = batch?.pass ?? (batchIndex + 1);

        for (const rawEntry of batch?.entries || []) {
            const normalizedEntry = normalizeEntryForGrouping(rawEntry);

            if (normalizedEntry.caseNumber !== normalizedClusterId) {
                skippedEntryCount += 1;
                continue;
            }

            appendedEntries.push({
                ...normalizedEntry,
                acquisition: {
                    ...(normalizedEntry.acquisition || {}),
                    mode: 'cluster-expansion',
                    sourceCaseNumber: normalizedClusterId,
                    pass,
                    reason: batch?.reason || normalizedEntry?.acquisition?.reason || null,
                    strategy: batch?.strategy || normalizedEntry?.acquisition?.strategy || null
                }
            });
        }
    });

    if (appendedEntries.length === 0) {
        return {
            entriesForGrouping,
            expansion: {
                status: 'skipped',
                expandedClusterId,
                appliedPasses: 0,
                appendedEntryCount: 0,
                skippedEntryCount,
                reason: 'no-same-cluster-entries-appended'
            }
        };
    }

    return {
        entriesForGrouping: [...entriesForGrouping, ...appendedEntries],
        expansion: {
            status: 'applied',
            expandedClusterId,
            appliedPasses: eligibleBatches.length,
            appendedEntryCount: appendedEntries.length,
            skippedEntryCount,
            reason: 'bounded-cluster-expansion-applied'
        }
    };
}

function buildDiscoveryResult(casesToProcess, options = {}, progressCallback) {
    if (!casesToProcess || casesToProcess.length === 0) {
        throw new Error('Nije pronađen nijedan predmet za traženi pojam.');
    }

    progressCallback?.({ step: 'grouping', progress: 15, message: 'Grupiram pronađene objave po predmetima...' });

    const entriesForGrouping = casesToProcess.map(normalizeEntryForGrouping);
    const initialAllClusters = groupEntriesByCase(entriesForGrouping);
    const initialClusterSummaries = buildClusterSummaries(initialAllClusters, options.query);
    const initialClusters = selectClustersForProcessing(initialAllClusters, initialClusterSummaries, options.caseLimit);
    const initialDiscoverySummary = buildDiscoverySummary(
        initialClusterSummaries,
        initialClusters,
        options.query,
        options.discoveryMetadata
    );
    const expansionResult = applyConfiguredClusterExpansion(entriesForGrouping, initialDiscoverySummary, options);
    const allClusters = groupEntriesByCase(expansionResult.entriesForGrouping);
    const clusterSummaries = buildClusterSummaries(allClusters, options.query);
    const clusters = selectClustersForProcessing(allClusters, clusterSummaries, options.caseLimit);
    const discoverySummary = buildDiscoverySummary(
        clusterSummaries,
        clusters,
        options.query,
        options.discoveryMetadata
    );

    if (expansionResult.expansion) {
        discoverySummary.expansion = expansionResult.expansion;
        discoverySummary.clusters = discoverySummary.clusters.map((cluster) => {
            if (cluster.clusterId !== expansionResult.expansion.expandedClusterId) {
                return cluster;
            }

            return {
                ...cluster,
                expansion: expansionResult.expansion
            };
        });
    }

    const primaryClusterId = discoverySummary.recommendedPrimaryClusterId;

    progressCallback?.({
        step: 'grouping',
        progress: 20,
        message: `Pronađeno ${clusters.length} jedinstvenih predmeta (odabrano od ${allClusters.length} grupa iz ${casesToProcess.length} objava) za analizu.`
    });

    return {
        allClusters,
        clusters,
        discoverySummary,
        primaryClusterId,
        primaryCluster: discoverySummary.clusters.find((cluster) => cluster.clusterId === primaryClusterId) || null,
        secondaryClusters: discoverySummary.clusters.filter((cluster) => cluster.clusterId !== primaryClusterId)
    };
}

function resolveAnalysisArgs(caseLimitOrOptions, maybeProgressCallback) {
    if (typeof caseLimitOrOptions === 'function') {
        return {
            caseLimit: DEFAULT_CASE_LIMIT,
            scrapeLimit: computeRawScrapeLimit(DEFAULT_CASE_LIMIT),
            enableVisualizer: true,
            progressCallback: caseLimitOrOptions,
        };
    }

    if (typeof caseLimitOrOptions === 'number' || typeof caseLimitOrOptions === 'string') {
        const caseLimit = clampCaseLimit(caseLimitOrOptions);
        return {
            caseLimit,
            scrapeLimit: computeRawScrapeLimit(caseLimit),
            enableVisualizer: true,
            progressCallback: maybeProgressCallback,
        };
    }

    if (caseLimitOrOptions && typeof caseLimitOrOptions === 'object') {
        const caseLimit = clampCaseLimit(caseLimitOrOptions.caseLimit);
        return {
            caseLimit,
            scrapeLimit: computeRawScrapeLimit(caseLimit),
            enableVisualizer: caseLimitOrOptions.enableVisualizer !== false,
            query: caseLimitOrOptions.query || null,
            clusterExpansion: caseLimitOrOptions.clusterExpansion || null,
            progressCallback: maybeProgressCallback,
        };
    }

    return {
        caseLimit: DEFAULT_CASE_LIMIT,
        scrapeLimit: computeRawScrapeLimit(DEFAULT_CASE_LIMIT),
        enableVisualizer: true,
        query: null,
        progressCallback: maybeProgressCallback,
    };
}

/**
 * New Pipeline for comparative court analysis: (Scrape → [Download → Unzip → Analyze] x N) → Compare
 * @param {string} searchTerm
 * @param {number|object|function} caseLimitOrOptions - Case limit or options object.
 * @param {function} progressCallback
 */
async function runCourtAnalysis(searchTerm, caseLimitOrOptions, progressCallback) {
    const resolved = resolveAnalysisArgs(caseLimitOrOptions, progressCallback);
    const callback = resolved.progressCallback;
    const automator = new CourtSearchPuppeteer();
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        // 1. Scrape for the N latest cases
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.scrapeLimit);
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);
        
        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // Process the scraped cases using the separate function
        const result = await processScrapedCases(casesToProcess, callback, {
            caseLimit: resolved.caseLimit,
            enableVisualizer: resolved.enableVisualizer,
            query: resolved.query || { value: searchTerm },
            clusterExpansion: resolved.clusterExpansion,
            discoveryMetadata,
        });
        return result;

    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        // Always close automator here - simpler logic
        await automator.close();
        await cleanupFiles(allFilesToCleanup);
    }
}

async function runCourtDiscovery(searchTerm, caseLimitOrOptions, progressCallback) {
    const resolved = resolveAnalysisArgs(caseLimitOrOptions, progressCallback);
    const callback = resolved.progressCallback;
    const automator = new CourtSearchPuppeteer();

    try {
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCases(searchTerm);
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        return buildDiscoveryResult(casesToProcess, {
            caseLimit: resolved.caseLimit,
            query: resolved.query || { value: searchTerm },
            clusterExpansion: resolved.clusterExpansion,
            discoveryMetadata
        }, callback);
    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        await automator.close();
    }
}

/**
 * Modified version of runCourtAnalysis that uses an existing automator instance
 * This prevents creating multiple Puppeteer instances in the cron job
 */
async function runCourtAnalysisWithExistingAutomator(searchTerm, caseLimitOrOptions, existingAutomator, progressCallback) {
    const resolved = resolveAnalysisArgs(caseLimitOrOptions, progressCallback);
    const callback = resolved.progressCallback;
    const allProcessedCases = [];
    let allFilesToCleanup = [];

    try {
        // 1. Use the existing automator to scrape (no init/close needed)
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        const scrapeResult = await existingAutomator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.scrapeLimit);
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        // Process using the shared logic
        const result = await processScrapedCases(casesToProcess, callback, {
            caseLimit: resolved.caseLimit,
            enableVisualizer: resolved.enableVisualizer,
            query: resolved.query || { value: searchTerm },
            clusterExpansion: resolved.clusterExpansion,
            discoveryMetadata,
        });
        return result;

    } catch (error) {
        callback?.({ step: 'error', progress: 100, message: error.message });
        throw error;
    } finally {
        // Don't close the automator - the cron job will handle that
        await cleanupFiles(allFilesToCleanup);
    }
}

/**
 * The CORE processing function. It takes pre-scraped cases and performs
 * the download, unzip, analysis, and comparison steps.
 * @param {Array<object>} casesToProcess - The array of case objects from the scraper.
 * @param {function} progressCallback - The callback for sending progress updates.
 * @returns {Promise<object>} The final result with processed cases and comparative analysis.
 */
async function processScrapedCases(casesToProcess, progressCallback, options = { enableVisualizer: true }) {
    const resolvedOptions = {
        enableVisualizer: true,
        ...options,
    };
    const allProcessedCases = [];
    let allFilesToCleanup = [];

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
        } = buildDiscoveryResult(casesToProcess, resolvedOptions, progressCallback);
        const totalCases = clusters.length;

        const downloadTool = new DownloadDocumentsTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // Loop through each case CLUSTER
        for (let i = 0; i < totalCases; i++) {
            const cluster = clusters[i];
            const clusterId = cluster.clusterId || cluster.caseNumber || `anonymous-${i + 1}`;
            const clusterSummary = discoverySummary.clusters.find((summary) => summary.clusterId === clusterId);
            
            // Use the first entry as the primary metadata source (most recent usually)
            const primaryEntry = cluster.entries[0];
            const { caseInfo } = primaryEntry;
            
            // Merge document links from all entries in the cluster
            const documentLinks = cluster.entries.flatMap(e => e.documentLinks || []);

            let downloadedFiles = [];
            let extractedFilePaths = [];

            progressCallback?.({ step: 'downloading', progress: 25 + (i / totalCases) * 50, message: `Obrađujem predmet ${i + 1} od ${totalCases}: ${caseInfo.caseNumber} (${cluster.entries.length} objava)` });

            // --- ENRICHMENT STEP ---
            if (caseInfo.participants && caseInfo.participants.length > 0) {
                progressCallback?.({ step: 'discovering', message: `Dohvaćam podatke iz Sudskog registra za sudionike...` });
                try {
                    caseInfo.participants = await enrichParticipants(caseInfo.participants);
                } catch (err) {
                    console.error('Enrichment failed gracefully:', err.message);
                }
            }
            // -----------------------

            // 2a. Download
            progressCallback?.({ step: 'downloading', message: `Preuzimam arhivu za predmet ${i + 1} (${documentLinks.length} linkova)...` });
            downloadedFiles = await downloadTool._call({ documentLinks, progressCallback: null });

            // 2b. Unzip
            progressCallback?.({ step: 'extracting', message: `Raspakiram datoteke za predmet ${i + 1}...` });
            const filesForAnalysis = [];
            for (const file of downloadedFiles) {
                extractedFilePaths.push(file.filePath);
                if (path.extname(file.filePath).toLowerCase() === '.zip') {
                    const zip = new AdmZip(file.filePath);
                    const zipEntries = zip.getEntries();
                    const extractionDir = path.dirname(file.filePath);
                    zipEntries.forEach((zipEntry) => {
                        if (!zipEntry.isDirectory) {
                            const extractedFilePath = path.join(extractionDir, zipEntry.entryName);
                            zip.extractEntryTo(zipEntry.entryName, extractionDir, false, true);
                            filesForAnalysis.push({ filePath: extractedFilePath, text: zipEntry.entryName, url: file.url });
                            extractedFilePaths.push(extractedFilePath);
                        }
                    });
                } else {
                    filesForAnalysis.push(file);
                }
            }
            
            allFilesToCleanup.push(...extractedFilePaths);

            if (filesForAnalysis.length === 0) {
                 console.warn(`No files to analyze for case ${caseInfo.title}. Skipping analysis.`);
                 allProcessedCases.push({
                    caseResult: caseInfo,
                    analysis: { individualAnalyses: [], finalSummary: "Nema dokumenata za analizu." },
                    groupMetadata: {
                        clusterId,
                        primaryCaseNumber: clusterSummary?.primaryCaseNumber || cluster.caseNumber || 'N/A',
                        entryCount: cluster.entries.length,
                        isAnonymous: cluster.isAnonymous,
                        identityConsistency: clusterSummary?.identityConsistency || 'unresolved',
                        identityNotes: clusterSummary?.identityNotes || [],
                        participantNames: clusterSummary?.participantNames || [],
                        participantOibs: clusterSummary?.participantOibs || [],
                        acquisitionModes: clusterSummary?.acquisitionModes || [],
                        acquisitionProvenance: clusterSummary?.acquisitionProvenance || [],
                        entryCountsByAcquisitionMode: clusterSummary?.entryCountsByAcquisitionMode || {},
                        documentCountsByAcquisitionMode: clusterSummary?.documentCountsByAcquisitionMode || {},
                        expansion: clusterSummary?.expansion || null,
                        selectedForReasoning: clusterId === primaryClusterId
                    }
                 });
                 continue;
            }

            // 2c. Analyze THIS case's documents
            progressCallback?.({ step: 'reasoning', message: `Analiziram ${filesForAnalysis.length} datoteka za predmet ${i + 1}...` });
            const analysis = await analyzeTool._call({ files: filesForAnalysis, caseInfo: caseInfo, progressCallback: null });

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
                    identityConsistency: clusterSummary?.identityConsistency || 'unresolved',
                    identityNotes: clusterSummary?.identityNotes || [],
                    participantNames: clusterSummary?.participantNames || [],
                    participantOibs: clusterSummary?.participantOibs || [],
                    acquisitionModes: clusterSummary?.acquisitionModes || [],
                    acquisitionProvenance: clusterSummary?.acquisitionProvenance || [],
                    entryCountsByAcquisitionMode: clusterSummary?.entryCountsByAcquisitionMode || {},
                    documentCountsByAcquisitionMode: clusterSummary?.documentCountsByAcquisitionMode || {},
                    expansion: clusterSummary?.expansion || null,
                    selectedForReasoning: clusterId === primaryClusterId
                }
            });
        }

        // 3. Final Comparative Analysis
        progressCallback?.({ step: 'reasoning', progress: 85, message: 'Generiram usporednu analizu i zaključak...' });
        let comparativeAnalysis = await generateComparativeAnalysis(allProcessedCases);

        // --- VISUALIZATION STEP ---
        if (resolvedOptions.enableVisualizer && comparativeAnalysis) {
            progressCallback?.({ step: 'reasoning', progress: 95, message: 'Generiram vizualizaciju tijeka predmeta...' });
            try {
                const visualizerTool = new VisualizerTool();
                const diagramCode = await visualizerTool._call(comparativeAnalysis);
                if (diagramCode && diagramCode !== "Error generating diagram.") {
                    comparativeAnalysis += `\n\n${diagramCode}`;
                }
            } catch (err) {
                console.error('Visualization failed gracefully:', err.message);
            }
        }
        // -------------------------

        progressCallback?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis,
            discoverySummary,
            primaryCluster,
            secondaryClusters
        };

    } catch (error) {
        // Re-throw the error for the calling function (orchestrator) to handle.
        throw error;
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
            console.warn(`Failed to delete temporary file ${filePath}: ${err.message}`);
        }
    }
}

module.exports = { runCourtAnalysis, runCourtDiscovery, runCourtAnalysisWithExistingAutomator, processScrapedCases };
