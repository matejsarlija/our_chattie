// pipeline.js

const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
const { DownloadDocumentsTool } = require('./agents/download-agent');
const { ExtractArchiveTool } = require('./agents/extract-tool');
// We will modify AnalyzeDocumentsTool, so we need to import it
const { AnalyzeDocumentsTool } = require('./agents/analysis-agent');
const { VisualizerTool } = require('./agents/visualizer-agent');
const { enrichParticipants } = require('../court-registry/enricher');
const {
    DEFAULT_CASE_LIMIT,
    MIN_CASE_LIMIT,
    MAX_CASE_LIMIT,
} = require('../helpers/courtAnalysisRequest');
const { groupEntriesByCase } = require('./utils/grouping');
const { normalizeCaseNumber } = require('./utils/caseNumber');
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
        usage: null
    };
}

// Placeholder strings emitted by the reasoning layer when synthesis has no
// usable evidence (createEmptyReport). They carry no analyzable substance, so
// the visualizer must not run against them (it would only emit an empty stub).
const USELESS_ANALYSIS_TEXT_RE = /gre[šs]ka pri generiranju|nema dostupnih podataka za generiranje analize|analiza dokumenata nije uspje[šs]no izvr[šs]ena|nema dovoljno dokaza/i;

function isUsableAnalysisText(text) {
    const value = String(text || '').trim();
    return value.length > 0 && !USELESS_ANALYSIS_TEXT_RE.test(value);
}

function clampCaseLimit(rawLimit) {
    const numeric = Number.parseInt(String(rawLimit), 10);
    if (Number.isNaN(numeric)) return DEFAULT_CASE_LIMIT;
    if (numeric < MIN_CASE_LIMIT) return MIN_CASE_LIMIT;
    if (numeric > MAX_CASE_LIMIT) return MAX_CASE_LIMIT;
    return numeric;
}

// Track 3b — full document history. Default: capture the entire scanned search
// window so the selected primary cluster's merged documentLinks are all
// downloaded/analyzed, not just the top `caseLimit×3` entries. An explicit
// positive ANALYSIS_SCRAPE_LIMIT re-imposes a capture cap for quota conservation.
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
const CLUSTER_EXPANSION_DEFAULTS = {
    sufficientPrimaryClusterSpanDays: 365,
    maxClusterExpansionPasses: 2,
};
const DISCOVERY_HEURISTICS_DEFAULTS = {
    maxPagesScanned: 5,
    minEntriesBeforeStop: 8,
    targetPrimaryClusterEntries: 10,
    noNewClusterPageLimit: 2,
    maxClusterExpansionPasses: 2,
    sufficientPrimaryClusterSpanDays: 365,
    strongPrimaryClusterSpanDays: 730,
    dominantClusterRatioThreshold: 0.65
};

function computeRawScrapeLimit(caseLimit) {
    const envLimit = resolveAnalysisScrapeLimit();
    if (envLimit !== null) return envLimit;
    // Full document history: capture the whole scanned window for the primary
    // cluster (no caseLimit-derived truncation).
    return null;
}

// Resolves the scan-depth dial into concrete scraper parameters.
//   standard -> default forward window, no oldest-tail sample
//   balanced -> default forward window + oldest-10 tail sample (default)
//   full     -> scan every available page (tail subsumed)
function resolveScanDepth(scanDepth) {
    if (scanDepth === 'standard') {
        return { scanDepth: 'standard', maxPagesScanned: null, tailSample: false };
    }
    if (scanDepth === 'full') {
        return { scanDepth: 'full', maxPagesScanned: Infinity, tailSample: false };
    }
    return { scanDepth: 'balanced', maxPagesScanned: null, tailSample: true };
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
        return { action: 'expand', reason: 'promising-cluster-under-covered-after-search-window', details: { primaryEntryCount, primarySpanDays } };
    }

    if (hasNextPage) {
        return { action: 'paginate', reason: 'continue-search-window', details: { pagesScanned } };
    }

    return { action: 'stop', reason: 'exhausted-search-window', details: {} };
}

