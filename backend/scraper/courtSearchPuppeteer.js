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
                    text: firstWithDocs.documentLinkText || 'Preuzimanje dokumenta'
                }]
            };
        }

        console.warn('Searched all results, but none had a direct document download button.');
        return null;
    }
}

module.exports = CourtSearchPuppeteer;