// courtSearchPuppeteer.js
require('dotenv').config();
const { normalizeCaseNumber } = require('../court-analysis/utils/caseNumber');
const {
    COURT_ENTRIES_PER_PAGE,
    SCAN_DEPTH_MAX_ENTRIES
} = require('../court-analysis/utils/scanDepth');
let puppeteer;

if (process.env.NODE_ENV === 'production' || process.env.BROWSERLESS_TOKEN) {
    puppeteer = require('puppeteer-core');
} else {
    try {
        puppeteer = require('puppeteer');
    } catch (err) {
        console.error('Puppeteer not found. Install it with: npm install puppeteer');
        throw err;
    }
}

function resolveMaxPagesScanned() {
    const raw = Number.parseInt(process.env.DISCOVERY_MAX_PAGES_SCANNED, 10);
    return Number.isFinite(raw) && raw >= 1 ? raw : 5;
}

// Hard page budget for `full` depth, derived from the shared 400-court-entry
// ceiling and the confirmed 10-court-entries-per-page density. Bounding the
// page walk is a genuine safety cap: a mis-parsed hasNextPage or a huge
// text-query result set must not crawl unbounded pages while holding the
// concurrency-1 analysis queue.
function resolveFullScanMaxPages() {
    const raw = Number.parseInt(process.env.FULL_SCAN_MAX_PAGES, 10);
    if (Number.isFinite(raw) && raw >= 1) return Math.floor(raw);
    return Math.ceil(SCAN_DEPTH_MAX_ENTRIES / COURT_ENTRIES_PER_PAGE);
}

// Tail sampling: when a case has more history than the forward scan window
// covers, walk backward from the last page and keep the oldest entries so the
// analysis gets "origin" context (initial filings, opening rulings, intro docs).
// The last page is often partial (e.g. page 39 of 39 may hold a single entry),
// so we accumulate across up to TAIL_SAMPLE_MAX_PAGES until we reach
// TAIL_SAMPLE_ENTRIES instead of assuming the last page is full.
const TAIL_SAMPLE_ENTRIES = 10;
const TAIL_SAMPLE_MAX_PAGES = 2;

class CourtSearchPuppeteer {
    constructor() {
        this.baseUrl = 'https://e-oglasna.pravosudje.hr';
        this.browser = null;
        this.page = null;
    }

    async init() {
        try {
            const launchOptions = {
                // Headful by default in local dev so operators can watch runs;
                // production and explicit PUPPETEER_HEADLESS=1 (scripts/CI,
                // displayless hosts) run headless while keeping the local
                // puppeteer.launch transport.
                headless: process.env.NODE_ENV === 'production' || process.env.PUPPETEER_HEADLESS === '1',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            };

            if (process.env.NODE_ENV === 'production' || process.env.BROWSERLESS_TOKEN) {
                this.browser = await puppeteer.connect({
                    browserWSEndpoint: `wss://production-ams.browserless.io/?token=${process.env.BROWSERLESS_TOKEN}`,
                    ignoreHTTPSErrors: true
                });
            } else {
                this.browser = await puppeteer.launch(launchOptions);
            }

            this.page = await this.browser.newPage();

            // Enhanced request handling
            if (process.env.NODE_ENV !== 'production') {
                await this.page.setRequestInterception(true);
                this.page.on('request', (request) => {
                    // Block unnecessary resources to speed up loading
                    if (['image', 'stylesheet', 'font'].includes(request.resourceType())) {
                        request.abort();
                    } else {
                        console.log('Request:', request.url());
                        request.continue();
                    }
                });

                this.page.on('requestfailed', (request) => {
                    console.error('Request failed:', request.url(), request.failure()?.errorText);
                });

                // Add response monitoring
                this.page.on('response', (response) => {
                    if (!response.ok() && response.url().includes('e-oglasna')) {
                        console.error('HTTP Error:', response.url(), response.status());
                    }
                });
            }

            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'hr-HR,hr;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            });
            await this.page.setViewport({ width: 1366, height: 768 });

            // Set longer default timeouts
            this.page.setDefaultTimeout(60000);
            this.page.setDefaultNavigationTimeout(90000);

        } catch (err) {
            console.error('Failed to initialize Puppeteer:', err);
            throw err;
        }
    }
    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    // --- LOW-LEVEL AND HELPER METHODS ---

