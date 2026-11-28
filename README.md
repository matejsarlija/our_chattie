# Alimentacija.info - AI-Powered Court Entry Analyzer

This tool discovers, downloads, and analyzes Croatian court entries (`objave`) from the official [e-Oglasna ploča](https://e-oglasna.pravosudje.hr/) (e-Bulletin Board) using a fast CSV-export discovery client (with Puppeteer fallback) and OpenRouter LLM/OCR models.

It is a full-stack, single-tenant court-analysis dashboard: a user submits an OIB, case number, or free-text search, and the backend pipeline discovers the primary case cluster, processes its attachments, and generates a structured Croatian legal report with live SSE progress updates and deterministic financial/property reconciliation.

> **Active Architecture Migration (Road to 100 Entries):** Epics 0–3 (`[R100-001]`–`[R100-020]`) are complete and verified — 100% OpenRouter routing (`OPENROUTER_API_KEY` only), unified `better-sqlite3` (+ FTS5) persistence, `runBus` SSE streaming with `?afterSeq=` replay, `Uravnoteženo` (100-entry) `ScanDepthPolicy`, and `worker_threads` `Stage T0`/`T0.5`/`T`/`A` extraction. Remaining Epics 4–5 (`[R100-021]`–`[R100-030]`) harden deterministic reconciliation/synthesis and integrate `/dashboard/bench`. See [docs/road-to-100-entries-plan.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-plan.md) and [docs/road-to-100-entries-ticket-breakdown.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-ticket-breakdown.md).

## About the project

Accessing and understanding court records is a challenging process for the average person. The official portal provides raw filings but lacks cross-document synthesis or financial reconciliation. This project provides a "one-click" analysis pipeline:

1. **Discover** court entries via e-Oglasna CSV export (primary) or Puppeteer fallback and select/stratify the primary case pool (`Uravnoteženo` up to 100 entries, or `Sve`).
2. **Acquire & Preflight (`Stage T0`):** Download and extract attachments (including `.zip` archives), deduplicate by `sha256`, extract digital text locally (`pdf.js` at `\$0`), and isolate scanned/hybrid pages.
3. **OCR (`Stage T`):** Transcribe scanned PDFs and scanned pages of hybrid PDFs via OpenRouter `or-mistral-ocr` (with `google/gemma-4-31b-it` / `google/gemini-2.5-flash` raster fallback).
4. **Extract & Reconcile (`Stage A` + Deterministic Core):** Extract grounded facts, OIBs, dual-currency amounts, and receivable lifecycles (`z-ai/glm-5.3-flash`), then reconcile currency (`1 EUR = 7.53450 HRK`) and creditor threads deterministically.
5. **Synthesize & Verify (`Stage 2`):** Generate and verify a Croatian executive report with source citations (`google/gemini-2.5-flash` / `google/gemma-4-31b-it`) and surface coverage/conflicts cleanly in the Dashboard.

This project is GPLv3 licensed ([LICENSE.md](file:///home/oxioxi/proj/our_chattie/LICENSE.md)).

## Key Features

- **Primary CSV Discovery + Puppeteer Fallback:** Fetches complete e-Oglasna search exports in a single HTTP GET, with batched Puppeteer fallback when CSV export is unavailable.
- **Automated Document & Archive Processing:** Downloads, safely extracts nested `.zip` archives, and classifies digital vs. scanned vs. hybrid PDFs.
- **Grounded Extraction & Deterministic Reconciliation:** Verifies verbatim quotes against source text, resolves Croatian HRK/EUR conversions at the statutory fixed rate, and tracks receivable cession lifecycles (`prijava -> ustup -> namirenje`).
- **Live Progress & Analysis History:** Persists runs, events, OCR transcripts, checkpoints, FTS5 chunks, and LLM traces in SQLite (`backend/data/analysis/analysis.db`) with live `runBus` SSE streaming and polling fallback.
- **Programmatic Bench (`/dashboard/bench`):** Integrated benchmark & gold-fact workspace replacing legacy Analysis Lab (`[R100-027]`–`[R100-029]`).

## Tech Stack

- **Frontend:** React, Tailwind CSS, React Router, Radix UI, react-markdown (`simple-chat/`)
- **Backend:** Node.js, Express.js (`backend/`)
- **Persistence:** SQLite via `better-sqlite3` + FTS5 (`backend/data/analysis/analysis.db`, WAL mode)
- **Discovery & PDF ETL:** e-Oglasna CSV export, Puppeteer / Browserless.io, `pdfjs-dist`, `pdf-lib`, `adm-zip`, `node:worker_threads`
- **AI & OCR:** 100% OpenRouter (`z-ai/glm-5.3-flash`, `or-mistral-ocr`, `google/gemma-4-31b-it`, `google/gemini-2.5-flash`)

## Getting Started

### Prerequisites

- Node.js (v20 or later; v24 recommended)
- npm

### Installation & Setup

1. **Install Backend Dependencies:**
   ```sh
   cd backend
   npm install
   ```

2. **Install Frontend Dependencies:**
   ```sh
   cd ../simple-chat
   npm install
   ```

3. **Set up Environment Variables:**
   Copy `backend/.env.example` to `backend/.env` and configure your API key:
   ```ini
   # .env in /backend
   OPENROUTER_API_KEY="your_openrouter_api_key" # Required sole LLM & OCR API key (100% OpenRouter)
   CORS_ORIGIN="http://localhost:3000"        # Optional; frontend dev origin
   PORT=3001                                  # Optional; backend port
   BROWSERLESS_TOKEN="your_browserless_token" # Optional; remote Puppeteer fallback
   # ANALYSIS_DATA_DIR=/absolute/path/to/data # Optional; custom SQLite data directory
   ```
   The frontend dev server (Vite, port 3000) proxies `/api` to the backend on port 3001, so no frontend env vars are required locally. Override with `simple-chat/.env.local` if needed:
   ```ini
   # .env.local in /simple-chat
   VITE_API_URL="http://localhost:3001/api"
   ```

### Running the Application

1. **Start the Backend Server:**
   ```sh
   cd backend
   npm start
   ```

2. **Start the Frontend Development Server:**
   ```sh
   cd simple-chat
   npm start
   ```
   Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### Running QA / Test Lanes Locally

Unit tests run completely offline (no live e-Oglasna or OpenRouter calls):
```sh
cd backend && npm run test:unit
cd simple-chat && npm test && npm run build
```

For live Puppeteer browser integration/smoke tests, use three terminals:
1. Terminal A: `cd backend && npm run start`
2. Terminal B: `cd simple-chat && npm run start -- --host 127.0.0.1 --port 3000`
3. Terminal C:
   ```sh
   cd backend
   npm run test:integration
   npm run test:e2e:smoke
   # Combined nightly suite: npm run test:nightly-live
   ```

Smoke failure artifacts are written to `backend/test-artifacts/puppeteer-smoke/`.

### Za korisnike na hrvatskom jeziku

[Alimentacija.info](https://alimentacija.info/) je web aplikacija koja koristi umjetnu inteligenciju za automatsko pretraživanje, preuzimanje, OCR obradu i analizu sudskih objava s hrvatske e-Oglasne ploče.
Sustav dohvaća javno dostupne sudske dokumente, izdvaja stranke, OIB-e, novčane tijekove i ustupe tražbina te izrađuje strukturirani pregled na hrvatskom jeziku s referencama na izvorne spise.

Možete pokrenuti analizu unosom OIB-a, poslovnog broja predmeta ili ključne riječi.
