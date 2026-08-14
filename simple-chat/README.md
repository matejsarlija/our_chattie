# Court Analysis Dashboard Frontend

This React application is the dashboard for the court-analysis service. It lets users start an analysis, follow its progress, and inspect completed or partially completed reports.

For backend setup, Gemini configuration, and end-to-end QA instructions, see the [root README](../README.md).

## Routes

- `/` redirects to `/dashboard`.
- `/dashboard` lists analysis runs and opens the new-analysis dialog.
- `/dashboard/runs/:id` shows one run, including its progress events and structured report.

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
npm run storybook         # Storybook on port 6006
npm run build-storybook   # static Storybook build
```

The dashboard’s visual decision history lives in `src/stories/Dashboard/AnalysisDetail/README.mdx`.