    normalizeSearchMetadata(rawSearchMetadata, rawParsedEntryCount) {
        const totalResults = Number.isFinite(rawSearchMetadata?.totalResults)
            ? rawSearchMetadata.totalResults
            : null;
        const totalPages = Number.isFinite(rawSearchMetadata?.totalPages)
            ? rawSearchMetadata.totalPages
            : null;
        const currentPage = Number.isFinite(rawSearchMetadata?.currentPage)
            ? rawSearchMetadata.currentPage
            : 1;
        const hasNextPage = typeof rawSearchMetadata?.hasNextPage === 'boolean'
            ? rawSearchMetadata.hasNextPage
            : (totalPages !== null ? currentPage < totalPages : false);

        return {
            discoveryMode: 'search-window',
            acquisitionModes: ['search-window'],
            searchWindows: [
                {
                    mode: 'search-window',
                    currentPage,
                    pagesScanned: 1,
                    hasNextPage,
                    rawParsedEntryCount
                }
            ],
            totalResults,
            totalPages,
            pagesScanned: 1,
            currentPage,
            hasNextPage,
            rawParsedEntryCount
        };
    }

    buildSearchResultsUrl(searchTerm, page) {
        const params = new URLSearchParams({
            text: searchTerm,
            page: String(page),
            sort: 'datePublished,desc',
            _g: 'null'
        });
        return `${this.baseUrl}/objave?${params.toString()}`;
    }

    async navigateToSearchResultsPage(searchTerm, page) {
        const url = this.buildSearchResultsUrl(searchTerm, page);
        console.log(`[navigateToSearchResultsPage] Navigating to page ${page}: ${url}`);
        await this.page.goto(url, {
            waitUntil: 'networkidle0',
            timeout: 90000
        });

        try {
            await this.page.waitForSelector('li.item.row', { visible: true, timeout: 30000 });
        } catch (err) {
            // Graceful fallback: allow the caller to decide whether the page is empty.
            console.warn(`[navigateToSearchResultsPage] No result items found on page ${page}.`, err.message);
        }
    }

    /**
     * Aggregates per-page search metadata from a multi-page crawl into a single
     * normalized discovery metadata block. Each page becomes its own entry in
     * `searchWindows`, while the top-level fields (pagesScanned/currentPage/
     * hasNextPage) describe the FORWARD window only — tail-sample pages are
     * listed in `searchWindows` and counted in `tailPagesScanned` so they never
     * distort the forward frontier reported to discovery heuristics and the UI.
     */
    aggregateSearchWindows(pageMetadataList, totalRawCount) {
        const pages = Array.isArray(pageMetadataList) ? pageMetadataList : [];
        const forwardPages = pages.filter((page) => page.tailWindow !== true);
        const tailPages = pages.filter((page) => page.tailWindow === true);
        const forward = forwardPages[forwardPages.length - 1] || pages[pages.length - 1] || {};
        const pagesScanned = forwardPages.length || 1;

        const aggregated = {
            discoveryMode: 'search-window',
            acquisitionModes: tailPages.length > 0
                ? ['search-window', 'search-window-tail']
                : ['search-window'],
            searchWindows: pages.map((page, index) => ({
                mode: page.tailWindow ? 'search-window-tail' : 'search-window',
                currentPage: page.currentPage ?? index + 1,
                pagesScanned: 1,
                hasNextPage: Boolean(page.hasNextPage),
                rawParsedEntryCount: page.rawParsedEntryCount ?? null
            })),
            totalResults: forward.totalResults ?? null,
            totalPages: forward.totalPages ?? null,
            pagesScanned,
            currentPage: forward.currentPage ?? 1,
            hasNextPage: forward.hasNextPage ?? false,
            rawParsedEntryCount: totalRawCount
        };
        if (tailPages.length > 0) {
            aggregated.tailPagesScanned = tailPages.length;
        }
        return aggregated;
    }

    async performSearchAcrossPages(searchTerm, maxPages = null, options = {}) {
        // `Infinity` (full depth) scans every page until the result set runs out,
        // bounded by FULL_SCAN_MAX_PAGES; `null` falls back to the
        // DISCOVERY_MAX_PAGES_SCANNED default window.
        const limit = maxPages === Infinity
            ? Infinity
            : (Number.isFinite(maxPages) ? Math.max(1, maxPages) : resolveMaxPagesScanned());
        const pageBudget = limit === Infinity ? resolveFullScanMaxPages() : limit;
        console.log(`[performSearchAcrossPages] Searching for "${searchTerm}" across up to ${limit === Infinity ? `all (cap ${pageBudget})` : limit} page(s)...`);

        await this.performSearch(searchTerm);
        const firstPage = await this.parseSearchResultsPage();

        const allResults = [...(firstPage.results || [])];
        const pageMetadataList = [firstPage.searchMetadata];

        let currentPage = firstPage.searchMetadata.currentPage || 1;
        let hasNextPage = firstPage.searchMetadata.hasNextPage || false;

        while (hasNextPage && pageMetadataList.length < pageBudget) {
            const nextPage = currentPage + 1;
            await this.navigateToSearchResultsPage(searchTerm, nextPage);
            const parsed = await this.parseSearchResultsPage();
            const results = parsed.results || [];

            pageMetadataList.push(parsed.searchMetadata);
            allResults.push(...results);

            currentPage = parsed.searchMetadata.currentPage || nextPage;
            hasNextPage = parsed.searchMetadata.hasNextPage || false;

            if (results.length === 0) break;
        }

        // The ceiling fired only when the site still reports more pages but the
        // full-scan budget is exhausted. Surface it so reports can be honest
        // about "Sve dostupne" having stopped at the cap.
        const fullScanCapped = limit === Infinity && hasNextPage && pageMetadataList.length >= pageBudget;

        let searchMetadata = this.aggregateSearchWindows(pageMetadataList, allResults.length);

        // Grab the oldest entries of the case (tail) so long histories get their
        // origin context. Only fires when the forward window didn't already cover
        // the full result set.
        const tail = await this.performTailSample(searchTerm, searchMetadata, options);
        if (tail.results.length > 0) {
            allResults.push(...tail.results);
            pageMetadataList.push(...tail.windows);
            searchMetadata = this.aggregateSearchWindows(pageMetadataList, allResults.length);
        }
        searchMetadata.tailSampling = tail.summary;
        if (fullScanCapped) {
            searchMetadata.fullScanCapped = true;
        }

        return { results: allResults, searchMetadata };
    }