function evaluateClusterExpansionEligibility(primaryClusterSummary, summary = {}, query = null) {
    const thresholds = {
        targetPrimaryClusterEntries: CLUSTER_SELECTION_DEFAULTS.targetPrimaryClusterEntries,
        sufficientPrimaryClusterSpanDays: CLUSTER_EXPANSION_DEFAULTS.sufficientPrimaryClusterSpanDays,
        dominantClusterRatioThreshold: DISCOVERY_HEURISTICS_DEFAULTS.dominantClusterRatioThreshold,
        maxClusterExpansionPasses: CLUSTER_EXPANSION_DEFAULTS.maxClusterExpansionPasses
    };

    if (!primaryClusterSummary) {
        return {
            eligible: false,
            triggerReasons: [],
            blockerReasons: ['no-primary-cluster'],
            thresholds,
            metrics: {}
        };
    }

    const metrics = {
        primaryEntryCount: primaryClusterSummary.entryCount || 0,
        primarySpanDays: primaryClusterSummary.entryDateSpanDays || 0,
        dominantClusterRatio: summary.dominantClusterRatio || 0,
        capturedDistinctCaseCount: summary.capturedDistinctCaseCount || 0,
        hasNextPage: summary.hasNextPage ?? null,
        queryType: query?.type || null
    };
    const triggerReasons = [];

    if (metrics.primaryEntryCount < thresholds.targetPrimaryClusterEntries) {
        triggerReasons.push('entry-count-below-target');
    }

    if (metrics.primarySpanDays < thresholds.sufficientPrimaryClusterSpanDays) {
        triggerReasons.push('date-span-below-sufficient');
    }

    if (
        metrics.dominantClusterRatio >= thresholds.dominantClusterRatioThreshold &&
        triggerReasons.length > 0
    ) {
        triggerReasons.push('dominant-cluster-under-covered');
    }

    if (
        query?.type === 'case_number' &&
        metrics.primaryEntryCount < thresholds.targetPrimaryClusterEntries
    ) {
        triggerReasons.push('case-number-query-under-covered');
    }

    const blockerReasons = triggerReasons.length === 0
        ? ['primary-cluster-already-sufficient']
        : [];

    return {
        eligible: triggerReasons.length > 0,
        triggerReasons,
        blockerReasons,
        thresholds,
        metrics
    };
}

