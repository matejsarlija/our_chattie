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

    // --- LOW-LEVEL AND HELPER METHODS ---

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

    /**
     * Parses all search results from the current page, now including the direct document link.
     * This is the most efficient approach.
     * @returns {Promise<Array<object>>}
     */
    async parseSearchResults() {
        try {
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
                    const docLinkEl = element.querySelector('a[href*="/dokumenti/preuzimanje"]');

                    items.push({
                        title: titleEl.textContent.trim(),
                        detailLink: titleEl.href,
                        caseNumber: caseEl ? caseEl.textContent.trim() : 'N/A',
                        court: courtEl ? courtEl.textContent.trim() : 'N/A',
                        date: dateEl ? dateEl.textContent.trim() : 'N/A',
                        // Add the direct link if it exists, otherwise null.
                        documentDownloadLink: docLinkEl ? new URL(docLinkEl.href, window.location.origin).href : null
                    });
                });
                return items;
            });
            console.log(`Parsed ${results.length} results from the page.`);
            return results;
        } catch (error) {
            console.warn('Could not find or parse search results on the page.', error.message);
            await this.page.screenshot({ path: `error-parseSearchResults-${Date.now()}.png` });
            return [];
        }
    }

    // --- HIGH-LEVEL ORCHESTRATOR FOR YOUR PIPELINE ---

    /**
     * The primary method for your analysis pipeline. It efficiently finds the first search
     * result that has a direct document download link and returns it.
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

        // --- NEW, SIMPLIFIED LOGIC ---
        // Find the first result that has the direct download link we just parsed.
        const firstWithDocs = allResults.find(r => r.documentDownloadLink);

        if (firstWithDocs) {
            console.log(`Success! Found direct download link for case: ${firstWithDocs.title}`);
            // Return the case info and a documentLinks array formatted for your pipeline.
            // This link typically points to a ZIP file with all documents.
            return {
                caseInfo: firstWithDocs,
                documentLinks: [{
                    url: firstWithDocs.documentDownloadLink,
                    text: 'Dokumenti objave (ZIP)'
                }]
            };
        }

        console.warn('Searched all results, but none had a direct document download button.');
        return null;
    }
}

module.exports = CourtSearchPuppeteer;