    /**
     * Walks backward from the last result page, accumulating entries until
     * TAIL_SAMPLE_ENTRIES oldest entries are captured (or TAIL_SAMPLE_MAX_PAGES
     * are visited). Handles partial last pages by continuing to the previous
     * page instead of assuming the last page holds a full batch.
     */
    async performTailSample(searchTerm, searchMetadata, options = {}) {
        const enabled = options.tailSample === true;
        const totalPages = Number.isFinite(searchMetadata?.totalPages) ? searchMetadata.totalPages : null;
        const pagesScanned = Number.isFinite(searchMetadata?.pagesScanned) ? searchMetadata.pagesScanned : 0;

        if (!enabled || totalPages === null) {
            return { results: [], windows: [], summary: { enabled: false } };
        }
        if (totalPages <= pagesScanned) {
            return {
                results: [],
                windows: [],
                summary: { enabled: true, reason: 'window-fully-scanned', entriesKept: 0, pages: 0 }
            };
        }

        const accumulated = [];
        const windows = [];
        let page = totalPages;

        while (accumulated.length < TAIL_SAMPLE_ENTRIES
            && page > pagesScanned
            && windows.length < TAIL_SAMPLE_MAX_PAGES) {
            await this.navigateToSearchResultsPage(searchTerm, page);
            const parsed = await this.parseSearchResultsPage();
            const pageResults = parsed.results || [];
            const pageMetadata = parsed.searchMetadata || {};

            pageMetadata.tailWindow = true;
            for (const item of pageResults) {
                item.acquisition = {
                    mode: 'search-window-tail',
                    currentPage: Number.isFinite(pageMetadata.currentPage) ? pageMetadata.currentPage : page,
                    sampling: 'tail'
                };
            }

            accumulated.push(...pageResults);
            windows.push(pageMetadata);
            page -= 1;

            if (pageResults.length === 0) break;
        }

        // `accumulated` is oldest-first (highest page first). Keep the oldest
        // TAIL_SAMPLE_ENTRIES, then reverse so the overall result list stays in
        // descending recency order after being appended to the forward window.
        const kept = accumulated.slice(0, TAIL_SAMPLE_ENTRIES).reverse();

        return {
            results: kept,
            windows,
            summary: {
                enabled: true,
                entriesCollected: accumulated.length,
                entriesKept: kept.length,
                // Downstream doc-link filtering can drop kept entries, so report
                // how many of the kept ones actually carry a download link.
                entriesKeptWithDocuments: kept.filter((item) => Boolean(item.documentDownloadLink)).length,
                pages: windows.length
            }
        };
    }

    mapSearchResultsToPipelineEntries(results, searchMetadata, limit = null) {
        const normalizedLimit = Number.isFinite(limit) ? Math.max(0, limit) : null;

        // Numeric limits truncate the forward window only; tail-sample entries
        // are the whole point of balanced depth and always survive.
        let effectiveResults = results;
        if (normalizedLimit !== null) {
            const forward = results.filter((r) => r.acquisition?.mode !== 'search-window-tail');
            const tail = results.filter((r) => r.acquisition?.mode === 'search-window-tail');
            effectiveResults = [...forward.slice(0, normalizedLimit), ...tail];
        }

        return effectiveResults.map((caseInfo) => ({
            caseInfo,
            acquisition: caseInfo.acquisition || {
                mode: 'search-window',
                currentPage: searchMetadata.currentPage || 1
            },
            documentLinks: caseInfo.documentDownloadLink
                ? [{
                    url: caseInfo.documentDownloadLink,
                    text: caseInfo.documentLinkText || `Dokumenti za ${caseInfo.caseNumber}`
                }]
                : []
        }));
    }

