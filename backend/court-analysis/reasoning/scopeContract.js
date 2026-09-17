// court-analysis/reasoning/scopeContract.js
//
// Machine-readable conclusion contract (spec §4.1 / ticket T1-1, backend
// half). Every report carries what its evidence can and cannot support, so
// the narrative can never over-claim a partial corpus as a case conclusion.
//
// Conclusion categories are fixed and independent of backend query
// classification — they are evidence-coverage categories, not new query
// types: `docket_timeline`, `documented_claims`, `current_procedural_status`,
// `full_case_outcome`. Status is `discovery_only | partial | sufficient`.
//
// Pure function over already-computed run artifacts (coverage, discovery
// summary, analyses, rerank result). No model calls, no I/O.

const { normalizeText } = require('./indexer');
const { parseCaseDateToTimestamp } = require('../utils/caseDate');

const CONCLUSION_CATEGORIES = [
    'docket_timeline',
    'documented_claims',
    'current_procedural_status',
    'full_case_outcome'
];

// Interim ledger detector until TS-1 document roles land: distribution and
// final-account filings carry formulaic Croatian titles. Both sides are
// normalized (diacritics/case) before matching.
const LEDGER_FILENAME_KEYWORDS = [
    'diobeni',
    'diobni popis',
    'dioba',
    'zavrsni racun',
    'zakljucni racun'
];

function normalizedFileName(name) {
    return normalizeText(String(name || ''));
}

