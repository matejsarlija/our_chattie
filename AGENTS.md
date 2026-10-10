# AGENTS.md - Development Guide for Agentic Coding

This repository is a full-stack monorepo for an AI-powered legal assistant that analyzes Croatian court records. This guide helps agentic coding agents become productive quickly.

## What This App Actually Is

Despite the repo name (`our_chattie`) and some legacy naming in the backend
(`server.js`, historical references to a "chat" concept), **there is no chat
surface in this app anymore.** The original conversational/TipTap-editor chat
feature (`ChatContext`, `useStreamingAPI`, `MessageList.jsx`,
`backend/chatAgent.js`, `backend/db.js`, a `cron/` scheduler) was removed
entirely. The product today is a single-purpose **court-analysis dashboard**:
a user submits an OIB/case-number/text query, the backend pipeline
(`backend/court-analysis/`) discovers and analyzes Croatian court filings via
Gemini, and the frontend (`simple-chat/`, name unchanged from the chat era)
renders the run list and a detailed run report. If you find a reference to
chat-specific code elsewhere in this file or the codebase, treat it as stale
and flag it for removal rather than assuming it's still live.

## Architectural Ethos

The frontend is a court-analysis dashboard (no chat surface — that was removed;
see "What This App Actually Is" section for background). Standards that
actually hold today:

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
3.  **Defensive UI**: wrap unpredictable rendered content (the Gemini-authored
    markdown narrative) in `ErrorBoundary` — see `AnalysisRunDetailPage.jsx`.
    A single malformed AI response should never crash the run detail page.
4.  **Infrastructure Agnosticism**: maintain compatibility with modern build
    tools (Vite) while supporting legacy infrastructure (CRA) during
    transition periods. Always abstract environment variable access.

Solution must be coherent, cohesive with the existing codebase, and respect all existing codebase paradigms and practices.

## UI Design & Accessibility

Apply these durable findings from the UI audit and shipped redesign; treat old screen-specific proposals and token values as historical unless they match the current code.

- **Meet WCAG AA where the interface carries information.** Body text needs at least 4.5:1 contrast; meaningful control boundaries and focus indicators need at least 3:1. The audit found that faint borders and status dots were a larger contrast risk than most status text. Keep decorative separators distinct from control borders, and never rely on a subtle border or color alone to communicate state.
- **Status and severity are not color-only.** Pair status color with a visible label and/or glyph. Keep severity calm and readable; do not make every risk an alarm-colored banner. Unverified content should be visually recessed, not reduced to an easily missed badge.
- **Make interaction accessible by default.** Preserve visible keyboard focus, semantic controls and tables, accessible names/descriptions, and announced validation/save errors. Use the shared Radix-backed `components/ui/Dialog.jsx` for dialogs so Escape, focus trapping/restoration, outside dismissal, scroll locking, and modal semantics stay consistent.
- **Distinguish empty from unavailable.** “Nothing found” is different from “could not determine.” Render loading, genuinely empty, failed/unavailable, and populated states distinctly wherever the data contract supports them.
- **Give the answer visual priority over telemetry.** On report pages, conclusions, scope/coverage, and source evidence should be easy to scan; pipeline and retrieval detail are supporting context. Keep source citations legible and keyboard-reachable, and do not duplicate structured findings or chronology in narrative prose. Disclosures must keep content available and indicate how much is hidden when counts are known.
- **Treat design documents as historical evidence, not runtime truth.** Verify current code, persisted data contracts, and tests before applying older audit recommendations. Keep durable cross-screen UI rules here; do not recreate standalone HTML design audits, handoffs, or prototypes under `docs/` or `design-prototypes/` unless explicitly requested.

## Project Structure