    async performSearch(searchTerm) {
        if (!searchTerm) throw new Error('No search term provided');
        console.log(`[performSearch] Performing search for: ${searchTerm}`);

        // Navigate and wait for the page to be fully loaded
        try {
            console.log('[performSearch] Loading search page...');
            await this.page.goto(this.baseUrl, {
                waitUntil: 'networkidle0', // Wait until network is completely idle
                timeout: 90000
            });
            console.log('[performSearch] Page loaded successfully');
        } catch (error) {
            console.error('[performSearch] Navigation failed:', error.message);
            throw new Error(`Cannot reach ${this.baseUrl}: ${error.message}`);
        }

        try {
            // Wait for search form to be ready
            console.log('[performSearch] Waiting for search form...');
            await this.page.waitForSelector('#mainSearchInput', {
                visible: true,
                timeout: 15000
            });

            // Wait for the form to be interactive (not disabled)
            await this.page.waitForFunction(() => {
                const input = document.querySelector('#mainSearchInput');
                return input && !input.disabled && !input.readOnly;
            }, { timeout: 10000 });

            // Clear and enter search term
            console.log('[performSearch] Entering search term...');
            await this.page.click('#mainSearchInput', { clickCount: 3 }); // Select all
            await this.page.type('#mainSearchInput', searchTerm);

            // Wait for any auto-complete or validation to complete
            await this.page.waitForFunction((term) => {
                const input = document.querySelector('#mainSearchInput');
                return input && input.value === term;
            }, {}, searchTerm);

            // Ensure submit button is ready
            await this.page.waitForSelector('button[type="submit"]', {
                visible: true,
                timeout: 10000
            });

            await this.page.waitForFunction(() => {
                const button = document.querySelector('button[type="submit"]');
                return button && !button.disabled;
            }, { timeout: 5000 });

            console.log('[performSearch] Submitting form...');

            // Method 1: Try navigation with button click
            try {
                const navigationPromise = this.page.waitForNavigation({
                    waitUntil: 'domcontentloaded',
                    timeout: 45000
                });

                await this.page.click('button[type="submit"]');
                await navigationPromise;

            } catch (navError) {
                console.log('[performSearch] Button click navigation failed, trying alternatives...');

                // Method 2: Try with Enter key
                try {
                    await this.page.focus('#mainSearchInput');
                    const navigationPromise = this.page.waitForNavigation({
                        waitUntil: 'domcontentloaded',
                        timeout: 45000
                    });

                    await this.page.keyboard.press('Enter');
                    await navigationPromise;

                } catch (enterError) {
                    console.log('[performSearch] Enter key failed, trying form submission...');

                    // Method 3: JavaScript form submission
                    await this.page.evaluate(() => {
                        const form = document.querySelector('#mainSearchInput').closest('form');
                        if (form) {
                            form.submit();
                        } else {
                            // If no form, try triggering search programmatically
                            const button = document.querySelector('button[type="submit"]');
                            if (button) {
                                button.click();
                            }
                        }
                    });

                    // Wait for URL change or content change
                    await this.page.waitForFunction(() => {
                        return window.location.href.includes('/objave') ||
                            window.location.search.includes('text=') ||
                            document.querySelector('li.item.row');
                    }, { timeout: 45000 });
                }
            }

            // Wait for search results to appear using multiple strategies
            console.log('[performSearch] Waiting for search results...');

            try {
                // Strategy 1: Wait for result items
                await this.page.waitForSelector('li.item.row', {
                    visible: true,
                    timeout: 30000
                });

            } catch (resultError) {
                // Strategy 2: Wait for any results container or "no results" message
                const resultSelectors = [
                    'li.item.row',
                    '.results-container',
                    '.search-results',
                    '[class*="result"]',
                    '.no-results',
                    '[class*="empty"]'
                ];

                let foundResults = false;
                for (const selector of resultSelectors) {
                    try {
                        await this.page.waitForSelector(selector, {
                            visible: true,
                            timeout: 5000
                        });
                        console.log(`[performSearch] Found content with selector: ${selector}`);
                        foundResults = true;
                        break;
                    } catch (e) {
                        continue;
                    }
                }

                if (!foundResults) {
                    // Strategy 3: Wait for page to stabilize after search
                    await this.page.waitForFunction(() => {
                        return document.readyState === 'complete' &&
                            !document.querySelector('.loading, .spinner, [class*="load"]');
                    }, { timeout: 15000 });

                    // Check if we have any content that looks like results
                    const hasContent = await this.page.evaluate(() => {
                        const content = document.body.textContent.toLowerCase();
                        return content.includes('rezultat') ||
                            content.includes('objav') ||
                            content.includes('pretraga') ||
                            document.querySelector('li.item, .result, .case');
                    });

                    if (!hasContent) {
                        throw new Error('No search results or content found');
                    }
                }
            }

            console.log('[performSearch] Search completed successfully');

            // Verify we're on the results page
            const currentUrl = this.page.url();
            console.log('[performSearch] Final URL:', currentUrl);

            if (!currentUrl.includes('/objave') && !currentUrl.includes('text=')) {
                console.warn('[performSearch] Warning: URL doesn\'t look like a results page');
            }

        } catch (error) {
            console.error(`[performSearch] Search failed for "${searchTerm}":`, error.message);
            console.error('[performSearch] Current URL:', this.page.url());

            // Enhanced debugging
            try {
                const pageTitle = await this.page.title();
                const pageUrl = this.page.url();

                console.log('[performSearch] Page title:', pageTitle);
                console.log('[performSearch] Current URL:', pageUrl);

                // Check form state
                const formState = await this.page.evaluate(() => {
                    const input = document.querySelector('#mainSearchInput');
                    const button = document.querySelector('button[type="submit"]');
                    return {
                        inputExists: !!input,
                        inputValue: input?.value || 'N/A',
                        inputDisabled: input?.disabled || false,
                        buttonExists: !!button,
                        buttonDisabled: button?.disabled || false,
                        formExists: !!input?.closest('form')
                    };
                });

                console.log('[performSearch] Form state:', formState);

                // Save screenshot
                await this.page.screenshot({
                    path: `error-search-${searchTerm}-${Date.now()}.png`,
                    fullPage: true
                });
                console.log('[performSearch] Debug screenshot saved');

            } catch (debugError) {
                console.error('[performSearch] Debug info collection failed:', debugError.message);
            }

            throw error;
        }
    }


