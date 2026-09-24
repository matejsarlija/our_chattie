# Ticket Breakdown: Analysis Lab

Companion to `analysis-lab-spec.md` (section references map to that file).
The Lab is an internal, replay-first comparison feature: three profiles consume
the same frozen evidence package; a reviewer reads the reports and their
fragments. It is not an autonomous context system, a production-path switch,
or an LLM-judging/RL feature.

Conventions: test-first and fixture-backed; `npm run test:unit` is the default
lane; no test may call a live scraper, downloader, OCR/native-PDF endpoint, or
Gemini model. Effort: S < 1d, M 1–3d, L 3–7d.

## Phase A — Reproducible input and experiment contracts (§3–4) — Effort S–M

### LA-0 Frozen evidence-package fixture + canonical digest

- Files: new `backend/court-analysis/reasoning/analysisLab/evidenceIdentity.js`,
  `backend/tests/fixtures/replays/analysis-lab/` (sanitized Kerum package), new
  `backend/tests/reasoning/analysisLab/evidenceIdentity.test.js`.
- Work: create a minimal, non-sensitive evidence-package fixture based on the
  existing Kerum replay conventions. It must contain enough cluster evidence,
  facts/flows, citations, reconciliation, scope/coverage gaps, and retrieval
  source references to exercise flat and ContextNode paths—never raw PDFs,
  full stored runs, credentials, or model output dumps. Implement a canonical
  stable JSON serializer + SHA-256 digest that sorts object keys but preserves
  meaningful array order. Export a deep-clone helper so each variant gets an
  isolated input object.
- Tests: equivalent key-order objects have the same digest; changed source
  fact/citation/order has a different digest when semantically relevant;
  mutating variant A's clone cannot alter variant B or the frozen fixture.
- Acceptance: one named Kerum fixture yields a stable documented hash and is
  sufficient to run the comparison boundary without acquisition/model calls.
- Depends: none.

### LA-1 Profile registry and immutable snapshot

- Files: new `backend/court-analysis/reasoning/analysisLab/profiles.js`, tests
  beside it; read-only helpers from `backend/helpers/geminiConfig.js` and the
  extraction/evidence schema version exports.
- Work: define exactly three built-in profiles:
  `baseline-flat-v1` (`contextStrategy: 'flat'`), `context-tree-v1`
  (`contextStrategy: 'case-context'`, node summaries disabled and zero node
  calls), and `context-tree-summarized-v1` (same DAG plus bounded summaries).
  Implement lookup/allow-list validation and
  `snapshotProfile(profile, runtimeMetadata)`, capturing profile id,
  context strategy, role model/config identifiers, relevant prompt/schema
  versions, feature flags, node budgets, and supplied code revision. Snapshot
  effective Lab execution settings too (optional-pass gates, retrieval/rerank
  settings, environment-derived limits, model ids, and generation parameters).
  Never persist mutable config objects or credentials. Do not create a
  user-editable profile system in this phase.
- Tests: unknown profile rejected; DAG-only has zero summary budget and the
  summary profile has explicit bounded budgets; snapshots have no API keys;
  later mutation of config/profile objects cannot mutate an existing snapshot; all three
  profiles retain explicit strategies and the expected summary mode.
- Acceptance: an experiment can name only the three supported profiles and has
  self-contained, serializable profile and effective execution snapshots.
- Depends: LA-0 only for shared fixture usage in tests.

### LA-2 Experiment-run persistence, separate from analysis runs

- Files: `backend/services/localStore.js` (or a focused
  `backend/services/analysisLabStore.js` using the same queued-write pattern),
  new persistence tests.
- Work: add an `experiments.json` namespace under `ANALYSIS_DATA_DIR` with
  methods to create, complete partially, list, and read immutable
  `ExperimentRun` records. Store source-run/fixture reference, evidence hash,
  input summary, profile and execution snapshots, shared upstream artifact
  hashes, variants, scorecards, traces, usage,
  timestamps, and status (`running | complete | partial | error`). Once a
  variant/report is recorded, no update may overwrite it; completion can only
  fill a previously absent variant. Do not attach experiment data to
  `runs.json`, mutate a source report, or persist raw PDFs/full prompts.
- Tests: write/read/list ordering; source-run record remains byte-equivalent;
  duplicate variant completion is rejected; a candidate failure can be stored
  while a successful baseline remains readable; queue serialization prevents
  lost writes.
