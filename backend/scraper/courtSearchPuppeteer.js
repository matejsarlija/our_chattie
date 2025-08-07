// courtSearchPuppeteer.js
require('dotenv').config();
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

class CourtSearchPuppeteer {
    constructor() {
        this.baseUrl = 'https://e-oglasna.pravosudje.hr';
        this.browser = null;
        this.page = null;
    }

    async init() {
        try {
            const launchOptions = {
                headless: process.env.NODE_ENV === 'production',
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
     * @returns {Promise<Array<object>>}
     */
    async parseSearchResults() {
        try {
            console.log('[parseSearchResults] Waiting for results to appear...');
            await this.page.waitForSelector('li.item.row', { timeout: 15000 });
            const results = await this.page.evaluate(() => {
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
                return items;
            });
            console.log(`[parseSearchResults] Parsed ${results.length} results from the page.`);
            return results;
        } catch (error) {
            console.warn('[parseSearchResults] Could not find or parse search results on the page.', error.message);
            try {
                await this.page.screenshot({ path: `error-parseSearchResults-${Date.now()}.png` });
                console.log('[parseSearchResults] Debug screenshot saved');
            } catch (screenshotError) {
                console.error('[parseSearchResults] Could not save screenshot:', screenshotError.message);
            }
            return [];
        }
    }

    // --- HIGH-LEVEL ORCHESTRATOR FOR YOUR PIPELINE ---

    /**
     * This method efficiently finds the first searchresult that has a direct document download link and returns it.
     * @param {string} searchTerm
     * @returns {Promise<{caseInfo: object, documentLinks: Array<object>} | null>}
     */
    async searchAndGetFirstCaseWithDocuments(searchTerm) {
        console.log('[searchAndGetFirstCaseWithDocuments] Starting search...');
        await this.performSearch(searchTerm);
        const allResults = await this.parseSearchResults();

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
     * The new primary method for the analysis pipeline. It finds the latest N cases
     * that have direct document download links.
     * @param {string} searchTerm
     * @param {number} limit - The number of cases to return.
     * @returns {Promise<Array<{caseInfo: object, documentLinks: Array<object>}>>}
     */
    async searchAndGetLatestCasesWithDocuments(searchTerm, limit = 2) {
        console.log('[searchAndGetLatestCasesWithDocuments] Starting search...');
        await this.performSearch(searchTerm);
        const allResults = await this.parseSearchResults();

        if (allResults.length === 0) {
            console.warn('[searchAndGetLatestCasesWithDocuments] Search yielded no results.');
            return [];
        }

        // Filter for results that actually have a download link
        const resultsWithDocs = allResults.filter(r => r.documentDownloadLink);

        if (resultsWithDocs.length === 0) {
            console.warn('[searchAndGetLatestCasesWithDocuments] Searched all results, but none had a direct document download button.');
            return [];
        }

        console.log(`[searchAndGetLatestCasesWithDocuments] Success! Found ${resultsWithDocs.length} case(s) with direct download links.`);

        // Take the most recent ones from the top of the list, up to the limit
        const limitedResults = resultsWithDocs.slice(0, limit);
        console.log(`[searchAndGetLatestCasesWithDocuments] Processing the latest ${limitedResults.length} case(s).`);

        // Map them to the format your pipeline expects
        return limitedResults.map(caseInfo => ({
            caseInfo,
            documentLinks: [{
                url: caseInfo.documentDownloadLink,
                // Make the text more descriptive for the user
                text: caseInfo.documentLinkText || `Dokumenti za ${caseInfo.caseNumber}`
            }]
        }));
    }
}

module.exports = CourtSearchPuppeteer;