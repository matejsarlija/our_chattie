// scraper/discoveryClient.js
//
// Resolves the discovery client for an analysis run. Three modes (spec §8):
//   csv       -> CsvExportClient only (browser-free); failures surface as errors
//   puppeteer -> CourtSearchPuppeteer only (current crawl path)
//   auto      -> CsvExportClient with automatic Puppeteer fallback on any CSV
//                failure (network/http/empty/schema-drift). Rollout default.
//
// `CourtSearchPuppeteer` is lazy-required so importing this module does not
// force the browser stack into CSV-only unit tests.

const { CsvExportClient, CsvExportError } = require('./csvExportClient');

const ALLOWED_SOURCES = new Set(['csv', 'puppeteer', 'auto']);

function resolveDiscoverySource(options = {}) {
    const explicit = options.discoverySource;
    if (explicit && ALLOWED_SOURCES.has(explicit)) {
        return explicit;
    }
    const env = process.env.DISCOVERY_SOURCE;
    if (env && ALLOWED_SOURCES.has(env)) {
        return env;
    }
    return 'auto';
}

function createPuppeteerClient() {
    // Lazy require: keeps the browser stack out of CSV-only paths/tests.
    const CourtSearchPuppeteer = require('./courtSearchPuppeteer');
    return new CourtSearchPuppeteer();
}

class AutoDiscoveryClient {
    constructor(options = {}) {
        this.options = options;
        this.csvClient = new CsvExportClient(options.csv || {});
        this.puppeteerClient = null;
        this.usingPuppeteer = false;
        this.fallbackReason = null;
    }

    async init() {
        // CSV needs no init; the Puppeteer fallback initializes lazily on demand.
    }

    async close() {
        if (this.puppeteerClient) {
            await this.puppeteerClient.close();
            this.puppeteerClient = null;
        }
    }

    async _run(method, args) {
        try {
            return await this.csvClient[method](...args);
        } catch (err) {
            if (!(err instanceof CsvExportError)) {
                throw err;
            }

            this.fallbackReason = err.reason;
            this.usingPuppeteer = true;
            console.warn(`[discovery] CSV export failed (${err.reason}), falling back to Puppeteer: ${err.message}`);

            if (!this.puppeteerClient) {
                this.puppeteerClient = createPuppeteerClient();
                await this.puppeteerClient.init();
            }

            const result = await this.puppeteerClient[method](...args);
            if (result && result.discoveryMetadata) {
                result.discoveryMetadata.csvFallback = {
                    reason: err.reason,
                    missingColumns: (err.detail && err.detail.missingColumns) || null
                };
            }
            return result;
        }
    }

    searchAndGetLatestCasesWithDocuments(searchTerm, limit, maxPages, tailSample, debtorOib) {
        return this._run('searchAndGetLatestCasesWithDocuments', [searchTerm, limit, maxPages, tailSample, debtorOib]);
    }

    searchAndGetLatestCases(searchTerm, limit, maxPages, tailSample, debtorOib) {
        return this._run('searchAndGetLatestCases', [searchTerm, limit, maxPages, tailSample, debtorOib]);
    }

    // Cluster-expansion follow-ups delegate to the Puppeteer client when the
    // fallback engaged; otherwise (CSV success) they return empty so the
    // deterministic expansion path no-ops under complete coverage.
    async searchCaseNumberFollowUp(caseNumber, options = {}) {
        if (!this.puppeteerClient) {
            return { entries: [], searchMetadata: null, strategy: options.strategy, reason: options.reason, pass: options.pass ?? 1 };
        }
        return this.puppeteerClient.searchCaseNumberFollowUp(caseNumber, options);
    }

    async followDetailLinks(detailLinks, options = {}) {
        if (!this.puppeteerClient) {
            return { entries: [], strategy: options.strategy, reason: options.reason, pass: options.pass ?? 1 };
        }
        return this.puppeteerClient.followDetailLinks(detailLinks, options);
    }
}

function createDiscoveryClient(options = {}) {
    const source = resolveDiscoverySource(options);
    if (source === 'csv') {
        return new CsvExportClient(options.csv || {});
    }
    if (source === 'puppeteer') {
        return createPuppeteerClient();
    }
    return new AutoDiscoveryClient(options);
}

module.exports = {
    createDiscoveryClient,
    resolveDiscoverySource,
    AutoDiscoveryClient,
    CsvExportError
};