- Acceptance: experiments survive a local-store restart and are isolated from
  ordinary analysis runs.
- Depends: LA-0, LA-1.

## Phase B — Context DAG, bounded summary, and report adapter (§5) — Effort M–L

### LC-1 Deterministic ContextNode index and DAG builder

- Files: new `backend/court-analysis/reasoning/caseContextBuilder.js` and
  `contextNode.js`; `backend/tests/reasoning/caseContextBuilder.test.js`.
- Work: from an immutable evidence package, deterministically construct the
  v1 graph: one `case-root`, chronological `procedural-period` nodes, and
  `claim-thread` / `property-thread` nodes only when existing stable identity
  and conservative linkage rules support them. Inputs include date, filing
  reference, claim registry number, party/OIB, document role, fact-ledger and
  flow identities, citation-graph links, and existing coverage gaps. Attach
  the same source/fact to multiple nodes where justified. Materialize
  `unresolved` nodes for ambiguous relationships instead of merging them.
  Node ids must be deterministic from kind + stable evidence identity, and the
  graph must contain no dangling links or cycles.
- Tests: fixture gives a stable DAG across repeated builds; explicitly linked
  claim lifecycle becomes one thread; generic same-description claims remain
  separate/unresolved; shared source can appear in two nodes; a changed source
  changes only affected deterministic node ids/contents; cycle/dangling-link
  guards reject invalid graph assembly.
- Acceptance: §5.2–5.3 graph shape, with no model calls and no mutation of the
  canonical evidence package or existing reconciliation output.
- Depends: LA-0.

### LC-2 Bounded node-summary service with citation validation

- Files: new `backend/court-analysis/reasoning/contextNodeSummary.js`; role
  configuration/prompt version entry in `backend/helpers/geminiConfig.js` if
  required; tests with mocked model responses.
- Work: build a compact, bounded source packet for an eligible node and invoke
  a dedicated summary role/prompt. Use structured summary statements, each
  carrying source/citation ids. Validate those ids against the node’s evidence
  and retain original source references alongside each statement. ID membership
  is not a grounding proof: summaries are derived context only and cannot
  independently support report findings; findings must cite original evidence.
  Limit calls and
  nodes via profile budgets. Summary failure, timeout, malformed output, or
  invalid citation produces `status: 'partial'` plus trace/gap metadata and
  retains the raw node—never fails the experiment and never falls back to an
  invented summary. There is no model-directed child discovery or recursion.
- Tests: valid citation ids accepted as references but not treated as grounding;
  unknown citation rejected/partial; report findings require original evidence;
  malformed/timeout response preserves raw node; node cap means deterministic
  omitted-node reason; tracker/onUsage receives calls exactly once per
  summarized node.
- Acceptance: every model-derived node summary is inspectable and bounded;
  deterministic node construction works with node summaries disabled.
- Depends: LC-1, LA-1.

### LC-3 Context-tree report-input adapter

- Files: `backend/court-analysis/reasoning/reportService.js`,
  `backend/court-analysis/reasoning/synthesisInputBuilder.js`, new adapter
  module/tests; preserve public `generateClusterReport` signature.
- Work: add a profile-aware adapter immediately before synthesis-input
  assembly. `baseline-flat-v1` calls the current flat `buildSynthesisInput`
  path unchanged. Both context profiles build the same DAG; only
  `context-tree-summarized-v1` summarizes bounded nodes. The context profiles
  then construct report input from selected root/child
  nodes plus the same chronology, retrieval/rerank provenance, reconciliation,
  and scope data. The report writer receives original claims/citations as well
  as node summaries, with summaries marked derived and never sufficient alone
  to support a finding. Existing deterministic flow/currency/identity and scope
  results remain owned by their current modules. Return a bounded trace of the
  selected/omitted evidence and node outcomes.
- Tests: baseline replay parity (same mocked report input/output as the old
  path); candidate trace includes graph and source references; profile adapter
  never changes the supplied package; node-summary failure still produces a
  candidate report with partial trace; report input contains no unsupported
  model-only claim.
- Acceptance: deleting/bypassing the adapter restores the baseline without a
  package migration, persisted-run format change, or frontend breakage.
- Depends: LA-1, LC-1; LC-2 for model summary mode (adapter works without it).

## Phase C — Fair execution and deterministic comparison (§4, §6, §8) — Effort M

### LE-1 Analysis Lab comparison orchestrator

