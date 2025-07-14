# Court Analysis Backend Implementation TODO (Current)

## Current Folder & File Structure
```
backend/
├── chatAgent.js
├── court-analysis/
│   ├── agents/
│   │   ├── analysis-agent.js   # LangChain Tool, Gemini LLM
│   │   └── download-agent.js   # LangChain Tool, downloads files
│   ├── pipeline.js             # Orchestrates: Scraper → Download → Analyze, cleans up temp files
│   └── utils/
│       ├── browserless-client.js
│       ├── file-helpers.js
│       ├── progress-tracker.js
│       └── rateLimiter.js      # Token bucket rate limiter middleware
├── helpers/
│   └── helpers.js
├── scraper/
│   └── courtSearchPuppeteer.js # Puppeteer scraper (Browserless ready)
├── server.js                   # Express API, SSE, rate limiting
├── uploads/                    # Temp downloaded files
├── package.json
└── .env
```

## Current Architecture Overview
- **API Layer**: Express server with `/api/court-analysis` endpoint, SSE for progress, and custom token bucket rate limiting (1000/hour, 5/5s per client).
- **Scraper**: Puppeteer-based, connects to Browserless, fetches and parses court search results.
- **Pipeline**: Orchestrates the flow: Scraper → Download Tool (LangChain) → Analysis Tool (LangChain, Gemini LLM). Cleans up temp files after use or error.
- **Download Agent**: LangChain Tool, downloads documents to `uploads/` and returns file info.
- **Analysis Agent**: LangChain Tool, uses Gemini (GoogleGenerativeAI) to extract structured info from PDFs.
- **Progress & Error Handling**: Each step emits progress updates and handles errors, streamed to the client. Errors are now more granular and propagated.
- **Rate Limiting**: Custom middleware enforces API usage limits and returns HTTP 429 with retry info.
- **Testing**: Tests exist for scraper, download agent, pipeline, and rate limiting (expand as needed).

## Updated TODOs

### 1. Robustness & Cleanup
- [x] Ensure all temp files are deleted after use, even on error.
- [x] Add more granular error messages and propagate to client.

### 2. LangChain/LangGraph Enhancements
- [x] Add support for more file types (DOCX, TXT) in analysis agent.

### 3. Testing & Documentation
- [x] Expand tests for:
  - Error and edge cases (network, LLM, file errors)
  - API route integration (SSE, rate limiting)
  - Batch/multi-case scenarios
- [x] Update and expand documentation for:
  - API endpoints and request/response formats
  - Environment variables and setup
  - Usage examples for devs and users

### 4. Observability & Security
- [ ] Add structured logging for all major actions and errors.
- [ ] Add authentication or API key protection if needed.

---

**The backend is now modular, observable, and ready for production with Gemini-powered analysis, robust rate limiting, and automatic temp file cleanup.**