    /**
     * Parses all search results from the current page, now including the direct document link.
     * This is the most efficient approach.
     * @returns {Promise<{results: Array<object>, searchMetadata: object}>}
     */
    async parseSearchResultsPage() {
        try {
            console.log('[parseSearchResults] Waiting for results to appear...');
            await this.page.waitForSelector('li.item.row', { timeout: 15000 });
            const pagePayload = await this.page.evaluate(() => {
                const items = [];
                document.querySelectorAll('li.item.row').forEach(element => {
                    const titleEl = element.querySelector('a[href*="/objave/"][target="_blank"]');
                    if (!titleEl) return; // Skip if there's no main title/link

                    const caseEl = element.querySelector('a[href*="text="]');
                    let courtEl = null;
                    const courtDivs = element.querySelectorAll('div small');
                    for (const small of courtDivs) {
                        if (small.textContent.trim() === 'Sud') {
                            courtEl = small.parentElement.querySelector('a span');
                            break;
                        }
                    }
                    const dateEl = element.querySelector('.m-date');

                    // --- THIS IS THE KEY CHANGE BASED ON YOUR FINDING ---
                    // Find the direct document download link on the search result item itself.
                    //const docLinkEl = element.querySelector('a[href*="/dokumenti/preuzimanje"]');

                    // was brittle, new version is more robust
                    const docLinkEl = element.querySelector('a[href$="/preuzimanje"]');


                    // --- START: Participant Extraction Logic (NEW) ---
                    const participants = [];
                    // Find the container for participants. Based on the HTML, it's a div with a child <small> tag 'Sudionici'.
                    // Then we find all 'd-block' divs inside which represent each participant.
                    let participantContainer = null;
                    element.querySelectorAll('small.text-muted.d-block').forEach(small => {
                        if (small.textContent.trim() === 'Sudionici') {
                            participantContainer = small.parentElement;
                        }
                    });

                    if (participantContainer) {
                        participantContainer.querySelectorAll('.d-block').forEach(block => {
                            const nameEl = block.querySelector('span:not(.badge)'); // The name is in a span without a badge class
                            if (nameEl && nameEl.textContent.trim()) {
                                // Based on the HTML, data-original-title is a reliable selector
                                const oibEl = block.querySelector('small[data-original-title="OIB"]');
                                const addressEl = block.querySelector('small[data-original-title="Adresa"]');
                                const roleEl = block.querySelector('span.badge-info'); // Role seems to be in a 'badge-info' span

                                // Clean the text, removing the superscript labels like 'OIB' and 'ADRESA'
                                const oibText = oibEl ? oibEl.textContent.replace('OIB', '').trim() : 'N/A';
                                const addressText = addressEl ? addressEl.textContent.replace('ADRESA', '').trim() : 'N/A';

                                participants.push({
                                    name: nameEl.textContent.trim(),
                                    oib: oibText,
                                    address: addressText,
                                    role: roleEl ? roleEl.textContent.trim() : 'N/A'
                                });
                            }
                        });
                    }
                    // --- END: Participant Extraction Logic ---

                    items.push({
                        title: titleEl.textContent.trim(),
                        detailLink: titleEl.href,
                        caseNumber: caseEl ? caseEl.textContent.trim() : 'N/A',
                        court: courtEl ? courtEl.textContent.trim() : 'N/A',
                        date: dateEl ? dateEl.textContent.trim() : 'N/A',
                        // Add the direct link if it exists, otherwise null.
                        documentDownloadLink: docLinkEl ? new URL(docLinkEl.href, window.location.origin).href : null,
                        // *** THE KEY FIX: Get the ACTUAL link text ***
                        documentLinkText: docLinkEl ? docLinkEl.textContent.trim() : null,
                        participants: participants // Add the new participants array
                    });
                });

                const parseFirstInteger = (text) => {
                    if (!text) return null;
                    const match = text.match(/(\d[\d.\s]*)/);
                    if (!match) return null;
                    return Number.parseInt(match[1].replace(/[.\s]/g, ''), 10);
                };

                const currentPageFromUrl = Number.parseInt(new URL(window.location.href).searchParams.get('page') || '1', 10);
                const activePageEl = document.querySelector('.pagination .active, .paginationjs .active, .page-item.active');
                const currentPage = parseFirstInteger(activePageEl?.textContent) || currentPageFromUrl || 1;

                let totalPages = null;
                const pageCandidates = Array.from(
                    document.querySelectorAll('.pagination a, .pagination button, .paginationjs-pages a, .paginationjs-pages li')
                )
                    .map(el => parseFirstInteger(el.textContent))
                    .filter(value => Number.isFinite(value));
                if (pageCandidates.length > 0) {
                    totalPages = Math.max(...pageCandidates);
                }

                let hasNextPage = false;
                const nextPageEl = Array.from(document.querySelectorAll('a, button')).find((el) => {
                    const text = (el.textContent || '').trim().toLowerCase();
                    return text === 'sljedeća' || text === 'next' || text === '>';
                });
                if (nextPageEl) {
                    const disabled = nextPageEl.hasAttribute('disabled')
                        || nextPageEl.getAttribute('aria-disabled') === 'true'
                        || nextPageEl.classList.contains('disabled')
                        || nextPageEl.parentElement?.classList?.contains('disabled');
                    hasNextPage = !disabled;
                } else if (totalPages !== null) {
                    hasNextPage = currentPage < totalPages;
                }

                const bodyText = document.body?.textContent || '';
                const resultCountCandidates = [
                    bodyText.match(/ukupno\s+(\d[\d.\s]*)\s+rezultata/i),
                    bodyText.match(/pronađeno\s+(\d[\d.\s]*)\s+rezultata/i),
                    bodyText.match(/(\d[\d.\s]*)\s+rezultata/i)
                ]
                    .filter(Boolean)
                    .map(match => Number.parseInt(match[1].replace(/[.\s]/g, ''), 10))
                    .filter(value => Number.isFinite(value));
                const totalResults = resultCountCandidates.length > 0 ? resultCountCandidates[0] : null;

                return {
                    items,
                    searchMetadata: {
                        totalResults,
                        totalPages,
                        currentPage,
                        hasNextPage
                    }
                };
            });

            const rawItems = Array.isArray(pagePayload) ? pagePayload : (Array.isArray(pagePayload?.items) ? pagePayload.items : []);
            const rawSearchMetadata = Array.isArray(pagePayload) ? {} : (pagePayload?.searchMetadata || {});

            // Normalize case numbers immediately after extraction
            rawItems.forEach(item => {
                const normalized = normalizeCaseNumber(item.caseNumber);
                if (normalized) {
                    item.caseNumber = normalized;
                }
                item.acquisition = {
                    mode: 'search-window',
                    currentPage: Number.isFinite(rawSearchMetadata?.currentPage) ? rawSearchMetadata.currentPage : 1
                };
            });

            const searchMetadata = this.normalizeSearchMetadata(rawSearchMetadata, rawItems.length);

            console.log(`[parseSearchResults] Parsed ${rawItems.length} results from the page.`);
            return {
                results: rawItems,
                searchMetadata
            };
        } catch (error) {
            console.warn('[parseSearchResults] Could not find or parse search results on the page.', error.message);
            try {
                await this.page.screenshot({ path: `error-parseSearchResults-${Date.now()}.png` });
                console.log('[parseSearchResults] Debug screenshot saved');
            } catch (screenshotError) {
                console.error('[parseSearchResults] Could not save screenshot:', screenshotError.message);
            }
            return {
                results: [],
                searchMetadata: this.normalizeSearchMetadata({}, 0)
            };
        }
    }

