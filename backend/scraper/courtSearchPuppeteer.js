require('dotenv').config();
let puppeteer;
if (process.env.BROWSERLESS_TOKEN) {
    puppeteer = require('puppeteer-core');
} else {
    puppeteer = require('puppeteer');
}

class CourtSearchPuppeteer {
    constructor() {
        this.baseUrl = 'https://e-oglasna.pravosudje.hr';
        this.browser = null;
        this.page = null;
    }

    async init() {
        try {
            if (process.env.BROWSERLESS_TOKEN) {
                this.browser = await puppeteer.connect({
                    browserWSEndpoint: `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_TOKEN}`
                });
            } else {
                this.browser = await puppeteer.launch({
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox']
                    // No executablePath needed for full puppeteer
                });
            }
            this.page = await this.browser.newPage();
            await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await this.page.setViewport({ width: 1366, height: 768 });
        } catch (err) {
            console.error('Failed to initialize Puppeteer:', err.message);
            throw err;
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
        }
    }

    async searchByOIB(oib) {
        return this.performSearch(oib);
    }

    async searchBySubjectName(name) {
        return this.performSearch(name);
    }

    async searchByCaseNumber(caseNumber) {
        return this.performSearch(caseNumber);
    }

    async performSearch(searchTerm) {
        if (!searchTerm) throw new Error('No search term provided');
        try {
            console.log(`Searching for: ${searchTerm}`);

            // Navigate to the homepage
            await this.page.goto(this.baseUrl, { 
                waitUntil: 'networkidle2',
                timeout: 30000 
            });

            // Wait for the search form to be visible
            await this.page.waitForSelector('#mainSearchInput', { timeout: 10000 });

            // Fill in the search term
            await this.page.type('#mainSearchInput', searchTerm);

            // Click the search button and wait for navigation
            await Promise.all([
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                this.page.click('button[type="submit"]')
            ]);

            console.log('Search submitted, parsing results...');

            // Wait a bit for results to load
            if (typeof this.page.waitForTimeout === 'function') {
                await this.page.waitForTimeout(2000);
            } else {
                await new Promise(r => setTimeout(r, 2000));
            }

            // Parse the results
            const results = await this.parseSearchResults(searchTerm);
            
            return results;

        } catch (error) {
            console.error('Search failed:', error.message);
            
            // Take a screenshot for debugging
            if (this.page) {
                await this.page.screenshot({ 
                    path: `error-${Date.now()}.png`,
                    fullPage: true 
                });
            }
            
            throw error;
        }
    }

    async parseSearchResults(searchTerm) {
        // Extract results from the page
        const results = await this.page.evaluate(() => {
            const resultElements = document.querySelectorAll('.result-item, .objava-item, .search-result, [class*="result"], [class*="objava"]');
            const parsed = [];

            resultElements.forEach(element => {
                const titleEl = element.querySelector('.title, .naslov, h3, h4, a');
                const caseEl = element.querySelector('.predmet, .case-number, [class*="predmet"]');
                const courtEl = element.querySelector('.sud, .court, [class*="sud"]');
                const dateEl = element.querySelector('.datum, .date, [class*="datum"]');
                const linkEl = element.querySelector('a');

                // Look for document download links within this result
                const documentLinks = [];
                
                // Check for various types of document links
                const docLinkSelectors = [
                    'a[href*="download"]',
                    'a[href*="dokument"]',
                    'a[href$=".pdf"]',
                    'a[href$=".doc"]', 
                    'a[href$=".docx"]',
                    'button[onclick*="download"]',
                    '.dokument a',
                    '.document a',
                    '[class*="dokument"] a',
                    '[class*="document"] a'
                ];

                docLinkSelectors.forEach(selector => {
                    const docElements = element.querySelectorAll(selector);
                    docElements.forEach(docEl => {
                        const url = docEl.href || (docEl.onclick ? docEl.onclick.toString() : '');
                        const text = docEl.textContent.trim();
                        
                        // Avoid duplicates
                        if (url && !documentLinks.some(dl => dl.url === url)) {
                            documentLinks.push({
                                text: text || 'Document',
                                url: url
                            });
                        }
                    });
                });

                const result = {
                    title: titleEl ? titleEl.textContent.trim() : '',
                    caseNumber: caseEl ? caseEl.textContent.trim() : '',
                    court: courtEl ? courtEl.textContent.trim() : '',
                    date: dateEl ? dateEl.textContent.trim() : '',
                    link: linkEl ? linkEl.href : '',
                    documentLinks: documentLinks,
                    hasDocuments: documentLinks.length > 0,
                    content: element.textContent.trim()
                };

                if (result.title || result.caseNumber || result.content) {
                    parsed.push(result);
                }
            });

            return parsed;
        });

        return { searchTerm, results };
    }

    // New: Get only the first result with documents
    async searchFirstWithDocuments(searchTerm) {
        const searchResults = await this.performSearch(searchTerm);
        if (!searchResults || !searchResults.results) return null;
        const firstWithDocs = searchResults.results.find(r => r.hasDocuments && r.documentLinks.length > 0);
        if (!firstWithDocs) {
            console.warn('No results with documents found for:', searchTerm);
            return null;
        }
        return firstWithDocs;
    }
}

// Usage example
async function example() {
    const automator = new CourtSearchPuppeteer();

    try {
        await automator.init();

        // Search by OIB
        const oibResults = await automator.searchByOIB('66124057408');
        console.log('OIB Search Results:');
        
        // Display results with document info
        oibResults.results.forEach((result, index) => {
            console.log(`\n--- Result ${index + 1} ---`);
            console.log(`Case: ${result.caseNumber || result.title}`);
            console.log(`Court: ${result.court}`);
            console.log(`Date: ${result.date}`);
            console.log(`Link: ${result.link}`);
            
            if (result.hasDocuments) {
                console.log(`Documents (${result.documentLinks.length}):`);
                result.documentLinks.forEach(doc => {
                    console.log(`  - ${doc.text}: ${doc.url}`);
                });
            } else {
                console.log('No documents found in search results');
            }
        });

        // Get details for the first result (TODO)

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await automator.close();
    }
}

// For monitoring (run separately)
async function startMonitoring() {
    const automator = new CourtSearchPuppeteer();
    await automator.init();

    const monitoring = await automator.monitorForNewCases('66124057408', [], 30); // Check every 30 minutes
    
    // Keep the process running
    process.on('SIGINT', async () => {
        monitoring.stop();
        await automator.close();
        process.exit();
    });
}

// Uncomment to run
//example();
// startMonitoring();

module.exports = CourtSearchPuppeteer;