- Files: new `backend/court-analysis/reasoning/analysisLab/runExperiment.js`,
  `backend/court-analysis/reasoning/reportService.js` integration points,
  `backend/tests/reasoning/analysisLab/runExperiment.test.js`.
- Work: accept only a frozen evidence package/reference plus the three built-in
  profiles. Resolve and snapshot effective runtime settings once. Run
  retrieval, reranking, claim-judge and significance passes once against an
  isolated clone of the frozen package, snapshot/hash their outputs, then
  supply those exact artifacts to all variants. Run the deterministic DAG builder identically in
  both context lanes; only `context-tree-summarized-v1` makes bounded node
  summary calls. Disable follow-up verification in v1. Compute
  the evidence digest, deep-clone it per variant, verify all pre-run
  digests match, run variants independently, and re-check that canonical input
  is unchanged after each. Give each variant its own usage tracker, timing,
  trace collector, temporary context, and error boundary. A baseline or
  candidate error creates a `partial` experiment with the successful variant
  intact. Snapshots enable setup replay, not byte-identical model output.
  Orchestrator never invokes scraper/download/OCR; report-generation
  model calls are allowed in real Lab use but mocked in tests.
- Tests: same hash and shared-artifact hashes passed to all three variants;
  divergent/mutated input refuses to
  compare; one variant failure is isolated; distinct usage/time totals; no
  scraper/download/OCR imports/calls in fixture lane.
- Acceptance: one command/service call yields a complete or partial immutable
  comparison record from one evidence hash.
- Depends: LA-0, LA-1, LA-2, LC-3.

### LE-2 Deterministic scorecard and variant-difference view model

- Files: new `backend/court-analysis/reasoning/analysisLab/scorecard.js`,
  tests; a small `comparisonViewModel.js` only if needed by API/UI.
- Work: compute only descriptive values from variant report/trace and source
  package: input identity/counts; grounded and cited findings; unsupported or
  degraded findings; scope status/blocked conclusions; critical failures and
  OCR/native truncation; reconciliation/identity unresolved counts; selected
  source/claim/node counts; partial-node/error counts; calls/tokens/elapsed
  time. Produce labeled deltas but no composite score, ranking, or winner.
  Keep grounded source-claim count/denominator separate from report findings
  with valid citations; use those exact labels in deltas and UI data. Explicitly
  distinguish “not applicable to flat profile” from zero.
- Tests: scorecard counts are deterministic on Kerum fixture; candidate
  unresolved node is not represented as zero; missing verifier data degrades
  to `unknown`; changing variant B does not alter variant A scorecard.
- Acceptance: all §6 dimensions appear in persisted experiment data and can be
  rendered without parsing model prose.
- Depends: LE-1.

### LE-3 Persist completed comparison and expose read-only API

- Files: `backend/server.js`, Lab store/orchestrator, backend route tests,
  `simple-chat/src/lib/apiClient.js` API methods.
- Work: add authenticated/rate-limited internal endpoints for: list eligible
  frozen run/package references; create comparison; list experiments; get one
  full experiment. Creation must require all three known profile ids and reject
  arbitrary profile/model/prompt input. The full response includes reports,
  bounded traces/fragments, scorecards, and profile snapshots; list responses
  remain summary-only. Reuse existing analysis read/write limiter patterns and
  error conventions. Do not add a public “rerun live case” route.
- Tests: validation/404/authorization/limiter shape consistent with analysis
  endpoints; route creates a partial record for candidate failure; list omits
  large trace payload; source analysis run remains unchanged.
- Acceptance: frontend can load an experiment without reading JSON files and
  no endpoint permits changing canonical input or arbitrary model execution.
- Depends: LA-2, LE-1, LE-2.

## Phase D — Human-readable Analysis Lab UI (§7) — Effort M

### LU-1 Implement the approved Analysis Lab design document

- Files: reference `docs/analysis-lab/design.html`; add Dashboard components
  under `simple-chat/src/components/Dashboard/AnalysisLab/`, focused hooks
  under `simple-chat/src/hooks/`, API client methods from LE-3, and route/nav
  wiring consistent with the existing dashboard.
