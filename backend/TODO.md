# Court Analysis Backend Implementation TODO (Simplified)

## File Structure
```
your-project/
├── server.js (modify existing)
├── chatAgent.js (unchanged)
├── package.json (update dependencies)
├── court-analysis/
│   ├── pipeline.js (LangGraph main orchestrator)
│   ├── agents/
│   │   ├── scraper-agent.js (Puppeteer-core + Browserless)
│   │   ├── download-agent.js (downloads documents)
│   │   └── analysis-agent.js (Gemini document analysis)
│   ├── utils/
│   │   ├── browserless-client.js (Browserless connection helper)
│   │   ├── file-helpers.js (File type detection, cleanup)
│   │   └── progress-tracker.js (Progress update utilities)
│   └── schemas/
│       └── state-schema.js (LangGraph state definition)
└── uploads/ (existing, for temporary files)
```

## Implementation Steps

### Phase 1: Setup & Dependencies
- [ ] **1.1** Update `package.json` dependencies
  ```bash
  npm install @langchain/langgraph puppeteer-core
  ```
- [ ] **1.2** Add Browserless.io token to `.env`
  ```
  BROWSERLESS_TOKEN=your_token_here
  ```
- [ ] **1.3** Create `court-analysis/` directory structure

### Phase 2: Core Infrastructure
- [ ] **2.1** Create `court-analysis/schemas/state-schema.js`
  - Define LangGraph state structure
  - Include: searchTerm, scrapedResults, downloadedFiles, analysis, progress
- [ ] **2.2** Create `court-analysis/utils/browserless-client.js`
  - Puppeteer-core connection to Browserless
  - Error handling and reconnection logic
- [ ] **2.3** Create `court-analysis/utils/progress-tracker.js`
  - Progress update utilities
  - Standardized progress message formats

### Phase 3: Individual Agents
- [ ] **3.1** Create `court-analysis/agents/scraper-agent.js`
  - Use puppeteer-core + Browserless to scrape/search
  - Return results as provided by the API (already sorted)
  - Add progress callbacks
- [ ] **3.2** Create `court-analysis/agents/download-agent.js`
  - Download documents to Google Drive or local storage
  - Handle different file types (PDF, DOC, archives)
  - Progress tracking for downloads
- [ ] **3.3** Create `court-analysis/agents/analysis-agent.js`
  - Analyze downloaded documents with Gemini
  - Extract key information (case details, dates, parties, etc.)
  - Generate structured summary

### Phase 4: LangGraph Pipeline
- [ ] **4.1** Create `court-analysis/pipeline.js`
  - Set up LangGraph StateGraph
  - Define agent flow: Scraper → Download → Analysis
  - Add error handling and recovery
  - Implement progress callbacks
- [ ] **4.2** Add pipeline orchestration
  - Handle agent failures gracefully
  - Implement timeout handling
  - Add cleanup for temporary files

### Phase 5: API Integration
- [ ] **5.1** Add new route to `server.js`
  - POST `/api/court-analysis` endpoint
  - Server-Sent Events (SSE) setup for progress updates
  - Input validation (searchTerm, searchType)
- [ ] **5.2** Integrate pipeline with API route
  - Call LangGraph pipeline
  - Stream progress updates
  - Return final results
- [ ] **5.3** Add error handling middleware
  - Catch pipeline errors
  - Clean up resources on failure
  - Return appropriate error responses

### Phase 6: Testing & Optimization
- [ ] **6.1** Create test cases
  - Test with known OIB numbers
  - Test with case numbers
  - Test error scenarios (no results, invalid input)
- [ ] **6.2** Add logging
  - Log pipeline execution steps
  - Log performance metrics
  - Log errors with context
- [ ] **6.3** Performance optimization
  - Implement request caching (optional)
  - Add connection pooling for Browserless
  - Optimize file handling

### Phase 7: Production Readiness
- [ ] **7.1** Add rate limiting for new endpoint
  - Separate rate limits for court analysis
  - Consider longer execution times
- [ ] **7.2** Environment configuration
  - Add production vs development settings
  - Configure timeouts and limits
- [ ] **7.3** Documentation
  - API endpoint documentation
  - Error response codes
  - Usage examples

## Key Implementation Notes

- **No filter agent is needed**: The API/search already returns sorted results. The pipeline can take the first (most recent) or all results as needed.
- **Pipeline is now:** Scraper → Download → Analysis.
- **Simpler state and flow**: Remove any fields or logic related to filtering/most recent selection.

