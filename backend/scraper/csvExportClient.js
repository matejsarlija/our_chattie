// scraper/csvExportClient.js
//
// Browser-free discovery client: fetches the e-Oglasna "Izvoz podataka" CSV
// export and returns the same `{ casesToProcess, discoveryMetadata }` contract
// as `CourtSearchPuppeteer.searchAndGetLatestCases*`. Because the export is the
// COMPLETE result set, the client replaces the paginated crawl, tail sampling,
// and cluster-expansion follow-ups with a single GET + parse.
//
// Bounding: the export can be far larger than the analysis budget, so the
// client applies scan-depth court-entry budgets. A finite `limit` is the total
// court-entry maximum; `maxPages === Infinity` maps full depth to the defensive
// 400-entry ceiling. `tailSample` reserves the oldest court entries within that
// maximum so balanced depth keeps its "origin context".
//
// Deliberately does NOT implement `searchCaseNumberFollowUp` / `followDetailLinks`
// so the deterministic cluster-expansion path (`executeClusterExpansionSearches`)
// no-ops: complete coverage removes the need to expand.

const axios = require('axios');
const { parseCsvExport } = require('./csvExportParser');
const { mapCsvRowsToEntries } = require('../court-analysis/utils/csvFieldMapping');
const {
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_STANDARD_ENTRIES,
    SCAN_DEPTH_TAIL_ENTRIES,
    SCAN_DEPTH_MAX_ENTRIES
} = require('../court-analysis/utils/scanDepth');

const BASE_URL = 'https://e-oglasna.pravosudje.hr';
const EXPORT_PATH = '/objave/izvoz/csv';

class CsvExportError extends Error {
    constructor(reason, message, detail = null) {
        super(message);
        this.name = 'CsvExportError';
        this.reason = reason; // 'http' | 'network' | 'empty' | 'schema-drift'
        this.detail = detail;
    }
}

async function defaultFetcher(url) {
    const response = await axios.get(url, {
        responseType: 'text',
        timeout: 60000
    });
    return String(response.data || '');
}

/**
 * Resolves the maximum number of court entries to return. A finite `limit`
 * always controls this total outright. Without it, the page budget (or the
 * default standard entry count) is expanded by the tail allowance when a tail
 * is requested, so balanced mode naturally yields at most 30 newest plus 10
 * oldest court entries.
 */
function computeCourtEntryCap(limit, maxPages, tailSample = false) {
    if (Number.isFinite(limit)) {
        return Math.max(0, Math.floor(limit));
    }
    if (maxPages === Infinity) {
        return SCAN_DEPTH_MAX_ENTRIES;
    }

    const pages = Number.isFinite(maxPages) && maxPages >= 1
        ? Math.max(1, Math.floor(maxPages))
        : Math.ceil(SCAN_DEPTH_STANDARD_ENTRIES / COURT_ENTRIES_PER_PAGE);
    return pages * COURT_ENTRIES_PER_PAGE + (tailSample ? SCAN_DEPTH_TAIL_ENTRIES : 0);
}

/**
 * Applies the court-entry budget to export rows that are already ordered from
 * newest to oldest. The tail is reserved within that budget, and the oldest
 * entries used for the tail are disjoint from the forward slice, so inputs at
 * or under the budget are returned unchanged and require no separate tail step.
 */
function applyBounding(entries, limit, maxPages, tailSample = false) {
    const courtEntries = Array.isArray(entries) ? entries : [];
    const cap = computeCourtEntryCap(limit, maxPages, tailSample);
    if (courtEntries.length <= cap) {
        return courtEntries;
    }

    const tailCourtEntries = tailSample && cap > SCAN_DEPTH_TAIL_ENTRIES
        ? SCAN_DEPTH_TAIL_ENTRIES
        : 0;
    const forwardCourtEntries = courtEntries.slice(0, cap - tailCourtEntries);
    if (tailCourtEntries === 0) {
        return forwardCourtEntries;
    }

    const oldestCourtEntries = courtEntries
        .slice(-tailCourtEntries)
        .map((entry) => ({
            ...entry,
            acquisition: { ...(entry.acquisition || {}), sampling: 'tail' }
        }));

    return [...forwardCourtEntries, ...oldestCourtEntries];
}

/**
 * For OIB queries only, narrows the export to court entries whose CSV-provided
 * debtor OIB matches the queried debtor OIB. This intentionally runs before the
 * document-link and court-entry-count steps.
 */