- Work: implement three views from the design: (1) select frozen evidence/run
  + launch all three fixed profiles; (2) synchronized baseline, DAG-only, and
  DAG-plus-summaries reports with visible labels and shared input hash; (3) deterministic
  scorecard and expandable fragment inspector. The inspector shows flat
  selected claims or ContextNode DAG entries, source/fact/citation ids,
  excerpts/snippets, grounding, omission reasons, coverage gaps, partial-node
  state, usage, and profile snapshot. Preserve defensive rendering:
  Gemini-authored markdown stays inside `ErrorBoundary`; missing optional trace
  fields render a neutral unavailable state. No winner/vote/judge controls.
  Do not introduce global context/reducer or Storybook stories.
- Tests: hook tests for create/list/detail loading and error/partial states;
  component tests for same-hash banner, visible profile labels, report panes,
  scorecard `unknown`/not-applicable states, fragment/citation expansion, and
  malformed markdown containment.
- Acceptance: a reviewer can perform §7’s five-step workflow entirely in the
  app, without reading raw persisted JSON; ordinary run-detail behavior is
  unchanged.
- Depends: LE-3, `docs/analysis-lab/design.html` (already approved).

### LU-2 Responsive and accessibility pass

- Files: Analysis Lab components/styles/tests.
- Work: desktop keeps three readable report columns; narrower widths stack them
  with explicit profile headers and retain fragment access. Use semantic tabs,
  buttons, tables and headings; keyboard-operable fragment navigation;
  focus-visible styles; readable contrast; accessible labels for hash status,
  scorecard cells, and partial/error indicators. Never rely on colour alone.
- Tests: focused DOM/accessibility assertions plus responsive class/structure
  tests following existing frontend test conventions.
- Acceptance: comparison remains usable at narrow width and by keyboard; no
  key distinction (profile, shared input, partial status) is colour-only.
- Depends: LU-1.

## Phase E — Replay acceptance and operational hardening (§9) — Effort S–M

### LQ-1 Kerum Lab replay acceptance suite

- Files: new `backend/tests/replays/analysisLabKerumReplay.test.js`, extending
  the LA-0 sanitized fixture only as necessary.
- Work: run all three profiles with deterministic/mocked model seams and assert:
  same frozen hash; baseline flat-path parity; identical deterministic DAG
  across context lanes; zero summary calls in DAG-only and bounded summary
  calls in the third lane; source-grounding counts remain identical because
  they are measured from the canonical package; cited candidate node for a
  stable lifecycle/transfer; unresolved node for ambiguous relationship;
  frozen package scope/reconciliation inputs remain byte-equivalent before and
  after each variant. Check report-time derived scope/advisory metadata
  separately and prevent it being written back into the package. Partial
  summary degradation stays visible;
  scorecard and per-variant usage persisted. Keep assertions on source ids,
  raw values/currencies, linkage classes and coverage gaps—not historical free
  prose wording.
- Acceptance: regression goes red if the candidate silently merges ambiguous
  claims, mutates evidence, loses citation provenance, or reports a different
  input identity.
- Depends: LE-2.

### LQ-2 Trace-size, redaction, and failure-mode guards

- Files: Lab trace serializer/store/API tests; server logging review.
- Work: establish explicit bounds for snippets, node count, source ids per
  node, prompt/model error text, and report/trace response payload. Redact
  secrets and never persist raw PDFs or full prompts. Confirm partial/error
  experiment records are inspectable without stack traces or provider payloads.
  Add operator-facing error codes/messages for missing frozen package, hash
  mismatch, unsupported profile, and variant failure.
- Tests: oversized trace fixture is bounded with a recorded truncation reason;
  credential-like input is redacted; partial experiment response remains
  readable; list endpoint stays summary-sized.
- Acceptance: Lab records are safe to retain locally and remain reviewable
  under failures without silently hiding the failed variant.
- Depends: LA-2, LE-3.

## Explicitly deferred

Do not add tickets for the following until the Lab produces several stable
human-reviewed comparisons:

- bounded model-suggested branch expansion / recursive ContextNode traversal;
- blind ordering, “A/B/tie” controls, or human-review persistence;
- LLM-as-judge, preference datasets, reward models, DPO/RL optimization;
- live/shadow comparisons that acquire evidence independently;
- replacing the ordinary report-generation path with either context profile.

## Suggested build order

`LA-0 → LA-1 → LA-2 → LC-1 → LC-3 → LE-1 → LE-2 → LE-3 → LU-1 → LU-2 → LQ-1 → LQ-2`.

`LC-2` may land after `LC-1` and before or alongside `LC-3`; the candidate
must remain runnable with node summaries disabled, so a delayed summary role
does not block the deterministic graph and workbench substrate.
