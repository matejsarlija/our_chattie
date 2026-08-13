# Alimentacija.info - AI-Powered Court Entry Analyzer

This tool uses a Puppeteer scraper and Google's Gemini API to search, download, and analyze court entries from the official [e-Oglasna ploča](https://e-oglasna.pravosudje.hr/) (e-Bulletin Board).

It is a full-stack, single-tenant application: a user submits an OIB, case number, or free-text search, and the system runs a court-analysis pipeline that returns a structured report with a progress stream. Analysis runs and their events are persisted locally to JSON files on the backend — no database or user accounts are required.

It came about as I was trying to build a dataset of legal information in Croatian as a pretraining for an LLM, but noticed that Google has already scraped most of the threads, topics and webpages I was interested in, which led me to just use it as-is.

## About the project

Accessing and understanding court records is a challenging process for the average person. The official portal provides data but lacks analysis tools or any kind of insight. This project tries to address that by providing a "one-click" analysis pipeline.

Users can enter a person's ID (OIB), a case number, or free text, and the system will:
1.  Automate a browser to search the official court portal.
2.  Download the latest case documents (PDFs, DOCX, etc.).
3.  Extract the text, using OCR as a fallback for scanned documents.
4.  Send the text to the Google Gemini AI for summarization and structured data extraction.
5.  Present a clear, comparative analysis to the user.

The scraper part can be adapted reasonably well to any other country's court case website, or a database.

This project is GPLv3 licensed (LICENSE.md).

## Key Features

-   **Real-time Court Search:** Scrapes the official portal in real-time using a search term.
-   **Automated Document Processing:** Downloads, unzips, and extracts text from various document formats.
-   **AI-Powered Summarization:** Leverages the Google Gemini API to generate concise, human-readable summaries of complex legal texts in Croatian.
-   **Comparative Analysis:** Analyzes documents from multiple court entries for the same case to highlight progress and changes.
-   **Discovery + Reasoning:** The analysis pipeline first discovers case clusters from search metadata, then selects one cluster and generates one structured report for it.
-   **Analysis History:** Runs and their SSE events are persisted locally (JSON files); the Dashboard lists past runs and streams live progress on the detail page.

## Tech Stack

-   **Frontend:** React, Tailwind CSS, React Router, react-markdown, Mermaid
-   **Backend:** Node.js, Express.js
-   **Persistence:** Local JSON files (`backend/data/analysis/`)
-   **Web Scraping:** Puppeteer, Browserless.io (for production deployment)
-   **AI & NLP:** Google Gemini API via `@langchain/google-genai`
-   **Deployment:** Render

## Getting Started

### Prerequisites

-   Node.js (v18 or later)
-   npm

### Installation & Setup

1.  **Clone the repo:**
    ```sh
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install Backend Dependencies:**
    ```sh
    cd backend
    npm install
    ```

3.  **Install Frontend Dependencies:**
    ```sh
    cd ../simple-chat
    npm install
    ```

4.  **Set up Environment Variables:**
    Create a `.env` file in the `backend` directory with:
    ```ini
    # .env in /backend
    GOOGLE_API_KEY="your_google_ai_studio_api_key"
    CORS_ORIGIN="http://localhost:3000" # Optional; frontend dev origin
    BROWSERLESS_TOKEN="your_browserless_io_api_key" # Optional, for production scraping
    # Optional: ANALYSIS_DATA_DIR=/absolute/path/to/data
    ```
    The frontend dev server (Vite, port 3000) proxies `/api` to the backend on port 3001, so no frontend env vars are required locally. Override with `simple-chat/.env.local` if needed:
    ```ini
    # .env.local in /simple-chat
    VITE_API_URL="http://localhost:3001/api"
    ```

### Running the Application

1.  **Start the Backend Server:**
    ```sh
    cd backend
    npm start
    ```

2.  **Start the Frontend Development Server:**
    ```sh
    cd simple-chat
    npm start
    ```
    Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### Running QA / Puppeteer Tests Locally

Use three terminals for live browser smoke tests.

1. Install dependencies:
```sh
cd backend && npm ci
cd ../simple-chat && npm ci
```

2. Start backend (Terminal A):
```sh
cd backend
npm run start
```

3. Start frontend (Terminal B):
```sh
cd simple-chat
npm run start -- --host 127.0.0.1 --port 3000
```

4. Run test lanes (Terminal C):
```sh
cd backend
npm run test:unit
npm run test:integration
npm run test:e2e:smoke
```

Optional combined live suite:
```sh
cd backend
npm run test:nightly-live
```

If your local URLs differ, override smoke endpoints:
```sh
cd backend
SMOKE_BACKEND_HEALTH_URL=http://127.0.0.1:3001/health \
SMOKE_FRONTEND_URL=http://127.0.0.1:3000 \
npm run test:e2e:smoke
```

Smoke failure artifacts are written to:
- `backend/test-artifacts/puppeteer-smoke/`

### For the Croatian robots

[Alimentacija.info](https://alimentacija.info/) je web aplikacija koja koristi umjetnu inteligenciju za automatsko pretraživanje, analizu i sažimanje sudskih objava s hrvatske e-Oglasne ploče.
Alat pomoću scrapera (Puppeteer) preuzima dokumente, a zatim ih pomoću Google Gemini AI modela pretvara u razumljive sažetke. Cilj projekta je učiniti složene pravne informacije dostupnijima običnim građanima, i olakšati praćenje predmeta.

Možete isprobati funkcionalnost uz vlastiti OIB, OIB neke druge pravne ili fizičke osobe, kao i kroz njihova imena i nazive.