```
our_chattie/
├── backend/          # Node.js/Express API server (CommonJS)
│   ├── server.js              # Main server entry point
│   ├── court-analysis/        # Analysis pipeline
│   │   ├── pipeline.js
│   │   ├── agents/             # analysis-agent, download-agent (Gemini extraction, downloads)
│   │   ├── reasoning/          # moneyFlow, propertyFlow, reconciliation, grounding,
│   │   │   │                  # currencyConversion, citationGraph, findingProvenance,
│   │   │   │                  # retriever/reranker/verifier, reportService (orchestrator)
│   │   │   └── eval/           # offline reasoning-quality eval lane
│   │   └── utils/               # scanDepth, entryDisplayId, queryClassifier, ...
│   ├── scraper/               # Web scraping logic (Puppeteer + CSV export discovery)
│   ├── services/              # External service integrations (incl. localStore.js — run persistence)
│   ├── helpers/               # Utility functions (geminiConfig, geminiRetry, analysisStage, ...)
│   └── tests/                 # Jest test suite
├── simple-chat/      # React frontend application (ES6) — court-analysis
│   │                  # dashboard only; the chat surface was removed.
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard/      # Court-analysis run list + detail UI (the entire app)
│   │   │   │   ├── AnalysisRunDetailPage.jsx    # Run detail: narrative, flows, telemetry
│   │   │   │   ├── AnalysisReportAnnex.jsx      # Structured findings/conflicts/open questions
│   │   │   │   ├── AnalysisFlowsSection.jsx     # Money/property flow + value-change timelines
│   │   │   │   ├── AnalysisReasoningTelemetry.jsx # Retrieval/rerank provenance (query→match detail)
│   │   │   │   ├── AnalysisCitationList.jsx     # Per-finding citations + retrievedBy links
│   │   │   │   ├── RunsTable.jsx / RunsCardList.jsx / NewAnalysisModal.jsx
│   │   │   │   └── ...
│   │   │   ├── ErrorBoundary.jsx
│   │   │   ├── MermaidDiagram.jsx    # Renders mermaid code blocks in report markdown
│   │   │   └── AboutUs.jsx / PrivacyPolicy.jsx   # Static pages
│   │   ├── hooks/
│   │   │   ├── useAnalysisRunDetail.js   # SSE-with-polling-fallback run/event state
│   │   │   ├── useAnalysisRunStream.js   # Raw SSE connection
│   │   │   ├── useCourtAnalysisStream.js # Submits a new analysis request
│   │   │   ├── useAnalysisRuns.js        # Run list (dashboard)
│   │   │   └── useSettings.js
│   │   └── lib/                # apiClient, env
```

## Build/Lint/Test Commands

### Backend (run from `backend/` directory)
- **Development**: `npm run dev` (uses nodemon server.js)
- **Production**: `npm run prod` or `npm start`
- **Testing**: `npm test` (Jest, 60s timeout for Puppeteer tests)
- **Test lanes**: `npm run test:unit` (default, no live services),
  `npm run test:integration` / `npm run test:e2e:smoke` (Puppeteer-gated),
  `npm run test:nightly-live` (hits live e-Oglasna + Gemini — never run
  casually, CI-nightly only)

### Frontend (run from `simple-chat/` directory)
- **Development**: `npm start` (Vite) or `npm run cra:start` (CRA)
- **Build**: `npm run build` (Vite) or `npm run cra:build` (CRA)
- **Testing**: `npm test` or `npm run test:unit`

## Key Integration Points

- **Google Generative AI**: role-based models via LangChain, centralized in
  `backend/helpers/geminiConfig.js` (`GEMINI_ROLE_CONFIG`). Document-reading
  roles default to the configured full model; bounded JSON tasks use the lite
  model where appropriate. `GEMINI_MODEL` overrides role defaults. Provider
  limits, token pricing, and wrapper support are version-sensitive: verify them
  against the installed client and current provider documentation rather than
  relying on an old guide.
- **SSE Streaming**: `backend/helpers/sse.js` builds events; must use
  `data: {...}\n\n` format exactly for the frontend parser
  (`useAnalysisRunStream.js`) to detect message boundaries. Used for live
  analysis run progress, with a polling fallback (see Architectural Ethos).
- **Generated diagrams**: Mermaid and the visualizer role were removed. Do
  not reintroduce model-authored diagrams or graph libraries without explicit
  product approval and a grounded, accessible data contract.

## Court-Analysis Pipeline Notes

The sub-sections below are carried forward from a series of deleted specs
(each shipped its own spec/ticket-breakdown doc, deleted once implemented
and shipped on the branch) covering the discovery/change-detection,
grounding/property-flow, identity/currency/provenance, and original
reasoning-engine work. These are the generalizable lessons worth keeping
visible for future work in `backend/scraper/` and
`backend/court-analysis/`.

### Discovery & Data-Integrity

1. **"Never fail a run" is a load-bearing project-wide philosophy, not a
   one-off choice.** Every acquisition layer (download cache, OCR cache, CSV
   export, change-detection snapshots) follows the same shape: on a transient
   failure, log the reason, degrade to a fallback or a friendly Croatian error,
   and never let one flaky external call abort an entire run when a partial or
   cached result could still serve the user. Any new acquisition/integration
   point should default to this pattern unless there's a specific reason not
   to.