    async parseSearchResults() {
        const parsed = await this.parseSearchResultsPage();
        return parsed.results;
    }

    // --- HIGH-LEVEL ORCHESTRATOR FOR YOUR PIPELINE ---

    /**
     * This method efficiently finds the first searchresult that has a direct document download link and returns it.
     * @param {string} searchTerm
     * @returns {Promise<{caseInfo: object, documentLinks: Array<object>} | null>}
     */
    /**
     * Case-number follow-up search (cluster expansion strategy
     * `case-number-follow-up-search`): search the e-Oglasna window by the
     * cluster's case number and keep entries that match the normalized lineage.
     * Only entries belonging to the requested case number are returned so the
     * pipeline's cluster-scoped contract is preserved.
     */
    async searchCaseNumberFollowUp(caseNumber, options = {}) {
        const pass = options.pass ?? 1;
        const strategy = options.strategy || 'case-number-follow-up-search';
        const reason = options.reason || null;
        const maxPages = options.maxPages ?? 1;
        const normalized = normalizeCaseNumber(caseNumber);

        console.log(`[searchCaseNumberFollowUp] Searching follow-up for case number "${caseNumber}" (pass ${pass})...`);
        const { results: allResults, searchMetadata } = await this.performSearchAcrossPages(caseNumber, maxPages);

        const matched = allResults.filter(r => normalizeCaseNumber(r.caseNumber) === normalized);
        const entries = matched.map(r => ({
            caseInfo: { ...r },
            acquisition: {
                mode: 'cluster-expansion',
                sourceCaseNumber: normalized,
                currentPage: r.acquisition?.currentPage ?? null,
                pass,
                strategy,
                reason
            },
            documentLinks: r.documentDownloadLink
                ? [{ url: r.documentDownloadLink, text: r.documentLinkText || `Dokumenti za ${normalized}` }]
                : []
        }));

        console.log(`[searchCaseNumberFollowUp] Found ${entries.length} matching entrie(s) for case ${caseNumber}.`);
        return { entries, searchMetadata, strategy, reason, pass };
    }