## Dependencies to Add
```json
{
  "@langchain/langgraph": "^0.0.x",
  "puppeteer-core": "^21.x.x"
}
```

## Environment Variables
```bash
# Add to .env
BROWSERLESS_TOKEN=your_browserless_token
COURT_ANALYSIS_TIMEOUT=300000  # 5 minutes
MAX_CONCURRENT_ANALYSES=3
```

## Example: Puppeteer + Browserless Scraping Logic

Here is a sample class for scraping the latest court result with documents using puppeteer-core and Browserless:

```javascript
const puppeteer = require('puppeteer-core');

class CourtSearchBrowserless {
  constructor(wsEndpoint) {
    this.wsEndpoint = wsEndpoint;
    this.browser = null;
    this.page = null;
    this.baseUrl = 'https://e-oglasna.pravosudje.hr';
  }

  async init() {
    this.browser = await puppeteer.connect({ browserWSEndpoint: this.wsEndpoint });
    this.page = await this.browser.newPage();

    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await this.page.setViewport({ width: 1366, height: 768 });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async searchLatestWithDocument(searchTerm) {
    await this.page.goto(this.baseUrl, { waitUntil: 'networkidle2', timeout: 30000 });

    await this.page.waitForSelector('#mainSearchInput', { timeout: 10000 });
    await this.page.type('#mainSearchInput', searchTerm);

    await Promise.all([
      this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
      this.page.click('button[type="submit"]')
    ]);

    // Extract only the latest result that has documents
    const latestResult = await this.page.evaluate(() => {
      const results = Array.from(document.querySelectorAll('.result-item, .objava-item, .search-result, [class*="result"], [class*="objava"]'));

      for (const element of results) {
        // Find document links in this result
        const docLinks = [];
        const docSelectors = [
          'a[href*="download"]',
          'a[href*="dokument"]',
          'a[href$=".pdf"]',
          'a[href$=".doc"]',
          'a[href$=".docx"]',
          '.dokument a',
          '.document a',
          '[class*="dokument"] a',
          '[class*="document"] a'
        ];

        for (const selector of docSelectors) {
          element.querySelectorAll(selector).forEach(docEl => {
            const href = docEl.href;
            if (href && !docLinks.includes(href)) {
              docLinks.push(href);
            }
          });
        }

        if (docLinks.length > 0) {
          return {
            title: element.querySelector('.title, .naslov, h3, h4, a')?.textContent.trim() || '',
            caseNumber: element.querySelector('.predmet, .case-number, [class*="predmet"]')?.textContent.trim() || '',
            court: element.querySelector('.sud, .court, [class*="sud"]')?.textContent.trim() || '',
            date: element.querySelector('.datum, .date, [class*="datum"]')?.textContent.trim() || '',
            documentLinks: docLinks,
            pageUrl: window.location.href
          };
        }
      }

      return null;
    });

    return latestResult;
  }
}

module.exports = CourtSearchBrowserless;

// Usage example (fill in your Browserless WS URL):
/*
(async () => {
  const wsUrl = 'wss://chrome.browserless.io?token=YOUR_TOKEN';
  const scraper = new CourtSearchBrowserless(wsUrl);

  await scraper.init();
  const latest = await scraper.searchLatestWithDocument('66124057408');
  console.log(latest);
  await scraper.close();
})();
*/
```

## Example: New API Route for Court Analysis

Add this route to your `server.js` to handle court analysis requests with SSE progress updates:

```javascript
// Add this to your existing server.js
app.post('/api/court-analysis', async (req, res) => {
  const { searchTerm, searchType } = req.body;
  
  // Set up SSE for progress updates
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  try {
    // Run LangGraph pipeline with progress callbacks
    const result = await runCourtAnalysisPipeline(searchTerm, (progress) => {
      res.write(`data: ${JSON.stringify(progress)}\n\n`);
    });
    
    res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
  }
  
  res.end();
});
```

## Example: Progress Updates Structure

You can use a standardized structure for progress updates:

```javascript
// Progress update types you can send
const progressTypes = {
  SCRAPING: { type: 'scraping', message: 'Searching court records...', progress: 20 },
  DOWNLOADING: { type: 'downloading', message: 'Downloading documents...', progress: 60 },
  ANALYZING: { type: 'analyzing', message: 'Analyzing case files...', progress: 80 },
  COMPLETE: { type: 'complete', message: 'Analysis complete!', progress: 100 }
};
```