2. **Discovery completeness must never silently become unbounded analysis
   depth.** A discovery source can (and increasingly does, via the CSV export)
   return far more raw entries than should ever be downloaded/analyzed in one
   run. Always bound *analysis scope* (documents actually downloaded, OCR'd,
   and sent to Gemini) independently of *discovery scope* (how much was found
   / how accurate the grouping and totals are) — conflating the two either
   starves cluster-identification accuracy or silently explodes quota spend.
   See `backend/court-analysis/utils/scanDepth.js` for the current
   entry-count-based embodiment of this principle.
3. **Raw timestamps from external sources are a classic silent-corruption
   trap.** The e-Oglasna CSV export emits Croatian local wall-clock time with
   no timezone designator (`dd.mm.yyyy. HH:mm:ss`). Naively parsing the full
   datetime and letting `Date.parse`/`new Date()` interpret it in the host's
   timezone can shift the calendar day for early-morning timestamps depending
   on where the code runs. The fix is to normalize to a **date-only** ISO 8601
   string (discarding the time component) before it touches any date-span,
   recency, or ordering logic — date-only ISO parses as UTC midnight per spec,
   so the source day survives regardless of host timezone. Treat any new
   external timestamp source with the same suspicion until proven otherwise.
4. **Identifiers that look similar are not always the same identity.**
   Croatian case numbers can carry a register prefix (`4 St-2/2013` vs
   `St-2/2013`) that must be preserved as a *distinct* grouping key, not
   normalized away. When adding any new identity/dedup/grouping logic, verify
   against real, messy identifiers before assuming a simple string-equality or
   fuzzy-match rule is safe.
5. **A cheap metadata-only change signal is a real tradeoff, not a free
   lunch.** Change detection deliberately compares filenames + page counts
   instead of document content, specifically to avoid downloading anything.
   This is fragile against generic, frequently-repeated filenames (real
   e-Oglasna data has many literal `Podnesak.pdf`/`Prilog.pdf` entries) — a
   real content change that happens to keep the same filename and page count
   is invisible to this signal. Accepted deliberately for now; if this proves
   insufficient in practice, the next lever is byte-level hashing, which
   requires downloading and should not be reached for reflexively.