function applyDebtorOibFilter(entries, debtorOib) {
    const queriedDebtorOib = String(debtorOib ?? '').trim();
    if (!queriedDebtorOib) {
        return entries;
    }
    return entries.filter((entry) => (
        String(entry?.caseInfo?.debtorOib ?? '').trim() === queriedDebtorOib
    ));
}

class CsvExportClient {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || BASE_URL;
        this.fetcher = options.fetcher || defaultFetcher;
    }

    // Browser lifecycle no-ops: satisfies the pipeline's init/close call sites.
    async init() {}
    async close() {}

    buildExportUrl(searchTerm) {
        const params = new URLSearchParams({ text: searchTerm, sort: 'datePublished,desc' });
        return `${this.baseUrl}${EXPORT_PATH}?${params.toString()}`;
    }

    /**
     * Fetches the export and returns the RAW header-keyed rows (no pipeline
     * entry mapping, no bounding). The single-GET export IS the complete
     * result set, so this is inherently a full scan — the change-detection
     * check path uses it to guarantee complete snapshots (spec §4.3).
     */
    async fetchRawRows(searchTerm) {
        const exportUrl = this.buildExportUrl(searchTerm);
        let body;
        try {
            body = await this.fetcher(exportUrl);
        } catch (err) {
            const status = err?.response?.status || err?.status || null;
            throw new CsvExportError(
                status ? 'http' : 'network',
                `CSV export fetch failed for "${searchTerm}": ${err.message}`,
                { status }
            );
        }

        const parsed = parseCsvExport(body);
        if (!parsed.ok) {
            throw new CsvExportError(
                parsed.reason === 'empty' ? 'empty' : 'schema-drift',
                `CSV export parse failed for "${searchTerm}": ${parsed.reason}`,
                { missingColumns: parsed.missingColumns }
            );
        }

        return {
            exportUrl,
            rowCount: parsed.rows.length,
            fetchedAt: new Date().toISOString(),
            rows: parsed.rows
        };
    }

    async fetchExport(searchTerm) {
        const { rows, ...fetchInfo } = await this.fetchRawRows(searchTerm);
        return {
            ...fetchInfo,
            entries: mapCsvRowsToEntries(rows)
        };
    }

    buildDiscoveryMetadata(fetchInfo, boundedCount) {
        return {
            discoveryMode: 'csv-export',
            acquisitionModes: ['csv-export'],
            searchWindows: [],
            totalResults: fetchInfo.rowCount,
            totalPages: 1,
            pagesScanned: 1,
            currentPage: 1,
            hasNextPage: false,
            // The number of entries actually handed to the pipeline (post-bound),
            // mirroring the scraper's page-window-bounded raw parsed count while
            // `totalResults` reports the complete export size.
            rawParsedEntryCount: boundedCount,
            csv: {
                exportUrl: fetchInfo.exportUrl,
                requestedSort: 'datePublished,desc',
                rowCount: fetchInfo.rowCount,
                fetchedAt: fetchInfo.fetchedAt
            }
        };
    }

    async searchAndGetLatestCasesWithDocuments(searchTerm, limit = null, maxPages = null, tailSample = false, debtorOib = null) {
        const { entries, ...fetchInfo } = await this.fetchExport(searchTerm);
        const identityMatching = applyDebtorOibFilter(entries, debtorOib);
        const withDocuments = identityMatching.filter((entry) => entry.caseInfo.documentDownloadLink);
        const bounded = applyBounding(withDocuments, limit, maxPages, tailSample);

        return {
            casesToProcess: bounded,
            discoveryMetadata: this.buildDiscoveryMetadata(fetchInfo, bounded.length)
        };
    }

    async searchAndGetLatestCases(searchTerm, limit = null, maxPages = null, tailSample = false, debtorOib = null) {
        const { entries, ...fetchInfo } = await this.fetchExport(searchTerm);
        const identityMatching = applyDebtorOibFilter(entries, debtorOib);
        const bounded = applyBounding(identityMatching, limit, maxPages, tailSample);

        return {
            casesToProcess: bounded,
            discoveryMetadata: this.buildDiscoveryMetadata(fetchInfo, bounded.length)
        };
    }
}

module.exports = {
    CsvExportClient,
    CsvExportError,
    computeCourtEntryCap,
    applyBounding,
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_TAIL_ENTRIES,
    defaultFetcher
};
