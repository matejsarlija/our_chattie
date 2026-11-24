# Court Analysis Dashboard Frontend

This React application is the dashboard for the court-analysis service. It lets users start an analysis, follow its progress in real time, inspect completed or partially completed reports, and run offline/controlled extraction benchmarks.

For backend setup, OpenRouter LLM configuration, and end-to-end QA instructions, see the [root README](../README.md) and [Road to 100 Entries Plan](../docs/road-to-100-entries-plan.md).

## Routes

- `/` redirects to `/dashboard`.
- `/dashboard` lists analysis runs and opens the new-analysis dialog, which includes a "Dubina pretrage" scan-depth selector (`ScanDepthSelect`): `Uravnoteženo` (default; up to 100 stratified key entries with all attached documents; legacy `Standardno` removed in Phase 0/1) and `Sve` (`Sve dostupne`, full primary-cluster coverage).
- `/dashboard/runs/:id` shows one run, including its live `runBus` SSE progress stream (with polling fallback), status (`Završeno`, `Djelomično`, `Prekinuto`, `Greška`), financial/property flows, coverage scorecard, and structured report.
- `/dashboard/bench` (replacing legacy `/dashboard/lab` in `[R100-028]`–`[R100-029]`) hosts the integrated PDF-engine & Stage-2 benchmark launcher, scorecards, and gold fact editor.

## Development

Install dependencies and start the default Vite server:

```sh
npm install
npm start
```

The app runs on `http://localhost:3000` and proxies `/api` requests to the backend at `http://localhost:3001`.

No frontend environment variables are required for local development. To use another API origin or change streaming behavior, create `.env.local` with supported Vite variables:

```ini
VITE_API_URL="http://localhost:3001/api"
VITE_COURT_ANALYSIS_URL="http://localhost:3001/api/court-analysis"
VITE_ANALYSIS_DETAIL_SSE_ENABLED="true"
```

The same settings also accept `REACT_APP_*` names for Create React App compatibility.

## Commands

```sh
npm start                 # Vite development server
npm run build             # Vite production build to build/
npm test                  # CRA/Jest test runner
npm run test:ci           # non-interactive CI test run
npm run cra:start         # legacy CRA development server
npm run cra:build         # legacy CRA production build
npm run build:matrix      # verify Vite and CRA builds
```
