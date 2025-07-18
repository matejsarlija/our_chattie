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
                headless: process.env.NODE_ENV === 'production', // Use true for production/headless
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            };

            if (process.env.NODE_ENV === 'production' || process.env.BROWSERLESS_TOKEN) {
                this.browser = await puppeteer.connect({
                    browserWSEndpoint: `wss://production-ams.browserless.io/?token=${process.env.BROWSERLESS_TOKEN}`
                });
            } else {
                this.browser = await puppeteer.launch(launchOptions);
            }
            this.page = await this.browser.newPage();
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
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

    // --- GENERAL-PURPOSE METHODS (KEPT FOR FLEXIBILITY) ---

    async searchByOIB(oib) {
        await this.performSearch(oib);
        return this.parseSearchResults();
    }

    async searchBySubjectName(name) {
        await this.performSearch(name);
        return this.parseSearchResults();
    }

    async searchByCaseNumber(caseNumber) {
        await this.performSearch(caseNumber);
        return this.parseSearchResults();
    }

    /**
     * The low-level search function. Navigates and executes a search.
     * @param {string} searchTerm
     */
    async performSearch(searchTerm) {
        if (!searchTerm) throw new Error('No search term provided');
        console.log(`Performing search for: ${searchTerm}`);
        try {
            await this.page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await this.page.waitForSelector('#mainSearchInput', { timeout: 10000 });
            await this.page.type('#mainSearchInput', searchTerm);

            await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
                this.page.click('button[type="submit"]')
            ]);
            console.log('Search submitted. Results page should be loaded.');
        } catch (error) {
            console.error(`Failed during performSearch for "${searchTerm}":`, error.message);
            await this.page.screenshot({ path: `error-performSearch-${Date.now()}.png` });
            throw error;
        }
    }

    // --- REUSABLE HELPER METHODS ---

    /**
     * Parses all search results from the current page.
     * @returns {Promise<Array<object>>}
     */
    async parseSearchResults() {
        try {
            await this.page.waitForSelector('li.item.row', { timeout: 15000 });
            const results = await this.page.evaluate(() => {
                const items = [];
                document.querySelectorAll('li.item.row').forEach(element => {
                    const titleEl = element.querySelector('a[href*="/objave/"][target="_blank"]');
                    const caseEl = element.querySelector('a[href*="text="]');
                    const courtEl = element.querySelector('a[href*="/objave-sudova/"]');
                    const dateEl = element.querySelector('.m-date');

                    if (titleEl && titleEl.href) { // A detail link is essential
                        items.push({
                            title: titleEl.textContent.trim(),
                            detailLink: titleEl.href,
                            caseNumber: caseEl ? caseEl.textContent.trim() : 'N/A',
                            court: courtEl ? courtEl.textContent.trim() : 'N/A',
                            date: dateEl ? dateEl.textContent.trim() : 'N/A'
                        });
                    }
                });
                return items;
            });
            console.log(`Parsed ${results.length} results from the page.`);
            return results;
        } catch (error) {
            console.warn('Could not find or parse search results on the page.', error.message);
            await this.page.screenshot({ path: `error-parseSearchResults-${Date.now()}.png` });
            return []; // Return empty array on failure
        }
    }

    /**
     * Navigates to a detail page URL and extracts all document download links.
     * @param {string} detailUrl
     * @returns {Promise<Array<{url: string, text: string}>>}
     */
    async extractDocumentLinksFromDetailPage(detailUrl) {
        console.log(`Navigating to detail page to find documents: ${detailUrl}`);
        try {
            await this.page.goto(detailUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            
            // Wait for the correct container element that holds all the documents.
            await this.page.waitForSelector('section#dokumenti', { timeout: 10000 });

            // Use the correct selectors to find all links inside that container.
            const documentLinks = await this.page.evaluate(() => {
                const links = [];
                // This selector finds ALL download links in the section (both the ZIP and individual files)
                document.querySelectorAll('section#dokumenti a[href*="/preuzimanje"]').forEach(link => {
                    links.push({
                        url: new URL(link.getAttribute('href'), window.location.origin).href,
                        text: link.textContent.trim().replace(/\s+/g, ' ')
                    });
                });
                return links;
            });

            console.log(`Found ${documentLinks.length} document links on the detail page.`);
            return documentLinks;
        } catch (error) {
            console.warn(`Failed to extract document links from ${detailUrl}:`, error.message);
            // This can fail if a page has no documents section, which is a valid scenario.
            // We return an empty array and let the orchestrator method decide what to do next.
            return [];
        }
    }

    // --- HIGH-LEVEL ORCHESTRATOR FOR YOUR PIPELINE ---

    /**
     * The primary method for your analysis pipeline. It finds the first search
     * result that contains downloadable documents and returns its info.
     * @param {string} searchTerm
     * @returns {Promise<{caseInfo: object, documentLinks: Array<object>} | null>}
     */
    async searchAndGetFirstCaseWithDocuments(searchTerm) {
        await this.performSearch(searchTerm);
        const allResults = await this.parseSearchResults();

        if (allResults.length === 0) {
            console.warn('Search yielded no results.');
            return null;
        }

        // Iterate through results to find the first one that has documents
        for (const caseInfo of allResults) {
            const documentLinks = await this.extractDocumentLinksFromDetailPage(caseInfo.detailLink);
            if (documentLinks.length > 0) {
                // Success! We found a case with documents.
                console.log(`Success! Found documents for case: ${caseInfo.title}`);
                return { caseInfo, documentLinks };
            }
            console.log(`Case "${caseInfo.title}" had no downloadable documents, trying next...`);
        }

        console.warn('Searched all results, but none had downloadable documents.');
        return null; // None of the results had documents
    }
}

module.exports = CourtSearchPuppeteer;