    async parseDetailPage(detailLink) {
        try {
            await this.page.goto(detailLink, {
                waitUntil: 'networkidle0',
                timeout: 90000
            });

            const data = await this.page.evaluate(() => {
                const docs = [];
                document.querySelectorAll('a[href*="/preuzimanje"]').forEach(a => {
                    docs.push({
                        url: new URL(a.href, window.location.origin).href,
                        text: (a.textContent || '').trim() || 'Dokument'
                    });
                });

                const relatedCaseNumbers = [];
                document.querySelectorAll('a[href*="text="]').forEach(a => {
                    const text = (a.textContent || '').trim();
                    if (text && !relatedCaseNumbers.includes(text)) relatedCaseNumbers.push(text);
                });

                const titleEl = document.querySelector('h1, .title, [class*="title"]');
                return {
                    docs,
                    relatedCaseNumbers,
                    title: titleEl ? titleEl.textContent.trim() : null
                };
            });

            return { detailLink, title: data.title, documentLinks: data.docs };
        } catch (err) {
            console.warn('[parseDetailPage] Failed to parse detail page:', detailLink, err.message);
            return null;
        }
    }

    /**
     * Detail-link follow-up (cluster expansion strategy `detail-link-follow-up`):
     * visit each primary-cluster detail link and harvest any additional document
     * download links that are not exposed on the search result row.
     */
    async followDetailLinks(detailLinks, options = {}) {
        const pass = options.pass ?? 1;
        const strategy = options.strategy || 'detail-link-follow-up';
        const reason = options.reason || null;
        const links = (Array.isArray(detailLinks) ? detailLinks : []).filter(Boolean);

        const entries = [];
        for (const link of links) {
            const parsed = await this.parseDetailPage(link);
            if (!parsed) continue;
            if (!Array.isArray(parsed.documentLinks) || parsed.documentLinks.length === 0) continue;

            entries.push({
                caseInfo: {
                    title: parsed.title || 'Detalj objave',
                    detailLink: link,
                    // A detail page does not repeat the case number reliably.
                    // Preserve the originating cluster so the pipeline can add
                    // documents harvested exclusively from this page.
                    caseNumber: options.sourceCaseNumber || 'N/A',
                    court: 'N/A',
                    date: 'N/A',
                    participants: []
                },
                acquisition: {
                    mode: 'cluster-expansion',
                    sourceCaseNumber: options.sourceCaseNumber || null,
                    currentPage: null,
                    pass,
                    strategy,
                    reason,
                    detailLink: link
                },
                documentLinks: parsed.documentLinks
            });
        }

        console.log(`[followDetailLinks] Harvested ${entries.length} detail entrie(s) across ${links.length} link(s).`);
        return { entries, strategy, reason, pass };
    }

