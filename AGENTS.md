# AGENTS.md - Development Guide for Agentic Coding

This repository is a full-stack monorepo for an AI-powered legal assistant that analyzes Croatian court records. This guide helps agentic coding agents become productive quickly.

## What This App Actually Is

Despite the repo name (`our_chattie`) and some legacy naming in the backend (`server.js`, historical references to a "chat" concept), **there is no chat surface in this app anymore.** The original conversational/TipTap-editor chat feature (`ChatContext`, `useStreamingAPI`, `MessageList.jsx`, `backend/chatAgent.js`, `backend/db.js`, a `cron/` scheduler) was removed entirely. The product today is a single-purpose **court-analysis dashboard**: a user submits an OIB/case-number/text query, the backend pipeline (`backend/court-analysis/`) discovers and analyzes Croatian court filings via 100% OpenRouter LLMs/OCR (`z-ai/glm-5.3-flash`, `or-mistral-ocr`, `google/gemma-4-31b-it`, `google/gemini-2.5-flash`), and the frontend (`simple-chat/`, name unchanged from the chat era) renders the run list, detailed run reports, and (in Phase 5) the integrated PDF-engine benchmark workspace. If you find a reference to chat-specific code elsewhere in the codebase, treat it as stale and flag it for removal rather than assuming it is still live.

## Active Roadmap & Migration Authority

This repository is actively executing the **Road to 100 Court Entries** architecture & hardening migration (`[R100-001]`–`[R100-030]`; Epics 0–3 / `[R100-001]`–`[R100-020]` are complete and verified, with `[R100-021]` and Epics 4–5 upcoming):
- **Master Blueprint:** [docs/road-to-100-entries-plan.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-plan.md)
- **Ticket Breakdown:** [docs/road-to-100-entries-ticket-breakdown.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-ticket-breakdown.md)

