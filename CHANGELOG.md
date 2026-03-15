# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Chat UI (CHAT-201)**: Added `ScrollToBottomButton` component and exported it through the Chat component index.
- **Chat UI (CHAT-202)**: Added `WordFadeIn` (`WordFadeIn.jsx` + `WordFadeIn.css`) to support animated reveal of finalized assistant responses.
- **Testing (CHAT-203)**: Added `AltChat.scroll-button.test.jsx` coverage for scroll-button visibility, overlay anchoring, and near-bottom hide behavior.
- **Dashboard Analysis (D-05)**: Added shared `AnalysisCitationList` component for citation rows with source/page/location formatting, optional source links, and null-safe filtering.
- **Dashboard Analysis (D-04)**: Added `AnalysisReportAnnex` component to render structured annex sections (`Nalazi`, `Vremenska crta`, `Konflikti`) from `result_json.report`.
- **Dashboard Analysis Testing (D-03/D-04/D-05, E-04)**: Added `AnalysisRunDetailPage.test.jsx` covering typed label fidelity, metadata module rendering, structured annex visibility, citation rendering, and fallback behavior.
- **Dashboard Analysis Testing (D-02)**: Added `useAnalysisEvents.test.jsx` to lock canonical stage taxonomy and legacy-to-canonical mapping behavior.
- **Dashboard Analysis Testing (D-06)**: Extended `AnalysisRunDetailPage.test.jsx` with coverage for `open_questions` section rendering, structured malformed/empty state resilience, explicit `oib -> OIB`, and neutral unknown query fallback (`Upit`).
- **Dashboard Analysis Testing (D-07)**: Extended `useAnalysisEvents.test.jsx` with stage-parity coverage for backend aliases (`processing_case`, `enriching` -> `grouping`).
- **Storybook Governance (D-08)**: Updated analysis-detail Storybook governance surfaces (`DecisionMatrix`, `ProgressPresentation`, `README.mdx`) with explicit variant lifecycle statuses and approved baseline alignment.
- **Dashboard Analysis Testing (D-01)**: Added `useStreamingAPI.courtAnalysis.test.js` to verify typed query payload construction (`oib`, `case_number`, `text`) with legacy `searchTerm` fallback.
- **Court Analysis API Testing (A-02/A-03/A-09)**: Added `queryClassifier.test.js`, `courtAnalysisRequest.test.js`, `pipeline.caseLimit.test.js`, and `entryDisplayId.test.js` for typed-query classification, request parsing/validation, caseLimit behavior, and entry-display-id derivation.
- **Court Analysis API Testing (A-07/A-08)**: Added `analysisStage.test.js` and `analysisStore.createRun.test.js` for canonical stage normalization and typed-query persistence with backward-compatible fallback.