function isLedgerFileName(name) {
    const normalized = normalizedFileName(name);
    if (!normalized) return false;
    return LEDGER_FILENAME_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function analyzedFileNames(analyses) {
    return (Array.isArray(analyses) ? analyses : [])
        .map((analysis) => analysis?.fileName)
        .filter((name) => typeof name === 'string' && name);
}

function failedFileNames(coverage) {
    const files = Array.isArray(coverage?.failedFiles) ? coverage.failedFiles : [];
    return files
        .map((file) => (typeof file === 'string' ? file : file?.fileName))
        .filter((name) => typeof name === 'string' && name);
}

function reasoningClusterSummary(discovery, reasoningClusterId) {
    const selected = discovery?.selectedCluster;
    if (selected
        && (!reasoningClusterId || selected.clusterId === reasoningClusterId)
        && (selected.oldestEntryDate || selected.newestEntryDate || selected.entryDateSpanDays !== null && selected.entryDateSpanDays !== undefined)) {
        return selected;
    }
    const clusters = Array.isArray(discovery?.clusters) ? discovery.clusters : [];
    return clusters.find((cluster) => cluster?.clusterId === reasoningClusterId) || null;
}

/**
 * Builds the conclusion contract for a run.
 *
 * @param {object} input - `{ coverage, discovery, analyses, entries, rerankedRetrieval, envBudgetCap }`.
 *   `entries` must be the SELECTED-CASE docket entries (the evidence package's
 *   cluster-scoped `entries` array, already filtered by construction); each
 *   entry carries a structural publish date (`date`, never LLM-guessed) and
 *   analyses link back via integer `sourceEntryIndex` positions into it.
 * @returns {{ analysisStatus, supported, blocked, blockingEvidence, degraded, corpus }}
 */
function buildScopeContract(input = {}) {
    const coverage = input.coverage || {};
    const discovery = input.discovery || {};
    const analyses = Array.isArray(input.analyses) ? input.analyses : [];
    const rerankedRetrieval = input.rerankedRetrieval || null;

    const analyzed = Number.isFinite(coverage.analyzed) ? coverage.analyzed : analyses.length;
    const failed = Number.isFinite(coverage.failed) ? coverage.failed : 0;
    const total = Number.isFinite(coverage.total) ? coverage.total : analyses.length + failed;
    const totalClaims = Number.isFinite(coverage.totalClaims) ? coverage.totalClaims : 0;

    const rawEntryCount = discovery.rawEntryCount ?? null;
    const totalResults = discovery.totalResults ?? null;
    const reasoningClusterId = discovery.reasoningClusterId || discovery.recommendedPrimaryClusterId || null;
    const cluster = reasoningClusterId ? reasoningClusterSummary(discovery, reasoningClusterId) : null;
    const coverageLedger = discovery.coverageLedger && typeof discovery.coverageLedger === 'object'
        ? discovery.coverageLedger
        : null;

    const supported = [];
    const blocked = [];
    const blockingEvidence = [];
    const degraded = [];

    const block = (category, reason, evidence) => {
        blocked.push(category);
        blockingEvidence.push({ category, reason, evidence: evidence ?? null });
    };

    if (analyzed === 0) {
        for (const category of CONCLUSION_CATEGORIES) {
            block(category, 'no-analyzed-documents', { analyzed, failed, total });
        }
        return {
            analysisStatus: 'discovery_only',
            supported,
            blocked,
            blockingEvidence,
            degraded,
            corpus: corpusSnapshot({ analyzed, failed, total, rawEntryCount, totalResults, reasoningClusterId, cluster, coverageLedger })
        };
    }

    supported.push('docket_timeline');
    evaluateCurrentProceduralStatus({ entries: input.entries, analyses }, block, supported);
    if (totalClaims > 0) {
        supported.push('documented_claims');
    } else {
        block('documented_claims', 'no-extracted-claims', { analyzed, totalClaims });
    }

    // Full-outcome gate: every blocker is named. Order is deterministic.
    const fullOutcomeBlockers = [];
    if (failed > 0) {
        fullOutcomeBlockers.push({
            reason: 'failed-documents',
            evidence: { files: failedFileNames(coverage) }
        });
    }
    if (totalResults !== null && rawEntryCount !== null && rawEntryCount < totalResults) {
        fullOutcomeBlockers.push({
            reason: 'partial-corpus',
            evidence: { capturedEntries: rawEntryCount, totalResults }
        });
    }
    const names = analyzedFileNames(analyses);
    if (!names.some(isLedgerFileName)) {
        fullOutcomeBlockers.push({
            reason: 'no-final-distribution-statement',
            evidence: { searched: 'distribution / final-account filings (diobeni popis, završni račun)', analyzedDocuments: names.length }
        });
    }
    if (fullOutcomeBlockers.length > 0) {
        for (const blocker of fullOutcomeBlockers) {
            block('full_case_outcome', blocker.reason, blocker.evidence);
        }
    } else {
        supported.push('full_case_outcome');
    }

    // Degraded conditions: facts about run quality, never verdicts.
    const rerankStatus = rerankedRetrieval?.rerankStatus || null;
    const rerankReason = rerankedRetrieval?.metrics?.rerankReason || null;
    if (rerankStatus === 'fallback') {
        degraded.push({ condition: 'rerank-fallback', reason: rerankReason || 'lexical retrieval served the run' });
    }
    if (input.envBudgetCap === true) {
        degraded.push({ condition: 'env-budget-cap', reason: 'ANALYSIS_SCRAPE_LIMIT tightened the discovery budget below the depth dial' });
    }

    return {
        analysisStatus: blocked.length === 0 ? 'sufficient' : 'partial',
        supported,
        blocked: [...new Set(blocked)],
        blockingEvidence,
        degraded,
        corpus: corpusSnapshot({ analyzed, failed, total, rawEntryCount, totalResults, reasoningClusterId, cluster, coverageLedger })
    };
}

function entryFileNames(entry) {
    const links = Array.isArray(entry?.documentLinks) ? entry.documentLinks : [];
    return links
        .map((link) => link?.text)
        .filter((text) => typeof text === 'string' && text.trim());
}

function entryRef(entry, position) {
    return {
        sourceEntryIndex: Number.isInteger(entry?.index) ? entry.index : position,
        date: entry?.date || null,
        fileNames: entryFileNames(entry)
    };
}

function isoDay(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Current-procedural-status gate (spec §4.1): supported only when the newest
 * relevant selected-case docket entry has a successful analysis and no later
 * selected-case document is missing or failed. Pure docket-entry chronology
 * plus explicit `sourceEntryIndex` provenance — no wall-clock date, no model
 * calls, and the backend query type never enters this decision (conclusion
 * categories stay independent of query classification).
 *
 * Ordering rules, all deterministic:
 * - entries arrive cluster-scoped from the evidence package; dates are the
 *   structural publish dates, never LLM-extracted `decisionDate`s;
 * - a newest-date tie requires EVERY tied entry to be analyzed;
 * - undated entries cannot be ordered, so an unanalyzed undated entry is
 *   treated as potentially-later evidence (`newer-evidence-unavailable`);
 * - older missing/failed documents do not block current status on their own —
 *   they already block `full_case_outcome` via `failed-documents`;
 * - legacy inputs without entry chronology or without any integer
 *   `sourceEntryIndex` linkage degrade to `newer-evidence-unavailable`
 *   instead of asserting support without evidence.
 */
function evaluateCurrentProceduralStatus({ entries, analyses }, block, supported) {
    const list = Array.isArray(entries) ? entries : [];
    const analyzedIndexes = new Set();
    let hasIndexProvenance = false;
    for (const analysis of (Array.isArray(analyses) ? analyses : [])) {
        if (Number.isInteger(analysis?.sourceEntryIndex)) {
            hasIndexProvenance = true;
            analyzedIndexes.add(analysis.sourceEntryIndex);
        }
    }

    if (list.length === 0 || !hasIndexProvenance) {
        block('current_procedural_status', 'newer-evidence-unavailable', {
            unverifiableProvenance: true,
            entriesAvailable: list.length,
            indexedAnalyses: analyzedIndexes.size
        });
        return;
    }

    const dated = [];
    const undated = [];
    list.forEach((entry, position) => {
        const timestamp = parseCaseDateToTimestamp(entry?.date);
        (timestamp === null ? undated : dated).push({ entry, position, timestamp });
    });

    if (dated.length > 0) {
        const newestTimestamp = Math.max(...dated.map((item) => item.timestamp));
        const newest = dated.filter((item) => item.timestamp === newestTimestamp);
        const uncovered = newest.filter((item) => {
            const key = Number.isInteger(item.entry?.index) ? item.entry.index : item.position;
            return !analyzedIndexes.has(key);
        });
        if (uncovered.length > 0) {
            block('current_procedural_status', 'latest-entry-not-analyzed', {
                newestEntryDate: isoDay(newestTimestamp),
                uncoveredEntries: uncovered.map((item) => entryRef(item.entry, item.position)),
                analyzedNewestEntries: newest.length - uncovered.length,
                newestEntries: newest.length
            });
            return;
        }
    }

    const undatedUncovered = undated.filter((item) => {
        const key = Number.isInteger(item.entry?.index) ? item.entry.index : item.position;
        return !analyzedIndexes.has(key);
    });
    if (undatedUncovered.length > 0) {
        const analyzedTimestamps = dated
            .filter((item) => {
                const key = Number.isInteger(item.entry?.index) ? item.entry.index : item.position;
                return analyzedIndexes.has(key);
            })
            .map((item) => item.timestamp);
        block('current_procedural_status', 'newer-evidence-unavailable', {
            undatedEntries: undatedUncovered.map((item) => entryRef(item.entry, item.position)),
            newestAnalyzedEntryDate: analyzedTimestamps.length > 0 ? isoDay(Math.max(...analyzedTimestamps)) : null
        });
        return;
    }

    supported.push('current_procedural_status');
}

function corpusSnapshot({ analyzed, failed, total, rawEntryCount, totalResults, reasoningClusterId, cluster, coverageLedger }) {
    return {
        analyzed,
        failed,
        total,
        capturedEntries: rawEntryCount,
        totalResults,
        selectedCase: reasoningClusterId,
        dateRange: cluster
            ? { oldestEntryDate: cluster.oldestEntryDate || null, newestEntryDate: cluster.newestEntryDate || null, spanDays: cluster.entryDateSpanDays ?? null }
            : null,
        coverageLedger: coverageLedger || null
    };
}

module.exports = {
    buildScopeContract,
    CONCLUSION_CATEGORIES,
    LEDGER_FILENAME_KEYWORDS
};