6. **A discovery/acquisition source's own completeness can outstrip what
   downstream code was ever tested against.** When a new acquisition path
   returns dramatically more data than the old one did by construction (CSV's
   "everything in one GET" vs. Puppeteer's slow page-by-page crawl), audit
   every downstream consumer's bounding/truncation assumptions explicitly —
   don't assume old caps translate correctly to the new scale.

### Grounding & Property-Flow Extraction

1. **Verify extraction against source text deterministically, at extraction
   time.** `backend/court-analysis/reasoning/grounding.js`
   (`isQuoteGrounded`/`applyGroundingToAnalysis`) checks each claim's verbatim
   `quote` against its own document's raw text via `normalizeText` +
   whitespace-collapse containment — no LLM judge. It runs in
   `analysis-agent.js` immediately after each per-document `analysis` call.
   Empty/missing quotes mean "pre-migration," never a crash: they mark
   `grounded: false`. Ungrounded claims degrade (digest synthesis tier,
   UI-visible marker), never fail a run.
2. **Money-flow-shaped problems deserve money-flow-shaped modules.** Property
   extraction (`propertyFlow.js`: `collectPropertyFlows` /
   `reconcilePropertyFlows`) deliberately mirrors `moneyFlow.js` /
   `reconcileMoneyFlows` grouping + conflict shape, so reconciliation output
   merges into the single `pkg.reconciliation → meta → report.conflicts`
   ownership chain. When adding a third structured surface, copy this pattern
   instead of inventing a new one.
3. **Lifecycle chains are not conflicts — but only when the link is explicit.**
   `tražbina` entries carry `eventType` (`prijava | ustup | namirenje |
   drugo`) and a model-populated `supersedes` reference. Resolution tries the
   stable per-run id (`prop-N`) first, then the real registry/filing
   identifiers (see "Identity, Currency & Provenance" below), then
   normalized-description containment last; unresolvable references degrade
   to standalone, never an error. Only entries joined by a resolving chain
   become a value-change timeline; unlinked competing claims on the same
   receivable are genuine conflicts.
4. **Schema growth costs output tokens — budget for it.** The `quote` +
   `propertyFlow` extension raised the `analysis` role cap to
   `maxOutputTokens: 12288` (`backend/helpers/geminiConfig.js`); a dense-doc
   headroom test in `propertyFlow.test.js` guards the truncation failure mode
   previously seen on the `synthesis` role. Any future per-document schema
   addition must re-check this cap the same way.
5. **Coverage signals belong in both coverage objects and in the UI.**
   `groundedClaims`/`totalClaims` are computed in both the analysis-agent
   batch coverage and the evidence-package cluster coverage, and surfaced via
   `AnalysisCoverageBanner` ("X/Y navoda potvrđeno u izvornom tekstu") +
   `AnalysisFlowsSection` ("Tijek novca" / "Tijek imovine" / value-change
   timelines, each hidden when empty, with inline "⚠ nepotvrđeno" markers).
   Internal-only metadata rots; if a signal matters, render it.
6. **Grounding is forward-only.** There is deliberately no backfill machinery
   and no retroactive re-verification of cached/frozen analyses.
7. **Preserve local extraction across long documents.** The 25,000-character
   threshold in `analysis-agent.js` triggers chunking; it is not a text cutoff.
   Analyze every extracted chunk, and retain each fact's chunk ID, source
   offsets, and page numbers. Only collapse an exact repeated fact when its
   verbatim quote falls inside the actual overlap between chunks. OCR page
   limits remain explicit truncation; extraction truncation and failed chunks
   must set partial coverage and appear in `AnalysisCoverageBanner`. Do not
   silently sample extracted text to fit a prompt; bound provider concurrency
   separately from text coverage.
8. **Spread fixed report claim budgets across time.** The chronological
   synthesis claim list must not be cut to a positional prefix: distribute
   full-cited claim slots across the chronology so later filings retain a
   chance to inform the report.

### Identity, Currency & Provenance

1. **Extract the identifiers the source documents already give you before
   inventing fuzzy matching.** Croatian court filings carry stable
   identifiers as a matter of course: a `poslovni broj` per filing, a `redni
   broj` in the claim register, explicit party OIBs tagged with explicit
   legal roles, and an explicit `isplatni red` (payment-priority rank).
   `resolveSupersedesTarget` (`propertyFlow.js`) tries these real identifiers
   (`claimRegistryNumber`, `filingReference`) first and only falls back to
   normalized-description containment when no identifier is present. Any
   future lifecycle/identity resolution should default to this order, not
   the reverse.
2. **Currency conversion is a fixed-rate deterministic computation, never a
   model-guessed one.** Croatia's HRK→EUR conversion was a fixed legal rate
   (1 EUR = 7.53450 HRK), not floating — `currencyConversion.js` does this in
   code. When a source states both currencies for the same figure, the
   EUR-stated figure wins outright for all downstream math; a mismatch
   beyond tolerance (relative + absolute floor, to avoid flagging normal
   filing rounding) is surfaced as its own reconciliation question, never
   silently averaged. All arithmetic in `reconciliation.js` runs on the
   EUR-consolidated field, never on raw mixed-currency values — mixing
   HRK/EUR sums directly caused a real production bug (billion-scale
   nonsense totals) before this was fixed.
3. **A citation/reference field is only useful if something asks for it.**
   `moneyFlow.js`'s `from`/`to` fields existed in the normalization code for
   a full cycle before the extraction prompt ever asked the model for
   payer/recipient identity — the plumbing was silently dead the whole time.
   When adding a new structured field to a reconciliation/flow module, verify
   the extraction prompt actually requests it in the same change, not as a
   "later" follow-up.
4. **Provenance has two ends, and they're both worth keeping.** Grounding
   (`grounding.js`) proves a claim matches its own source document; retrieval
   telemetry (`findingProvenance.js`'s `annotateFindingsWithRetrieval`) proves
   *why that document was in scope* for the report in the first place (which
   query, what score, what reasons). Persisting only the aggregate counts and
   discarding the per-match detail (`reasons`, snippet, score) makes the
   pipeline unauditable after the fact — `reportService.js`'s
   `stripRetrievalText` now keeps a trimmed-but-real record per match
   (bounded snippet length) specifically so this stays inspectable.
5. **Golden fixture tests against real, hand-verified source text catch more
   than synthetic fixtures.** `tests/reasoning/kerumGolden.test.js` freezes
   real `pdfjs` extraction output from real case documents
   (`tests/fixtures/real-documents/.../extracted/`, with a documented
   regeneration command) and asserts against ground truth read directly from
   the PDFs (a specific OIB pair, a specific `redni broj`, a specific
   dual-currency amount). This caught schema/shape issues a synthetic
   `{amount: 100, currency: 'EUR'}` fixture never would have exercised.
6. **A single duplicated rendering surface is worse than a missing one.**
   Findings were briefly rendered twice — once baked into free-text narrative
   prose, once in the structured findings annex — before `composeOverviewMarkdown`
   was changed to omit findings entirely and leave the structured annex
   (`AnalysisReportAnnex`) as the single canonical findings surface. When a
   structured and a prose surface exist for the same data, pick exactly one
   owner; don't let both render it.
7. **A disappointing production run becomes a deterministic replay test.**
   Capture only the minimal, non-sensitive metadata and normalized extracted
   facts needed to reproduce the failure in `tests/fixtures/replays/`, then
   add a `tests/replays/<case>Replay.test.js` that runs the real normalizer /
   reconciliation / report boundary. Do not commit court PDFs, raw full-run
   dumps, or credentials. `kerum-66124057408` is the reference replay for
   incomplete coverage, degraded reranking, and source-currency-preserving
   reconciliation output; run it with `npx jest tests/replays/kerumReplay.test.js --runInBand`.

### Reasoning Engine Conventions

Durable rules from the original reasoning-engine spec (deleted after Epics
A–F shipped) that still bind future work.

1. **Test-first with fixtures, in the right lane.** Every behavior change
   starts with a failing fixture-backed (or deterministic-input) test —
   discovery changes need frozen fixtures, reasoning changes need
   cluster-scoped regression checks — and CI/local regression must never
   depend on live scraping. Run `test:unit` by default; `test:nightly-live`
   is CI-nightly only.
2. **Compatibility is an adapter, not a quality target.** Preserve persisted
   report/UI contracts and tolerate older extraction shapes at system
   boundaries, but do not make legacy fixture parity the definition of a
   correct legal analysis. New reasoning should use the canonical structured
   fact ledger, filing-level provenance, and explicit coverage signals;
   legacy `moneyFlow`/`propertyFlow` shapes are output adapters during the
   migration. Golden/replay assertions must prefer source-grounded facts,
   raw value/currency, row counts, lifecycle links, and named coverage gaps
   over reproducing a historically poor narrative or finding list.
3. **The backend owns query-type truth.** `backend/court-analysis/utils/queryClassifier.js`
   (`oib | case_number | text`) is the single authority. The frontend regex in
   `useCourtAnalysisStream.js` is a request hint only — display labels, stream
   handling, and run history must use the backend-resolved/persisted
   `query.type` (`Predmet`/`OIB`/`Tekst`), never re-classify client-side.
4. **Don't split the scraper for purity.** `courtSearchPuppeteer.js` stays the
   browser/session adapter; harvest discovery/expansion logic out into a
   dedicated module only when keeping it inline would further couple browser
   control with acquisition metadata/provenance. (The CSV era —
   `discoveryClient.js` + `csvExportClient.js` as primary path — changed the
   landscape but not the rule.)
5. **Discovery order and presentation order are separate concerns, and both
   are now deliberate.** Discovery/download budgeting (`csvExportClient.js`,
   `scanDepth.js`) stays newest-first-with-an-oldest-tail on purpose, so a
   bounded scan-depth quota favors current case state. But what actually
   reaches the model in `synthesizer.js` (`timeline`, and the merged
   `claims` built in `createReasoningEvidenceFromPackage`) is deliberately
   re-sorted chronologically (oldest-first, via `sortClaimsChronologically`/
   `buildTimeline`) so the narrative builds understanding forward in time
   instead of starting mid-story — this matters most on partial-data runs
   (truncated scan depth, missing documents). One known side effect to watch
   in real runs: `synthesisInputBuilder.js`'s `FULL_CLAIM_LIMIT` (12) caps
   "full-cited" claims by array position, which now structurally favors the
   *earliest*-dated cited claims over the most recent ones whenever a
   cluster has more than 12. Not a bug — a natural consequence of
   chronological ordering — but if real runs show recent, load-bearing
   claims getting dropped by this cap, the fix is to make the cap
   date-aware (e.g. spread the keep-set across the timeline) rather than a
   positional prefix.
6. **The Analysis Lab is an evaluation lane, not production authority.** Run
   experiments only from frozen evidence packages or fixtures; compare variants
   only when their evidence-package hash and shared upstream inputs match. Keep
   per-variant configuration snapshots, traces, failures, and usage separate;
   an experiment is immutable and reruns create a new record. Scorecards describe
   measurable differences and never declare an automatic winner or mutate
   production defaults.

## Feature Delivery & Design Docs

Keep durable cross-cutting UI and accessibility guidance in this file. Add a
feature-specific spec or task breakdown only when the scope needs a lasting
contract beyond the implementation and tests, and keep it concise and current.
Do not create standalone HTML design documents or prototypes unless explicitly
requested.

## Knowledge Base & Historical Search (New)

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