    async searchAndGetFirstCaseWithDocuments(searchTerm) {
        console.log('[searchAndGetFirstCaseWithDocuments] Starting search...');
        await this.performSearch(searchTerm);
        const { results: allResults } = await this.parseSearchResultsPage();

        if (allResults.length === 0) {
            console.warn('[searchAndGetFirstCaseWithDocuments] Search yielded no results.');
            return null;
        }

        // --- NEW, SIMPLIFIED LOGIC ---
        // Find the first result that has the direct download link we just parsed.
        const firstWithDocs = allResults.find(r => r.documentDownloadLink);

        if (firstWithDocs) {
            console.log(`[searchAndGetFirstCaseWithDocuments] Success! Found direct download link for case: ${firstWithDocs.title}`);
            // Return the case info and a documentLinks array formatted for your pipeline.
            // This link typically points to a ZIP file with all documents.
            return {
                caseInfo: firstWithDocs,
                documentLinks: [{
                    url: firstWithDocs.documentDownloadLink,
                    text: firstWithDocs.documentLinkText || 'Preuzimanje dokumenta'
                }]
            };
        }

        console.warn('[searchAndGetFirstCaseWithDocuments] Searched all results, but none had a direct document download button.');
        return null;
    }

    /**
     * The new primary method for the analysis pipeline. It finds the latest N court entries
     * that have direct document download links.
     * @param {string} searchTerm
     * @param {number|null} limit - The number of court entries to return. A null limit
     *  captures the full scanned window (full document history).
     * @param {number|null} maxPages
     * @param {boolean} tailSample
     * @param {string|null} debtorOib - Accepted only for signature parity with the CSV
     *  client; it is intentionally ignored here because Puppeteer has no reliable
     *  per-entry debtor-OIB field.
     * @returns {Promise<{ casesToProcess: Array<object>, discoveryMetadata: object }>}
     */
    async searchAndGetLatestCasesWithDocuments(searchTerm, limit = 2, maxPages = null, tailSample = false, debtorOib = null) {
        console.log('[searchAndGetLatestCasesWithDocuments] Starting search...');
        const { results: allResults, searchMetadata } = await this.performSearchAcrossPages(searchTerm, maxPages, { tailSample });

        if (allResults.length === 0) {
            console.warn('[searchAndGetLatestCasesWithDocuments] Search yielded no results.');
            return {
                casesToProcess: [],
                discoveryMetadata: searchMetadata
            };
        }

        // Filter for results that actually have a download link
        const resultsWithDocs = allResults.filter(r => r.documentDownloadLink);

        if (resultsWithDocs.length === 0) {
            console.warn('[searchAndGetLatestCasesWithDocuments] Searched all results, but none had a direct document download button.');
            return {
                casesToProcess: [],
                discoveryMetadata: searchMetadata
            };
        }

        console.log(`[searchAndGetLatestCasesWithDocuments] Success! Found ${resultsWithDocs.length} case(s) with direct download links across ${searchMetadata.pagesScanned} page(s).`);

        // Take the most recent ones from the top of the list, up to the limit.
        // A null limit (Track 3b full document history) captures the entire
        // scanned window instead of truncating to the top-N. Numeric limits
        // truncate the forward window only — tail entries always survive.
        const limitedResults = limit == null
            ? resultsWithDocs
            : [
                ...resultsWithDocs.filter((r) => r.acquisition?.mode !== 'search-window-tail').slice(0, limit),
                ...resultsWithDocs.filter((r) => r.acquisition?.mode === 'search-window-tail')
            ];
        console.log(`[searchAndGetLatestCasesWithDocuments] Processing the latest ${limitedResults.length} case(s).`);

        // Map them to the format your pipeline expects
        return {
            casesToProcess: this.mapSearchResultsToPipelineEntries(limitedResults, searchMetadata),
            discoveryMetadata: searchMetadata
        };
    }

    async searchAndGetLatestCases(searchTerm, limit = null, maxPages = null, tailSample = false, debtorOib = null) {
        // Accepted only for signature parity with the CSV client; it is
        // intentionally ignored because Puppeteer has no reliable per-entry
        // debtor-OIB field.
        void debtorOib;
        console.log('[searchAndGetLatestCases] Starting search...');
        const { results: allResults, searchMetadata } = await this.performSearchAcrossPages(searchTerm, maxPages, { tailSample });

        if (allResults.length === 0) {
            console.warn('[searchAndGetLatestCases] Search yielded no results.');
            return {
                casesToProcess: [],
                discoveryMetadata: searchMetadata
            };
        }

        return {
            casesToProcess: this.mapSearchResultsToPipelineEntries(allResults, searchMetadata, limit),
            discoveryMetadata: searchMetadata
        };
    }
}

module.exports = CourtSearchPuppeteer;