function buildClusterExpansionPlan(primaryClusterSummary, eligibility, query = null) {
    if (!eligibility?.eligible || !primaryClusterSummary) {
        return null;
    }

    const targetClusterId = primaryClusterSummary.clusterId || primaryClusterSummary.primaryCaseNumber || null;
    const blockedReasonCodes = [];
    let executable = true;
    let identityGuard = {
        mode: 'advisory',
        status: 'not-required',
        requiredOib: null,
        notes: []
    };

    if (query?.type === 'oib') {
        identityGuard = {
            mode: 'required',
            status: primaryClusterSummary.identityConsistency === 'consistent'
                ? 'satisfied'
                : 'ambiguous',
            requiredOib: query.value || null,
            notes: primaryClusterSummary.identityNotes || []
        };

        if (identityGuard.status !== 'satisfied') {
            executable = false;
            blockedReasonCodes.push('oib-identity-guard-not-satisfied');
        }
    } else if (query?.type === 'text') {
        identityGuard = {
            mode: 'advisory',
            status: primaryClusterSummary.identityConsistency || 'unresolved',
            requiredOib: null,
            notes: primaryClusterSummary.identityNotes || []
        };
    } else if (query?.type === 'case_number') {
        identityGuard = {
            mode: 'case-lineage',
            status: 'case-number-required',
            requiredOib: null,
            notes: ['Expansion must preserve normalized case-number lineage.']
        };
    } else if (primaryClusterSummary.identityConsistency === 'unresolved') {
        identityGuard = {
            mode: 'unavailable',
            status: 'missing-identity-signals',
            requiredOib: null,
            notes: primaryClusterSummary.identityNotes || []
        };
    }

    return {
        targetClusterId,
        executable,
        maxPasses: eligibility.thresholds?.maxClusterExpansionPasses ?? CLUSTER_EXPANSION_DEFAULTS.maxClusterExpansionPasses,
        strategies: [
            'case-number-follow-up-search',
            'detail-link-follow-up'
        ],
        reasonCodes: eligibility.triggerReasons || [],
        blockedReasonCodes,
        identityGuard
    };
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
    baseSummary.expansionEligibility = evaluateClusterExpansionEligibility(primaryClusterSummary, baseSummary, query);
    baseSummary.expansionPlan = buildClusterExpansionPlan(primaryClusterSummary, baseSummary.expansionEligibility, query);
    baseSummary.clusters = baseSummary.clusters.map((cluster) => {
        if (cluster.clusterId !== primaryClusterId) {
            return cluster;
        }

        return {
            ...cluster,
            expansionEligibility: baseSummary.expansionEligibility,
            expansionPlan: baseSummary.expansionPlan
        };
    });

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

function shouldExpandPrimaryCluster(primaryClusterSummary, discoverySummary = {}, query = null) {
    const plan = discoverySummary.expansionPlan || buildClusterExpansionPlan(
        primaryClusterSummary,
        evaluateClusterExpansionEligibility(primaryClusterSummary, discoverySummary, query),
        query
    );

    return plan?.executable === true;
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
    const expansionEligibility = initialDiscoverySummary?.expansionEligibility
        || evaluateClusterExpansionEligibility(primaryClusterSummary, initialDiscoverySummary, options.query);
    const expansionPlan = initialDiscoverySummary?.expansionPlan || buildClusterExpansionPlan(
        primaryClusterSummary,
        expansionEligibility,
        options.query
    );

    if (!shouldExpandPrimaryCluster(primaryClusterSummary, initialDiscoverySummary, options.query)) {
        return {
            entriesForGrouping,
            expansion: {
                status: 'skipped',
                expandedClusterId,
                appliedPasses: 0,
                appendedEntryCount: 0,
                skippedEntryCount: 0,
                reason: expansionPlan?.blockedReasonCodes?.[0] || 'primary-cluster-already-sufficient',
                expansionPlan
            }
        };
    }

    const normalizedClusterId = normalizeCaseNumber(expandedClusterId);
    const maxPasses = Math.min(expansionConfig.maxPasses, expansionPlan.maxPasses);
    const eligibleBatches = expansionConfig.batches
        .filter((batch) => normalizeCaseNumber(batch?.clusterId) === normalizedClusterId)
        .slice(0, maxPasses);

    if (eligibleBatches.length === 0) {
        return {
            entriesForGrouping,
            expansion: {
                status: 'skipped',
                expandedClusterId,
                appliedPasses: 0,
                appendedEntryCount: 0,
                skippedEntryCount: 0,
                reason: 'no-eligible-expansion-batches',
                expansionPlan
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
                reason: 'no-same-cluster-entries-appended',
                expansionPlan
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
            reason: 'bounded-cluster-expansion-applied',
            expansionPlan
        }
    };
}

/**
 * Executes deterministic cluster-expansion follow-up searches against a live
 * scraper (`automator`) when the primary cluster is under-covered. Produces
 * `clusterExpansion.batches` compatible with `applyConfiguredClusterExpansion`,
 * which remains the single application point (provenance tagging + counts).
 *
 * No LLM decision loop: eligibility comes from `expansionPlan`/eligibility
 * computed by the deterministic heuristics. A scraper lacking the follow-up
 * methods (mocks/fixtures) is treated as a no-op.
 */
async function executeClusterExpansionSearches(automator, discoveryResult, options = {}) {
    const discoverySummary = discoveryResult?.discoverySummary || {};
    const plan = discoverySummary.expansionPlan || null;
    const eligibility = discoverySummary.expansionEligibility || null;
    const primaryClusterId = discoveryResult?.primaryClusterId
        || discoverySummary.recommendedPrimaryClusterId
        || null;

    if (!automator || typeof automator.searchCaseNumberFollowUp !== 'function') {
        return { batches: [], status: 'no-automator', appliedPasses: 0 };
    }
    if (!plan?.executable || !eligibility?.eligible) {
        return { batches: [], status: 'not-eligible', appliedPasses: 0 };
    }
    if (Array.isArray(eligibility.blockerReasons) && eligibility.blockerReasons.length > 0) {
        return { batches: [], status: 'blocked', blockerReasons: eligibility.blockerReasons, appliedPasses: 0 };
    }

    const configuredMaxPasses = Number.isFinite(options.clusterExpansion?.maxPasses)
        ? options.clusterExpansion.maxPasses
        : null;
    const maxPasses = Math.min(
        configuredMaxPasses ?? CLUSTER_EXPANSION_DEFAULTS.maxClusterExpansionPasses,
        plan.maxPasses ?? CLUSTER_EXPANSION_DEFAULTS.maxClusterExpansionPasses
    );

    const primaryClusterSummary = (discoverySummary.clusters || []).find(c => c.clusterId === primaryClusterId) || null;
    const primaryCaseNumber = normalizeCaseNumber(
        primaryClusterSummary?.primaryCaseNumber || primaryClusterId
    );
    const uniqueDetailLinks = Array.from(new Set(
        (primaryClusterSummary?.acquisitionProvenance || [])
            .map(p => p.entryDetailLink)
            .filter(Boolean)
    ));

    const reason = plan.reasonCodes?.[0] || null;
    const batches = [];
    const seenEntryLinks = new Set();
    const seenDocumentUrls = new Set();

    // Seed the dedupe set with detail links already captured by the search
    // window so that a follow-up search which re-fetches the same case (the
    // typical single-cluster OIB shape, where case-number search returns the
    // same window) is treated as "no new entries" instead of appending
    // duplicates. Only explicit detail links are used as re-fetch identity;
    // link-less entries stay eligible so genuine same-case expansion is not
    // collapsed by the shared case number alone.
    for (const cluster of discoveryResult?.clusters || []) {
        if (cluster?.clusterId !== primaryClusterId) continue;
        for (const entry of cluster?.entries || []) {
            const detailLink = entry?.caseInfo?.detailLink || null;
            if (detailLink) seenEntryLinks.add(detailLink);
            for (const documentLink of entry?.documentLinks || []) {
                if (documentLink?.url) seenDocumentUrls.add(documentLink.url);
            }
        }
    }

    const hasNewEntries = (entries) => {
        let hasNew = false;
        for (const entry of entries || []) {
            const detailLink = entry?.caseInfo?.detailLink || entry?.caseInfo?.caseNumber || null;
            if (!detailLink) {
                // no fingerprint → treat as new
                hasNew = true;
                continue;
            }
            if (!seenEntryLinks.has(detailLink)) {
                seenEntryLinks.add(detailLink);
                hasNew = true;
            }
        }
        return hasNew;
    };

    // Detail pages are intentionally revisited even though their page URL is
    // already known. Their value is a newly exposed download URL, not a new
    // search-result row, so detail-link identity must not suppress them.
    const collectNewDetailDocuments = (entries) => {
        const newEntries = [];
        for (const entry of entries || []) {
            const documentLinks = (entry.documentLinks || []).filter((documentLink) => {
                if (!documentLink?.url || seenDocumentUrls.has(documentLink.url)) return false;
                seenDocumentUrls.add(documentLink.url);
                return true;
            });
            if (documentLinks.length > 0) {
                newEntries.push({ ...entry, documentLinks });
            }
        }
        return newEntries;
    };

    for (let pass = 1; pass <= maxPasses; pass += 1) {
        let anyNewThisPass = false;

        if (typeof automator.searchCaseNumberFollowUp === 'function') {
            const result = await automator.searchCaseNumberFollowUp(primaryCaseNumber, {
                pass,
                strategy: 'case-number-follow-up-search',
                reason,
                maxPages: options.expansionSearchPages ?? 1
            });
            if (hasNewEntries(result?.entries)) {
                batches.push({
                    clusterId: primaryClusterId,
                    pass,
                    strategy: 'case-number-follow-up-search',
                    reason,
                    entries: result.entries
                });
                anyNewThisPass = true;
            }
        }

        if (typeof automator.followDetailLinks === 'function' && uniqueDetailLinks.length > 0) {
            const result = await automator.followDetailLinks(uniqueDetailLinks, {
                pass,
                strategy: 'detail-link-follow-up',
                reason,
                sourceCaseNumber: primaryCaseNumber
            });
            const entriesWithNewDocuments = collectNewDetailDocuments(result?.entries);
            if (entriesWithNewDocuments.length > 0) {
                batches.push({
                    clusterId: primaryClusterId,
                    pass,
                    strategy: 'detail-link-follow-up',
                    reason,
                    entries: entriesWithNewDocuments
                });
                anyNewThisPass = true;
            }
        }

        // A pass that adds nothing new terminates the loop: re-running the same
        // searches would only re-discover the same entries.
        if (!anyNewThisPass) break;
    }

    return {
        batches,
        status: batches.length > 0 ? 'executed' : 'no-follow-up-found',
        appliedPasses: batches.length > 0 ? maxPasses : 0
    };
}

function buildDiscoveryResult(casesToProcess, options = {}, progressCallback) {
    // The initial discovery pass (expansion eligibility check) reuses this
    // function; suppress its progress events there so the timeline does not
    // receive duplicate grouping entries.
    const emitProgress = options.emitProgress === false ? null : progressCallback;

    if (!casesToProcess || casesToProcess.length === 0) {
        throw new Error('Nije pronađen nijedan predmet za traženi pojam.');
    }

    emitProgress?.({ step: 'grouping', progress: 15, message: 'Grupiram pronađene objave po predmetima...' });

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

    logger.info('pipeline.buildDiscoveryResult', 'Discovery completed', {
        clusters,
        allClusters: allClusters.length,
        primaryClusterId: primaryClusterId || null,
        queryType: options.query?.type || null,
        expansionApplied: Boolean(expansionResult.expansion),
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

function resolveAnalysisArgs(caseLimitOrOptions, maybeProgressCallback) {
    if (typeof caseLimitOrOptions === 'function') {
        const depth = resolveScanDepth('balanced');
        return {
            caseLimit: DEFAULT_CASE_LIMIT,
            scrapeLimit: computeRawScrapeLimit(DEFAULT_CASE_LIMIT),
            enableVisualizer: true,
            ...depth,
            progressCallback: caseLimitOrOptions,
        };
    }

    if (typeof caseLimitOrOptions === 'number' || typeof caseLimitOrOptions === 'string') {
        const caseLimit = clampCaseLimit(caseLimitOrOptions);
        const depth = resolveScanDepth('balanced');
        return {
            caseLimit,
            scrapeLimit: computeRawScrapeLimit(caseLimit),
            enableVisualizer: true,
            ...depth,
            progressCallback: maybeProgressCallback,
        };
    }

    if (caseLimitOrOptions && typeof caseLimitOrOptions === 'object') {
        const caseLimit = clampCaseLimit(caseLimitOrOptions.caseLimit);
        const depth = resolveScanDepth(caseLimitOrOptions.scanDepth);
        return {
            caseLimit,
            scrapeLimit: computeRawScrapeLimit(caseLimit),
            enableVisualizer: caseLimitOrOptions.enableVisualizer !== false,
            query: caseLimitOrOptions.query || null,
            clusterExpansion: caseLimitOrOptions.clusterExpansion || null,
            ...depth,
            progressCallback: maybeProgressCallback,
        };
    }

    const depth = resolveScanDepth('balanced');
    return {
        caseLimit: DEFAULT_CASE_LIMIT,
        scrapeLimit: computeRawScrapeLimit(DEFAULT_CASE_LIMIT),
        enableVisualizer: true,
        query: null,
        ...depth,
        progressCallback: maybeProgressCallback,
    };
}

/**
 * Optionally enriches `resolved` with cluster-expansion batches discovered via
 * live follow-up searches. Runs an initial deterministic discovery pass to
 * check eligibility; if eligible and the automator supports follow-up methods,
 * executes them and returns options carrying `clusterExpansion` batches so the
 * single application point (`applyConfiguredClusterExpansion`) can append them
 * with proper provenance.
 */
async function resolveAutoExpansion(automator, casesToProcess, resolved, progressCallback) {
    if (!automator || !casesToProcess || casesToProcess.length === 0) {
        return resolved;
    }

    const initialDiscovery = buildDiscoveryResult(casesToProcess, {
        caseLimit: resolved.caseLimit,
        query: resolved.query || null,
        clusterExpansion: null,
        discoveryMetadata: resolved.discoveryMetadata || null,
        emitProgress: false
    }, progressCallback);

    const expansionResult = await executeClusterExpansionSearches(automator, initialDiscovery, {
        clusterExpansion: resolved.clusterExpansion || null,
        expansionSearchPages: resolved.expansionSearchPages ?? 1
    });

    if (expansionResult.status !== 'executed' || expansionResult.batches.length === 0) {
        return resolved;
    }

    return {
        ...resolved,
        clusterExpansion: {
            maxPasses: expansionResult.appliedPasses || null,
            batches: expansionResult.batches
        }
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
        logger.info('pipeline.runCourtAnalysis', 'Starting court analysis', {
            queryType: resolved.query?.type || null,
            caseLimit: resolved.caseLimit,
            scrapeLimit: resolved.scrapeLimit,
        });
        callback?.({ step: 'discovering', progress: 10, message: 'Pretražujem sudske zapise za nedavne objave...' });
        await automator.init();
        const scrapeResult = await automator.searchAndGetLatestCasesWithDocuments(
            searchTerm,
            resolved.scrapeLimit,
            resolved.maxPagesScanned,
            resolved.tailSample
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
            cases: casesToProcess.length,
            discoveryMode: discoveryMetadata?.discoveryMode || null,
        });

        // Optional deterministic cluster-expansion follow-up searches (2b). Uses
        // the live automator; no-ops for mocks/fixtures lacking follow-up methods.
        const expandedResolved = await resolveAutoExpansion(automator, casesToProcess, {
            ...resolved,
            discoveryMetadata,
        }, callback);

        // Process the scraped cases using the separate function
        const result = await processScrapedCases(casesToProcess, callback, {
            caseLimit: expandedResolved.caseLimit,
            enableVisualizer: expandedResolved.enableVisualizer,
            query: expandedResolved.query || { value: searchTerm },
            clusterExpansion: expandedResolved.clusterExpansion,
            discoveryMetadata,
        });
        return result;

    } catch (error) {
        logger.error('pipeline.runCourtAnalysis', 'Court analysis failed', { error: error.message });
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
        const scrapeResult = await automator.searchAndGetLatestCases(searchTerm, null, resolved.maxPagesScanned, resolved.tailSample);
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        const expandedResolved = await resolveAutoExpansion(automator, casesToProcess, {
            ...resolved,
            discoveryMetadata,
        }, callback);

        return buildDiscoveryResult(casesToProcess, {
            caseLimit: expandedResolved.caseLimit,
            query: expandedResolved.query || { value: searchTerm },
            clusterExpansion: expandedResolved.clusterExpansion,
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
        const scrapeResult = await existingAutomator.searchAndGetLatestCasesWithDocuments(searchTerm, resolved.scrapeLimit, resolved.maxPagesScanned, resolved.tailSample);
        const { casesToProcess, discoveryMetadata } = normalizeScraperResult(scrapeResult);

        if (!casesToProcess || casesToProcess.length === 0) {
            throw new Error('Nije pronađen nijedan predmet s dostupnim dokumentima za traženi pojam.');
        }

        const expandedResolved = await resolveAutoExpansion(existingAutomator, casesToProcess, {
            ...resolved,
            discoveryMetadata,
        }, callback);

        // Process using the shared logic
        const result = await processScrapedCases(casesToProcess, callback, {
            caseLimit: expandedResolved.caseLimit,
            enableVisualizer: expandedResolved.enableVisualizer,
            query: expandedResolved.query || { value: searchTerm },
            clusterExpansion: expandedResolved.clusterExpansion,
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
        const reasoningClusters = primaryClusterId
            ? clusters.filter((cluster) => (cluster.clusterId || cluster.caseNumber) === primaryClusterId)
            : clusters.slice(0, 1);
        const selectedReasoningCluster = reasoningClusters[0] || null;
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
        const totalCases = reasoningClusters.length;

        logger.info('pipeline.processScrapedCases', 'Discovery grouped', {
            clusters: clusters.length,
            reasoningClusters: totalCases,
            primaryClusterId: primaryClusterId || null,
            secondaryClusters: secondaryClusters.length,
            queryType: resolvedOptions.query?.type || null,
        });

        const downloadTool = new DownloadDocumentsTool();
        const extractTool = new ExtractArchiveTool();
        const analyzeTool = new AnalyzeDocumentsTool();

        // Reason only over the selected primary cluster. Other clusters remain discovery outputs.
        for (let i = 0; i < totalCases; i++) {
            const cluster = reasoningClusters[i];
            const clusterId = cluster.clusterId || cluster.caseNumber || `anonymous-${i + 1}`;
            const clusterSummary = discoverySummary.clusters.find((summary) => summary.clusterId === clusterId);
            
            // Use the first entry as the primary metadata source (most recent usually)
            const primaryEntry = cluster.entries[0];
            const { caseInfo } = primaryEntry;
            
            // Merge document links from all entries in the cluster
            const documentLinks = cluster.entries.flatMap(e => e.documentLinks || []);

            let downloadedFiles = [];
            let extractedFilePaths = [];

            stageAwareProgress?.({ step: 'downloading', progress: 25 + (i / totalCases) * 50, message: `Obrađujem predmet ${i + 1} od ${totalCases}: ${caseInfo.caseNumber} (${cluster.entries.length} objava)` });

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
            stageAwareProgress?.({ step: 'downloading', message: `Preuzimam arhivu za predmet ${i + 1} (${documentLinks.length} linkova)...` });
            downloadedFiles = await downloadTool._call({ documentLinks, progressCallback: null });
            stageAwareProgress?.({ step: 'downloading', message: `Preuzeto ${downloadedFiles.length}/${documentLinks.length} datoteka za predmet ${i + 1}.` });

            // 2b. Unzip
            stageAwareProgress?.({ step: 'extracting', message: `Raspakiram datoteke za predmet ${i + 1}...` });
            const filesForAnalysis = [];
            for (const file of downloadedFiles) {
                extractedFilePaths.push(file.filePath);
                if (path.extname(file.filePath).toLowerCase() === '.zip') {
                    const extractionDir = path.dirname(file.filePath);
                    const extractionResult = await extractTool._call({ filePath: file.filePath, destination: extractionDir });
                    for (const extracted of (extractionResult.extractedFiles || [])) {
                        filesForAnalysis.push({ filePath: extracted.filePath, text: extracted.entryName, url: file.url });
                        extractedFilePaths.push(extracted.filePath);
                    }
                } else {
                    filesForAnalysis.push(file);
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
                        expansionEligibility: clusterSummary?.expansionEligibility || null,
                        expansionPlan: clusterSummary?.expansionPlan || null,
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
            stageAwareProgress?.({ step: 'reasoning', message: `Analiziram ${filesForAnalysis.length} datoteka za predmet ${i + 1}...` });
            const analysis = await analyzeTool._call({ files: filesForAnalysis, caseInfo: caseInfo, progressCallback: stageAwareProgress, usageTracker, onUsage: emitUsage });
            const analysisCoverage = analysis?.coverage || {};
            stageAwareProgress?.({
                step: 'reasoning',
                message: `AI analiza predmeta ${i + 1} dovršena: ${analysisCoverage.analyzed ?? 0} uspješno, ${analysisCoverage.failed ?? 0} neuspjelo od ${analysisCoverage.total ?? filesForAnalysis.length} datoteka.`
            });
            logger.info('pipeline.processScrapedCases', 'Case analyzed', {
                caseIndex: i + 1,
                totalCases,
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
                    expansionEligibility: clusterSummary?.expansionEligibility || null,
                    expansionPlan: clusterSummary?.expansionPlan || null,
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
        const report = await generateClusterReport(enrichedEvidencePackage, {
            onStage: (event) => stageAwareProgress?.(event),
            tracker: usageTracker,
            onUsage: emitUsage
        });
        partialResult.report = report;

        // One LLM narrative per run: the human-facing overview is composed
        // deterministically from the synthesized report instead of asking the
        // model for a second, overlapping summary.
        let comparativeAnalysis = composeOverviewMarkdown(report);
        partialResult.comparativeAnalysis = comparativeAnalysis;
        logger.info('pipeline.processScrapedCases', 'Reasoning report generated', {
            processedCases: allProcessedCases.length,
            reportFindings: Array.isArray(report?.findings) ? report.findings.length : 0,
            verificationStatus: report?.verification?.status || null,
        });

        // --- VISUALIZATION STEP ---
        if (resolvedOptions.enableVisualizer && isUsableAnalysisText(comparativeAnalysis)) {
            stageAwareProgress?.({ step: 'reasoning', progress: 95, message: 'Generiram vizualizaciju tijeka predmeta...' });
            try {
                const visualizerTool = new VisualizerTool();
                const diagramCode = await visualizerTool._call(comparativeAnalysis, {
                    moneyFlow: enrichedEvidencePackage?.moneyFlow || null,
                    tracker: usageTracker,
                    onUsage: emitUsage
                });
                if (diagramCode && diagramCode !== "Error generating diagram.") {
                    comparativeAnalysis += `\n\n${diagramCode}`;
                }
            } catch (err) {
                agentLog.error('Visualization failed gracefully:', err.message);
            }
        }
        // -------------------------

        stageAwareProgress?.({ step: 'complete', progress: 100, message: 'Analiza je završena!' });
        logger.info('pipeline.processScrapedCases', 'Analysis complete', {
            processedCases: allProcessedCases.length,
            hasReport: Boolean(report),
        });

        return {
            processedCases: allProcessedCases,
            comparativeAnalysis: comparativeAnalysis,
            discoverySummary,
            primaryCluster,
            secondaryClusters,
            clusterEvidencePackage: enrichedEvidencePackage,
            report,
            usage: usageTracker.snapshot()
        };

    } catch (error) {
        // Re-throw wrapped with whatever partial results were accumulated before the
        // failing stage, so the API layer can persist discovery data + a transparent
        // error instead of discarding everything.
        partialResult.usage = usageTracker.snapshot();
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
    runCourtAnalysisWithExistingAutomator,
    processScrapedCases,
    buildDiscoveryResult,
    PartialAnalysisError,
    buildEmptyPartialResult,
    evaluateDiscoveryHeuristics,
    evaluateClusterExpansionEligibility,
    buildClusterExpansionPlan,
    applyConfiguredClusterExpansion,
    executeClusterExpansionSearches,
    resolveAutoExpansion,
    isUsableAnalysisText
};