### Fixed
- **Document Edit (DE-101)**: Fixed duplicate text insertion issue by enforcing single-writer pattern in BubbleMenu.
- **Document Edit (DE-102)**: Added explicit submit button and Enter key support for custom commands.
- **Document Edit (DE-103)**: Normalized preset behavior; all main presets now trigger preview mode for consistency.
- **Document Edit (DE-104)**: Replaced "Odbaci" with smart "Otkaži" action that correctly reverts changes during preview.
- **Document Edit (DE-105)**: Improved BubbleMenu positioning to keep it within the viewport (clamping and vertical flipping).
- **Document Edit (DE-106)**: Cleaned up preset list to 3 core actions and added "Format" quick action.
- **Chat Scroll (CHAT-204)**: Moved scroll-to-bottom control to a viewport overlay in `AltChat` so it no longer scrolls away with message content.
- **Chat Layout (CHAT-205)**: Added `min-h-0` to the main chat flex chain to restore stable scrolling/overflow behavior after overlay refactor.
- **Chat Auto-scroll Tests (CHAT-206)**: Updated `MessageList.scroll.test.jsx` to clear initial mount scroll calls before asserting non-auto-scroll behavior.
- **Dashboard Analysis (D-03)**: Updated `AnalysisRunDetailPage` header to honor typed query labels (`Predmet` for case-number queries, `OIB` otherwise).
- **Dashboard Analysis (D-03)**: Added richer metadata cards in run detail showing `Naziv objave`, `Broj predmeta`, and `ID objave` (fallback derived from `detailLink` when backend `entryDisplayId` is absent).
- **Dashboard Analysis (D-02)**: Aligned `useAnalysisEvents` with canonical stage taxonomy (`discovering`, `grouping`, `downloading`, `chunking`, `retrieving`, `reasoning`, `verifying`) and added backward-compatible mapping from legacy stage keys.
- **Dashboard Analysis (D-01)**: Updated `useStreamingAPI.streamCourtAnalysis` to send typed `query` payloads while preserving legacy `searchTerm` fallback for rollout compatibility.
- **Court Analysis API (A-01/A-03)**: Updated `/api/court-analysis` request parsing to support typed `query` payloads (`oib|case_number|text`) with legacy `searchTerm` fallback and runtime `options.caseLimit` handling (default 5, bounded 1-10), removing hardcoded `2` from route execution.
- **Court Analysis Pipeline (A-03)**: Updated `runCourtAnalysis` to accept options/legacy signatures while consistently resolving `caseLimit` for scraper selection.
- **Court Analysis Payload (A-09)**: Added backend `entryDisplayId` derivation from `detailLink` in `processedCases[].caseResult` with null-safe fallback.
- **Court Analysis SSE (A-07)**: Normalized backend progress stages to canonical taxonomy before emission/persistence, while preserving original legacy stage in metadata (`originalStep`) when remapped.
- **Court Analysis Persistence (A-08)**: Extended analysis run creation flow to persist `query_type` and `query_value`; added safe fallback to legacy insert path when typed columns are unavailable.
- **Supabase Schema (A-08)**: Added nullable `analysis_runs.query_type` and `analysis_runs.query_value` with `query_type` check constraint (`oib|case_number|text`).
- **Dashboard Analysis (D-03/E-04)**: Updated typed query header labels in run detail to map `text -> Tekst` and unknown/missing types to neutral `Upit` (no OIB fallback).
- **Dashboard Analysis (D-06)**: Improved `AnalysisReportAnnex` structured rendering from `result_json.report` by adding `Otvorena pitanja` support, section-level empty states when structured report is present, and null-safe fallback rendering for malformed section items.
- **Dashboard Analysis (D-07)**: Aligned frontend `useAnalysisEvents` legacy-stage mapping with backend canonicalization by mapping `processing_case` and `enriching` to `grouping`.
- **Storybook Governance (D-08)**: Synchronized analysis-detail decision history/docs with implemented route behavior by promoting `DashboardRichMetadata` from `Candidate` to `Approved` and documenting structured annex expectations.
- **Dashboard Analysis Runtime Safety (D-01/E-04)**: Guarded `streamCourtAnalysis` debug branch against missing global `process` in browser runtimes.
- **Court Analysis Pipeline (A-05/A-06)**: Fixed unique-case under-selection by widening pre-group scrape input (`scrapeLimit = caseLimit * 3`, bounded) before grouping, so duplicate listings do not reduce final distinct-case coverage below the requested `caseLimit`.
- **Court Analysis Pipeline (A-06)**: Fixed options merge regression so visualization remains enabled by default when passing `{ caseLimit }`; visualizer is now disabled only when explicitly set with `enableVisualizer: false`.
- **Court Analysis Pipeline (A-06)**: Hardened cluster selection policy to rank by recency first and coverage second (document/entry richness), with stable tie-breakers by discovery order under `caseLimit` constraints.
- **Court Analysis Reasoning (B-07)**: Integrated a large-document chunking/retrieval analysis path in `analysis-agent` so oversized documents are analyzed from retrieved chunks rather than relying on direct `text.slice(0, 25000)` input as the primary strategy.
- **Court Analysis Reasoning (C-01/C-02/C-03)**: Added `schema.js` for strict claim/evidence/report validation, `timelineBuilder.js` for event chronology construction, and `synthesizer.js` for generating structured Croatian narratives from evidence.
- **Court Analysis Testing (A-05/A-06)**: Added/updated regression coverage in `pipeline.caseLimit.test.js`, `pipeline.selection.test.js`, and `pipeline.visualizer-default.test.js` for widened scrape-window behavior and visualizer default semantics.
- **Court Analysis Testing (B-07)**: Added `analysis-agent.chunking.integration.test.js` to verify large-document analysis invokes chunking and feeds retrieved chunk content into the model prompt.
- **Court Analysis Testing Infrastructure**: Split deterministic and live-browser testing by keeping `pipeline.test.js` mocked and moving Puppeteer path to `pipeline.live.integration.test.js`; Puppeteer-dependent suites remain gated behind `RUN_PUPPETEER_INTEGRATION=1` and are grouped under `backend` script `npm run test:integration`.
- **QA/Test Matrix**: Added CI-oriented lanes for backend/frontend unit tests, backend integration tests, and optional live Puppeteer smoke runs (`test:e2e:smoke`, `test:nightly-live`) with a new baseline smoke spec and GitHub Actions workflow (`.github/workflows/test-matrix.yml`).
- **Puppeteer Smoke Diagnostics**: Added failure artifact capture for smoke tests (screenshot, page HTML, console/page errors, failed requests) and CI artifact upload in nightly live lane.