Key directional invariants binding all work:
1. **100% OpenRouter (`OPENROUTER_API_KEY` only):** Phase 0 (`[R100-002]`) removed `@google/genai`, `@langchain/google-genai`, `@langchain/core`, and `GOOGLE_API_KEY` fallbacks. Never reintroduce direct Google SDKs or LangChain `Tool`/`HumanMessage` wrappers.
2. **Unified Persistence (`better-sqlite3` + FTS5 + `llm_traces`):** Phase 2 (`[R100-011]`) consolidated `localStore.js`, `ocrPageStore.js`, `change-detection/store.js`, and extraction checkpoints/traces into `backend/data/analysis/analysis.db` (WAL mode, `PRAGMA foreign_keys = ON`, `run_chunks_fts` sync triggers).
3. **100-Entry `ScanDepthPolicy` & Worker Offload:** `Uravnoteženo` budgets `100` court entries (keeping 100% of attached documents) and `Sve` covers the full primary pool (`'standard'` is retired); `Stage T0` (`pdf.js`), `adm-zip`, and JPEG rasterization run in `node:worker_threads`.
4. **Authorized Phase 0–5 Deletions vs. Do-Not-Delete Traps:** Agents executing tickets `[R100-001]`–`[R100-030]` are explicitly authorized to delete retired modules, legacy adapters, and obsolete tests specified in the ticket breakdown (`moneyFlow.js`, `prop-N` shims, 5 pruned reasoning LLM micro-passes, `'standard'` scan depth, `runs.json` store, `agents/analysis-agent.js`, Analysis Lab). **Two explicit do-not-delete traps:**
   - **Keep `contextNode.js`:** [caseContextBuilder.js#L22](file:///home/oxioxi/proj/our_chattie/backend/court-analysis/reasoning/caseContextBuilder.js#L22) directly imports `createContextNode` and `validateContextGraph`. Remove only its unused `L15` `analysisLab/evidenceIdentity` import.
   - **Keep `propertyFlow.js#L58–391` lifecycle engine:** [reconciliation.js#L26](file:///home/oxioxi/proj/our_chattie/backend/court-analysis/reasoning/reconciliation.js#L26) directly imports `reconcileTrazbinaLifecycle` and `formatValue`. Delete only `moneyFlow.js` and the two legacy wrapper functions (`collectPropertyFlows`, `reconcilePropertyFlows`) + `prop-N` shims.

## Architectural Ethos

The frontend is a court-analysis dashboard (no chat surface — that was removed; see "What This App Actually Is" section for background). Standards that actually hold today:

1.  **Custom hooks over prop drilling**: run/event state lives in focused
    hooks (`useAnalysisRunDetail`, `useAnalysisEvents`, `useAnalysisRuns`),
    not a global context/reducer. Components consume a hook's return value
    directly rather than threading state through many layers.
2.  **SSE with a polling fallback, never a hard dependency on either.**
    `useAnalysisRunDetail` prefers a live SSE stream
    (`useAnalysisRunStream`) while a run is active and the tab is visible,
    but falls back to backoff-with-jitter polling on stream error/tab
    hidden/stream disabled — a run's status must always be recoverable even
    if the stream never connects.
3.  **Defensive UI**: wrap unpredictable rendered content (the LLM-authored
    markdown narrative) in `ErrorBoundary` — see `AnalysisRunDetailPage.jsx`.
    A single malformed AI response should never crash the run detail page.
4.  **Infrastructure Agnosticism**: `simple-chat/` runs on Vite + Vitest (CRA was retired). Always abstract environment variable access via `src/lib/env.js`.

Solution must be coherent, cohesive with the existing codebase, and respect all existing codebase paradigms and practices.

## UI Design & Accessibility

Apply these durable findings from the UI audit and shipped redesign; treat old screen-specific proposals and token values as historical unless they match the current code.

- **Meet WCAG AA where the interface carries information.** Body text needs at least 4.5:1 contrast; meaningful control boundaries and focus indicators need at least 3:1. The audit found that faint borders and status dots were a larger contrast risk than most status text. Keep decorative separators distinct from control borders, and never rely on a subtle border or color alone to communicate state.
- **Status and severity are not color-only.** Pair status color with a visible label and/or glyph. Keep severity calm and readable; do not make every risk an alarm-colored banner. Unverified content should be visually recessed, not reduced to an easily missed badge.
- **Make interaction accessible by default.** Preserve visible keyboard focus, semantic controls and tables, accessible names/descriptions, and announced validation/save errors. Use the shared Radix-backed `components/ui/Dialog.jsx` for dialogs so Escape, focus trapping/restoration, outside dismissal, scroll locking, and modal semantics stay consistent.
- **Distinguish empty from unavailable.** “Nothing found” is different from “could not determine.” Render loading, genuinely empty, failed/unavailable, and populated states distinctly wherever the data contract supports them.
- **Give the answer visual priority over telemetry.** On report pages, conclusions, scope/coverage, and source evidence should be easy to scan; pipeline and retrieval detail are supporting context. Keep source citations legible and keyboard-reachable, and do not duplicate structured findings or chronology in narrative prose. Disclosures must keep content available and indicate how much is hidden when counts are known.
- **Treat design documents as historical evidence, not runtime truth.** Verify current code, persisted data contracts, and tests before applying older audit recommendations. Keep durable cross-screen UI rules here; do not recreate standalone HTML design audits, handoffs, or prototypes under `docs/` or `design-prototypes/` unless explicitly requested.

### Design System & Token Map (For Agents)

Every UI surface in `simple-chat/` uses one standardized **shadcn/ui Tailwind v4 (`@theme inline`) + Radix/CVA** design system:
- **Single Token Source of Truth:** [simple-chat/src/styles/tokens.css](file:///home/oxioxi/proj/our_chattie/simple-chat/src/styles/tokens.css) (`:root` variables + `@theme inline` utilities: `bg-bg`, `bg-surface`, `bg-surface-muted`, `text-ink`, `text-ink-muted`, `border-line` decorative vs `border-line-control` `>= 3:1` operable, `accent`, calm status pairs `success`/`warning`/`danger`/`info`, centralized `10px` card radius).
- **Owned Primitives (`simple-chat/src/components/ui/`):** Always reach for [Button.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Button.jsx), [Card.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Card.jsx), [Input.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Input.jsx), [Badge.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Badge.jsx), [StatusBadge.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/StatusBadge.jsx), [Callout.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Callout.jsx), [Tabs.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Tabs.jsx), [Dialog.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Dialog.jsx), and [Sheet.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/ui/Sheet.jsx) instead of hand-rolling variants.
- **Automated Token Enforcement:** [simple-chat/scripts/verify-design-tokens.mjs](file:///home/oxioxi/proj/our_chattie/simple-chat/scripts/verify-design-tokens.mjs) (`npm run verify:tokens` / `npm run verify:toolchain`) enforces `0` raw Tailwind color scales, `0` `var(--...)` bracket hacks, `0` off-scale card radii (`rounded-2xl`/`rounded-xl`), and `0` undefined semantic tokens across `100%` of `src/components/`.
- **Live Interactive Catalog:** Inspect every token, typography step, and interactive primitive at `/dashboard/design-system` ([DesignSystemPage.jsx](file:///home/oxioxi/proj/our_chattie/simple-chat/src/components/DesignSystem/DesignSystemPage.jsx)).

## Project Structure

*(Reflects Epics 0–3 landed layout plus Phase 4–5 targets; `analysisLab/` / `AnalysisLab/` remain until `[R100-029]`.)*

```
our_chattie/
├── backend/          # Node.js/Express API server (CommonJS)
│   ├── server.js              # Express/lifecycle bootstrapper (~100 LOC)
│   ├── routes/                # Express routers (courtAnalysis, analysisRuns, bench, changeDetection)
│   ├── http/                  # SSE, runBus, analysisStreamHandler, rateLimiter, pagination, validation
│   ├── llm/                   # openrouterClient, openrouterConfig, taskRouter, providerPool, creditLatch, tokenBudgetPolicy, retry, usage
│   ├── bench/                 # Shared programmatic PDF/Stage-2 bench services (used by /api/bench & CLI in Phase 5)
│   ├── court-analysis/        # Analysis pipeline
│   │   ├── pipeline.js        # State -> StageReducer -> NextState orchestrator (< 600 LOC)
│   │   ├── discoveryStage.js  # Grouping, cluster scoring & stratified selection
│   │   ├── acquisition/       # downloader, archiveExtractor, downloadCache, clusterAcquisition
│   │   ├── extraction/        # workerPool, pdfPreflight (T0), adminFastPath (T0.5), ocrRouter (T),
│   │   │                      # prompts (EXTRACTION_SIGNATURE_V5), chunkMerge, documentAnalyzer (A)
│   │   ├── reasoning/         # Organized into schema/, ledger/ (factLedger, partyRegistry, flow,
│   │   │   │                  # propertyFlow lifecycle, reconciliation, grounding, currencyConversion,
│   │   │   │                  # citationGraph, caseContextBuilder, contextNode, scopeContract, runScorecard),
│   │   │   │                  # retrieval/ (chunker, indexer, retriever, findingProvenance),
│   │   │   │                  # synthesis/ (synthesisInputBuilder, synthesizer, verifier, reportService, fallbackReportBuilder),
│   │   │   │                  # and eval/ (offline reasoning-quality eval lane)
│   │   └── utils/             # scanDepth, stratify, entryDisplayId, queryClassifier, runSummary, ...
│   ├── scraper/               # Web scraping logic (CSV export discovery primary + Puppeteer pool fallback)
│   ├── services/              # sqliteStore.js (WAL + FTS5 + traces, replacing localStore.js), canonicalJson.js, logger.js
│   └── tests/                 # Jest test suite (unit, reasoning/, replays/, change-detection/, resilience/)
├── simple-chat/      # React frontend application (ES6) — court-analysis dashboard + integrated Bench
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard/     # Run list + detail UI (AnalysisRunDetailPage, AnalysisReportAnnex,
│   │   │   │                  # AnalysisFlowsSection, AnalysisCitationList, RunsTable, NewAnalysisModal, ...)
│   │   │   ├── Bench/         # Integrated Bench UI (/dashboard/bench replacing Laboratorij in Phase 5)
│   │   │   ├── ErrorBoundary.jsx
│   │   │   └── AboutUs.jsx / PrivacyPolicy.jsx   # Static pages
│   │   ├── hooks/             # useAnalysisRunDetail, useAnalysisRunStream, useCourtAnalysisStream, useAnalysisRuns, useSettings
│   │   └── lib/               # apiClient, env
```

## Build/Lint/Test Commands

### Backend (run from `backend/` directory)
- **Development**: `npm run dev` (uses nodemon server.js)
- **Production**: `npm run prod` or `npm start`
- **Testing**: `npm test` (Jest, 60s timeout for Puppeteer tests)
- **Test lanes**: `npm run test:unit` (default, no live services),
  `npm run test:integration` / `npm run test:e2e:smoke` (Puppeteer-gated),
  `npm run test:nightly-live` (hits live e-Oglasna + OpenRouter — never run
  casually, CI-nightly only)

### Frontend (run from `simple-chat/` directory)
- **Development**: `npm start` (Vite)
- **Build**: `npm run build` (Vite)
- **Testing**: `npm test` (watch) or `npm run test:unit` (`vitest run`)
- **Toolchain & Token Check**: `npm run verify:toolchain` / `npm run verify:tokens`

## Key Integration Points

- **LLM & OCR Provider Routing (100% OpenRouter):** All models and roles route through OpenRouter (`OPENROUTER_API_KEY` only) via `backend/llm/` (`openrouterClient.js`, `taskRouter.js`, `providerPool.js`, `creditLatch.js`, `tokenBudgetPolicy.js`). Primary model assignments: `z-ai/glm-5.3-flash` (Stage A extraction), `or-mistral-ocr` → `google/gemma-4-31b-it` raster → `google/gemini-2.5-flash` (Stage T OCR), `google/gemini-2.5-flash` (Stage 2 synthesis), and deterministic `$0` pre-verification → `google/gemma-4-31b-it` / `google/gemini-2.5-flash` (verify). Always use 2–3 vetted providers per model with quantization guards (`['bf16', 'fp16', 'fp8']`), `stream: true` (`stream_options: { include_usage: true }`) + `60s` idle watchdogs, and graceful `HTTP 402` degradation (`'provider-credits-exhausted'`).
- **SSE Streaming:** `backend/http/sse.js` builds events in `data: {...}\n\n` format for `useAnalysisRunStream.js`. `POST /api/court-analysis` returns plain `202 Accepted` JSON (`{ analysisId, status: 'queued' }`). `GET /api/analysis/runs/:id/stream` subscribes to lightweight in-process `runBus` SSE deltas with `?afterSeq=` reconnect, lane-scoped `stage.progress` counters (`download`, `preflight`, `ocr`, `extract`), and a single REST snapshot fetch on terminal/reconnect, while keeping client backoff polling fallback (`useAnalysisRunDetail.js`). `preflight_json` is persisted on the run so refresh/polling never loses the cost ballpark.
- **Read-Side SQLite Endpoints & Run Control:** Keep `run_artifacts.result_json` strictly `< 500 KB` (strip both raw `individualAnalyses[].aiResult` and duplicate `clusterEvidencePackage.analyses[]` fact arrays / raw `factLedger[]`); serve paginated/searchable reads via `GET /api/analysis/runs/:id/facts`, `GET /api/analysis/runs/:id/chunks/:chunkId` / `?q=` (FTS5), and `GET /api/analysis/runs/:id/traces`. Persist `canonicalParties[]` and creditor/procedural digests on the run artifact, support `POST /api/analysis/runs/:id/cancel` (`status: 'canceled'`), and allow `POST /api/analysis/runs/:id/report` to pass `analysisStore` for FTS5 BM25 retrieval and overwrite `generationMode: 'deterministic_fallback'` reports (`partial` → `done`).
- **Generated diagrams:** Mermaid and the visualizer role were removed. Do not reintroduce model-authored diagrams or graph libraries without explicit product approval and a grounded, accessible data contract.
- **TypeSafe AI (`TYPESAFE_API_KEY`, `.agent/skills/typesafe-ai/SKILL.md`):** Strictly capped at a **€5 total project budget** — use only for low-volume calibrated judgments (e.g., visual blind-critic pass/fail gating or bounded Bench micro-experiments), never in unbounded loops or full-docket production fan-outs.

## Court-Analysis Pipeline Notes

The sub-sections below preserve hard-won architectural lessons from shipped phases and the Road-to-100 consolidation so future changes in `backend/scraper/`, `backend/court-analysis/`, and `backend/llm/` never reintroduce solved bugs.

### Discovery & Data-Integrity

1. **"Never fail a run" is a load-bearing project-wide philosophy, not a
   one-off choice.** Every acquisition layer (download cache, OCR cache, CSV
   export, change-detection snapshots, `HTTP 402` credit-exhaustion latch)
   follows the same shape: on a transient or quota failure, log the reason,
   degrade to a fallback or a friendly Croatian error/`$0` deterministic
   report (`status: 'partial'`), and never abort an entire run when partial or
   cached results can still serve the user.
2. **Discovery completeness must never silently become unbounded analysis
   depth.** A discovery source (especially CSV export) can return far more raw
   entries than should be downloaded/analyzed in one run. Always bound
   *analysis scope* independently of *discovery scope* via declarative
   `SCAN_DEPTH_POLICIES` (`scanDepth.js`: `Uravnoteženo` = `100` entries keeping
   100% of attached documents via unified `stratifyClusterEntries`, `Sve` =
   `allocation: 'all'` across the primary pool). Both CSV and Puppeteer
   fallback must feed `stratifyClusterEntries` identically.
3. **Raw timestamps from external sources are a classic silent-corruption
   trap.** The e-Oglasna CSV export emits Croatian local wall-clock time with
   no timezone designator (`dd.mm.yyyy. HH:mm:ss`). Normalize to a
   **date-only** ISO 8601 string before any date-span, recency, or ordering
   logic — date-only ISO parses as UTC midnight per spec, so the source day
   survives regardless of host timezone.
4. **Identifiers that look similar are not always the same identity.**
   Croatian case numbers can carry a register prefix (`4 St-2/2013` vs
   `St-2/2013`) that must be preserved as a *distinct* grouping key, not
   normalized away. Conversely, bare root case numbers (`st-2/2013`) must
   never collapse unrelated facts or generate Cartesian edges in
   `caseContextBuilder.js` / `citationGraph.js`.
5. **A cheap metadata-only change signal is a real tradeoff, not a free
   lunch.** Change detection compares filenames + page counts instead of
   document content to avoid downloading anything. Accepted deliberately for
   now; if insufficient in practice, the next lever is byte-level hashing.
6. **A discovery/acquisition source's own completeness can outstrip what
   downstream code was ever tested against.** Audit every downstream
   consumer's bounding/truncation assumptions explicitly at 100-entry scale
   (200–300+ documents, ~150+ creditors).

### Grounding & Property-Flow Extraction

1. **Verify extraction against source text deterministically, at extraction
   time.** `grounding.js` (`isQuoteGrounded`/`applyGroundingToAnalysis`) checks
   each claim's verbatim `quote` against its own document's raw text via
   `normalizeText` + whitespace-collapse containment — no LLM judge.
   Empty/missing quotes mark `grounded: false` and degrade cleanly without
   failing a run.
2. **One canonical `factLedger → flows → reconciliation` pipeline.**
   The legacy triple adapter chain (`moneyFlow.js`, `collectPropertyFlows`,
   `reconcilePropertyFlows`, `prop-N` ID shims) is retired in Phase 0
   (`[R100-004]`). New structured facts expand `factLedger.js` (`amount |
   property | party | procedural_outcome`) and flow straight into `flows.js`
   and `reconciliation.js` (preserving the active `tražbina` lifecycle engine
   in `propertyFlow.js#L58–391`), merging into `pkg.reconciliation → meta →
   report.conflicts`.
3. **Lifecycle chains are not conflicts — but only when the link is explicit.**
   `tražbina` entries carry `eventType` (`prijava | ustup | namirenje |
   drugo`) and `supersedes`. Resolution uses deterministic `factLedger` `row.id`
   and real registry/filing identifiers (`claimRegistryNumber`,
   `filingReference`) first, falling back to normalized-description containment
   last; unresolvable references degrade to standalone.
4. **Budget output tokens for reasoning-vs-answer headroom and dense tables.**
   Do not rely on static `maxOutputTokens` integers alone: use
   `TokenBudgetPolicy` (separating `answerTokens` from model
   `reasoningHeadroom`), `tableRows[]` compact extraction (~70% smaller output
   on creditor schedules), and recursive UTF-8 bisection (`depth <= 2`, floor
   `800` chars) on `finish_reason === 'length'`. Any schema addition must
   re-verify dense-table output expansion.
5. **Coverage signals belong in both coverage objects and in the UI.**
   `groundedClaims`/`totalClaims` and `runScorecard` metrics belong in
   `AnalysisCoverageBanner` + `AnalysisFlowsSection` (with calm inline
   "⚠ nepotvrđeno" markers, never silent deletion of `unverified` findings).
6. **Grounding is forward-only.** No retroactive backfill of legacy cached
   analyses.
7. **Preserve local extraction across long documents and multi-page scans.**
   Production chunks any document `> 4,000` chars OR `> 2` pages OR
   `table_dense` into `~2,200–3,500`-char segments (with recursive bisection,
   retaining `sourceChunkId`, offsets, and `sourcePages`). Overlap dedup
   matches normalized quotes strictly within the segment's overlap span.
   `Stage T` OCR uses `15`-page `pdf-lib` batch windows across up to `60`
   pages (`40p` head + `20p` tail with explicit partial coverage beyond `60p`).
8. **Spread fixed report claim budgets across time.** Chronological claim
   slots in `synthesisInputBuilder.js` must spread evenly across case years
   (`spreadItems`), never truncating to an earliest-only positional prefix.

### Identity, Currency & Provenance

1. **Extract the identifiers the source documents already give you before
   inventing fuzzy matching.** Use `poslovni broj`, `redni broj`, explicit
   party OIBs (resolved via `partyRegistry.js`), and `isplatni red` first;
   `flowGroupKey` in `reconciliation.js` must be identity-scoped so 168
   creditors never collide under generic labels.
2. **Currency conversion is a fixed-rate deterministic computation, never a
   model-guessed one.** Fixed legal rate `1 EUR = 7.53450 HRK`
   (`currencyConversion.js`); EUR-stated figures win outright when both are
   present, mismatches beyond tolerance become reconciliation questions, and
   all arithmetic runs on EUR-consolidated fields (`asFiniteNumberOrNull` must
   parse Croatian thousands separators like `"1.200.000,00"` cleanly).
3. **A prompt/schema/repair contract must compile from one source of truth.**
   Every structured field and enum (including `decisionOutcome` in
   `REPAIRABLE_FIELDS`, `tableRows[]`, and appellate tie-breakers) must be
   compiled from `EXTRACTION_SIGNATURE_V5` (`extraction/prompts.js`) and
   verified by automated prompt–schema–repair–scorer lockstep tests.
4. **Provenance has two ends, and they are both worth keeping.**
   `grounding.js` proves a claim matches its document; `findingProvenance.js`
   (anchored on `docId`/`sourceEntryIndex`, never bare `fileName`) proves why
   the document was in scope via FTS5 BM25; `llm_traces` preserves raw model
   completions before `JSON.parse` for forensic inspection.
5. **Golden fixture tests against real, hand-verified source text catch more
   than synthetic fixtures.** Maintain `tests/reasoning/kerumGolden.test.js`
   and `pdf-benchmark-*.test.js` against frozen `pdf.js`/OCR fixtures.
6. **A single duplicated rendering surface is worse than a missing one.**
   `AnalysisReportAnnex` is the single canonical owner of structured findings;
   `composeOverviewMarkdown` must not duplicate findings in narrative prose.
7. **A disappointing production run becomes a deterministic replay test.**
   Capture minimal non-sensitive metadata and normalized facts in
   `tests/fixtures/replays/` (and `bench_candidates`), keeping
   `kerumReplay.test.js` green without live scraping or LLM calls.

### Reasoning Engine Conventions

1. **Test-first with fixtures, in the right lane.** Every behavior change
   starts with a failing fixture-backed or offline chaos test (`test:unit` /
   `backend/tests/resilience/`). Never depend on live scraping or live LLMs in
   `test:unit`; `test:nightly-live` is CI-nightly only.
2. **Compatibility is an adapter, not a quality target — and single-user
   internal debt gets deleted.** Preserve external UI/report readability, but
   drop legacy shims (`moneyFlow.js`, `prop-N` IDs, `runs.json`, Analysis Lab)
   on schedule rather than maintaining double formats indefinitely.
3. **The backend owns query-type truth.** `queryClassifier.js`
   (`oib | case_number | text`) is the single authority; frontend regexes are
   request hints only.
4. **Don't split the scraper for purity.** `courtSearchPuppeteer.js` remains
   the browser/session fallback adapter (harvesting an HTML pool directly into
   `stratifyClusterEntries` without multi-pass `clusterExpansion`).
5. **Discovery order and Stage-2 presentation are deliberately engineered.**
   Discovery/download budgeting prioritizes current state + vital ledgers +
   origin/middle witnesses (`stratify.js`); Stage-2 synthesis receives a
   compact RLM Symbolic Case Environment (chronological Markdown Pipe Tables,
   Tagged `[C<N>]` Excerpt Blocks, upfront `reconciliation.conflicts`, and a
   **25% protected FTS5 BM25 floor** that flow rows can never evict).
6. **Programmatic Bench (`/dashboard/bench`) supersedes Analysis Lab.**
   Analysis Lab (`analysisLab/` / `AnalysisLab/`) is being sunset (`[R100-029]`).
   All future extraction, OCR, and Stage-2 report benchmarking runs inside
   `backend/bench/` + `/dashboard/bench` (plus `bench_candidates` anomaly
   harvesting) on frozen fixtures/snapshots, behind explicit `approved: true`
   and `maxCost > 0` caps, and never auto-mutates production defaults.

### Model Evaluation & Ingestion Guardrails (Preventing Escalation Spirals)

1. **Capture the raw payload before inventing a mitigation (The Crime Scene Rule).**
   Persist raw completions in `llm_traces` (and Bench artifacts) *before*
   `JSON.parse`, alongside parse offset and `finish_reason`.
2. **Decouple document ingestion (ETL) from model reasoning (Inference).**
   Never upload digital PDFs across the wire to extract text (`pdf.js` extracts
   locally for `$0`); benchmark OCR (`Stage T`) independently into frozen
   transcripts; benchmark Stage A extraction models on identical canonical text.
3. **Never apply an All-or-Nothing failure policy to multi-segment tasks.**
   Use bounded chunking, `SegmentCheckpoint` persistence, recursive bisection,
   and per-segment fallback so partial/cached work is never thrown away.
4. **Structured output parameters before infrastructure workarounds.**
   Always use `response_format: { type: "json_object" }` +
   `provider: { require_parameters: true }` + quantization guards.
5. **Benchmarks measure; they do not re-architect.**
   Benchmark evaluation cells (`backend/bench/`) must record honest pass/fail
   data without dynamic PDF slicing or multi-step repair heuristics inside a
   scored arm; conversely, production `Stage T0`/`Stage T` (`extraction/`)
   uses deterministic `pdf-lib` slicing for `hybrid_mixed` PDFs and `15`-page
   OCR batch windows as designed.
6. **Disambiguate client deadlines from upstream provider limits.**
   Check `60s` SSE idle watchdogs, `240s` total timeouts, `max_tokens`
   reasoning starvation, and `5 MB` worker caps before blaming a model.

## Feature Delivery & Design Docs

Keep durable cross-cutting UI and accessibility guidance in this file. Active migration scope lives in [docs/road-to-100-entries-plan.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-plan.md) and [docs/road-to-100-entries-ticket-breakdown.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-ticket-breakdown.md). Do not create standalone HTML design documents or prototypes unless explicitly requested.

## Knowledge Base & Historical Search

This project uses a project-scoped SQLite knowledge base to store and index historical chat sessions and code changes.

### Search Utility
To find similar solutions or technical decision history, use the following command from the project root:
```bash
node ~/.opencode/kb_tools/search.js "your query here"
```
The search uses a **Hybrid BM25 + Vector** approach to find relevant historical context.

### Database Location
The database is located at `./.opencode/kb.db`. You can query it directly using `sqlite3` for complex analytics.
- **Table: `sessions`**: Metadata, titles, and stats.
- **Table: `messages`**: Historical chat content.
- **Table: `search_index`**: FTS5 virtual table for keyword search.

### Sync Daemon
The background sync is managed by `~/.opencode/kb_tools/manage.sh`. 
- Check status: `~/.opencode/kb_tools/manage.sh status`
- Stop/Start: `~/.opencode/kb_tools/manage.sh stop|start`
