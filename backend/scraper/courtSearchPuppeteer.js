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
                    '--disable-gpu'
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

            // Only log requests in development
            if (process.env.NODE_ENV !== 'production') {
                await this.page.setRequestInterception(true);
                this.page.on('request', (request) => {
                    console.log('Request:', request.url());
                    request.continue();
                });

                this.page.on('requestfailed', (request) => {
                    console.error('Request failed:', request.url(), request.failure()?.errorText);
                });
            }

            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            await this.page.setExtraHTTPHeaders({
                'Accept-Language': 'en-US,en;q=0.9,hr;q=0.8'
            });
            await this.page.setViewport({ width: 1366, height: 768 });

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

        const maxRetries = 3;
        let lastError;

        // First, test basic connectivity
        try {
            console.log('[performSearch] Testing connectivity to target site...');
            const response = await this.page.goto(this.baseUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 90000
            });
            console.log(`[performSearch] Site loaded successfully. Status: ${response.status()}`);
        } catch (error) {
            console.error('[performSearch] Initial navigation failed:', error.message);

            // Try with even more lenient settings
            try {
                console.log('[performSearch] Retrying with minimal wait conditions...');
                await this.page.goto(this.baseUrl, {
                    waitUntil: 'commit',  // Most lenient option
                    timeout: 120000
                });
                // Give it extra time to load
                await this.page.waitForTimeout(5000);
            } catch (retryError) {
                console.error('[performSearch] All navigation attempts failed');
                throw new Error(`Cannot reach ${this.baseUrl}: ${retryError.message}`);
            }
        }

        try {
            console.log('[performSearch] Waiting for search input...');
            await this.page.waitForSelector('#mainSearchInput', { timeout: 15000 });

            console.log('[performSearch] Clearing and typing search term...');
            await this.page.click('#mainSearchInput', { clickCount: 3 }); // Select all
            await this.page.type('#mainSearchInput', searchTerm);

            console.log('[performSearch] Clicking submit button...');
            await this.page.click('button[type="submit"]');

            console.log('[performSearch] Waiting for results to appear...');
            await this.page.waitForSelector('li.item.row', { timeout: 60000 });

            console.log('[performSearch] Search results have appeared. Page is loaded.');

        } catch (error) {
            console.error(`[performSearch] Failed during search process for "${searchTerm}":`, error.message);
            console.error('[performSearch] Current URL:', this.page.url());

            // Take screenshot for debugging
            try {
                await this.page.screenshot({ path: `error-search-${Date.now()}.png` });
                console.log('[performSearch] Debug screenshot saved');
            } catch (screenshotError) {
                console.error('[performSearch] Could not save screenshot:', screenshotError.message);
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