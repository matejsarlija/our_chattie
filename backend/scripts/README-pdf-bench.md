# Court PDF engine benchmark — operator's guide

> **Migration Status (2026-11-24):** Phases 1–6.1 and Stage 0 are complete (authoritative results in [FINAL-BENCH-SYNTHESIS-AND-MIGRATION-REPORT.md](file:///home/oxioxi/proj/our_chattie/backend/data/pdf-engine-bench/FINAL-BENCH-SYNTHESIS-AND-MIGRATION-REPORT.md)). Under [docs/road-to-100-entries-plan.md](file:///home/oxioxi/proj/our_chattie/docs/road-to-100-entries-plan.md) (`[R100-027]`–`[R100-029]`), the standalone `serve-pdf-bench-lab.js` server and HTML pages are transitioning into `backend/bench/` + `/dashboard/bench` inside the main React app. Note also that Section 0's no-PDF-slicing / no-repair rules bind *benchmark evaluation cells* so arms are scored honestly; production `Stage T0` / `Stage T` legitimately uses deterministic `pdf-lib` page-level slicing for hybrid PDFs and `15`-page OCR batch windows.

A local, explicitly-gated lab that answers one question:

> Can `z-ai/glm-5.3-flash` through OpenRouter analyze the same frozen text as
> the Gemini baseline, with comparable cost and quality?

**This is a lab, not production code.** Nothing here is imported by
`court-analysis/`. It reads production helpers (`extractTextFromFile`,
`buildAnalysisPrompt`, `quoteGrounding`) read-only so the comparison measures
the real prompt and schema instead of a lookalike.

**It never picks a winner.** Output is a table of conditions and measured
differences; choosing is a human decision.

---

## 0. Non-Negotiable Bench Guardrails (Anti-Spiral Rules)

1. **Decoupled ingestion:** Stage T freezes text; Stage A analyzes only canonical fixture text. Digital controls use local `pdf.js`; scanned documents use frozen OCR transcripts.
2. **Observability first:** Preserve model text, request metadata, and parse failures. Inspect failures before changing prompts or parsers.
3. **Text-only segmentation:** Dense text uses deterministic text chunks. Never slice a PDF into page files for Stage A.
4. **No JSON repair:** Strip Markdown code fences before parsing; do not repair malformed model output.
5. **No recovery fallbacks:** Parser failures remain visible. No binary rewrite, adaptive page parsing, or local recovery path.

---

## 1. Ingestion and analysis stages

One Stage A cell is `{canonical transcript, model, repeat}`. Stage A never sends
a PDF or image to a model. It reads only
`data/pdf-engine-bench/fixtures/transcripts/<docId>.json`, strips Markdown code
fences before parsing, and analyzes the frozen text with the shared prompt.

Stage T is separate and runs with `--stage-t` on the fixed six-document
selection: four scanned filings and two text controls. Scans are transcribed by
`local-raster`; text controls use local `pdf.js` extraction. Cloudflare and
Mistral parser outputs are retained as ingestion diagnostics. The Stage T
runner records parser text, page maps, usage, latency, cost, and failures in
each frozen fixture. A transcript under 100 characters is a parser failure and
blocks Stage A for that document.

Dense/long canonical text is split into 3,500-character chunks with 350
characters of overlap and merged deterministically with the production chunk
merger. Completed segments are checkpointed under
`data/pdf-engine-bench/checkpoints/` using SHA-256 keys derived from segment
identity/text, model, prompt hash, and request parameters. Resume reads these
files without network calls; `--no-cache` and `--force-rerun` bypass reads.
Malformed segments remain explicit extraction gaps while successful segments
are merged and coverage is reported in `analysisSegmentation`.

| Stage | Arm | Input | Purpose |
| --- | --- | --- | --- |
| T | `local-text` | embedded PDF text | free control for digital documents |
| T | `local-raster` | rendered page images | OCR transcript for scanned documents |
| T | `or-cloudflare` | original PDF | parser diagnostic |
| T | `or-mistral-ocr` | original PDF | parser diagnostic; page fee may apply |
| A | `local-text` | canonical frozen transcript only | same analysis prompt for every model |

Cloudflare and Mistral never analyze PDFs in Stage A. Stage A does not dispatch
the raw `local-raster`, native-PDF, or file-parser arms.

### Reporting

Stage T fixtures live under `data/pdf-engine-bench/fixtures/transcripts/`.
Stage A reports compare models on identical canonical text. Parser diagnostics
remain separate from analysis quality and do not select a winner.

Stage A runs two independent model requests per cell: the standard unconstrained
prompt and a second request with `response_format: { type: "json_object" }`.
`raw_parse` scores strict JSON from the unconstrained response; `structured_mode`
scores the separate constrained response; `repaired` measures only fence or
whitespace normalization of the raw response. Repair overhead is reported
separately and adds no inference cost.

---

## 2. Start the lab

```bash
cd backend
PDF_BENCH_LAB_PORT=4181 node scripts/serve-pdf-bench-lab.js
# → http://127.0.0.1:4181
```

Loopback only. It refuses non-local connections and binds to `127.0.0.1`.

Both pages (`/` and `/gold`) share one stylesheet,
scripts/pdf-bench-lab.css`, served at `/lab.css`. Change presentation there,
not in the HTML.


| Step | What it does | Costs money |
| --- | --- | --- |
| 1. Pick documents | 16-document corpus, or the fixed 3-doc smoke trio | no |
| 2. Probe model | Two tiny, explicitly approved requests to OpenRouter | May incur a small charge; separate from benchmark cap |
| 3. Dry-run | Full plan: cells, pages, parser and token estimate. No calls. | no |
| 4. Approved run | Real calls | **yes** |
| 5. Review / judge | Blinded human review, then LLM-judge calibration | **yes** (judge) |

### Gates

* `--probe` and live requests require `--approved`.
* Stage T runs only on the fixed six-document selection. Scanned documents use
  `local-raster`; digital text controls use local `pdf.js`. Cloudflare and
  Mistral outputs are retained as independent parser diagnostics.
* Run Stage T with `node scripts/benchmark-pdf-engines.js --stage-t
  --approved --max-cost=0.50`. Unknown request cost stops further paid calls;
  the report records exact reported spend.
* Stage A requires a frozen transcript fixture with at least 100 characters.
  It sends canonical text only and never dispatches raw PDFs, images, or parser
  arms. Bounded analysis chunks text at 3,500 characters with 350 overlap.
* An over-cap dry run still shows its plan. Live execution remains blocked
  unless the estimate or cap changes; the runtime spend guard remains active.
* Smoke and pilot scopes retain their existing document-selection guards.

---

## 3. Run it from the CLI

Use the CLI for Stage T ingestion and Stage A analysis. `--approved` is the single paid-call gate.

```bash
cd backend
set -a && . ./.env && set +a          # OPENROUTER_API_KEY

# Capability probe (two small requests; may incur a separate charge)
node scripts/benchmark-pdf-engines.js --models=z-ai/glm-5.3-flash --probe --approved

# Plan only — no calls, no cost
node scripts/benchmark-pdf-engines.js --scope=smoke \
  --models=z-ai/glm-5.3-flash --baseline=google/gemini-2.5-flash --dry-run

# Stage T: fixed six-document ingestion and transcript freeze
node scripts/benchmark-pdf-engines.js --stage-t --dry-run
node scripts/benchmark-pdf-engines.js --stage-t --approved --max-cost=0.50

# Paid smoke: fixed 3-doc trio, one repeat (the cheapest end-to-end check)
node scripts/benchmark-pdf-engines.js --scope=smoke \
  --models=z-ai/glm-5.3-flash --baseline=google/gemini-2.5-flash \
  --gold-dir=data/pdf-engine-bench/<goldSet>/gold \
  --max-docs=3 --max-pages=5 \
  --approved --max-cost=3.00

# Same smoke, three repeats — latency percentiles need samples
node scripts/benchmark-pdf-engines.js --scope=smoke --repeats=3 \
  --models=z-ai/glm-5.3-flash --baseline=google/gemini-2.5-flash \
  --gold-dir=data/pdf-engine-bench/<goldSet>/gold \
  --max-docs=3 --max-pages=5 \
  --approved --max-cost=3.00

# Paid pilot: the 16 curated documents
node scripts/benchmark-pdf-engines.js \
  --models=z-ai/glm-5.3-flash --baseline=google/gemini-2.5-flash \
  --max-docs=16 --max-pages=101 \
  --approved --max-cost=10.00
```

Flags:

| Flag | Meaning |
| --- | --- |
| `--baseline=<slug>` | Adds the incumbent model to Stage A on the same canonical frozen text. |
| `--pin=<model>=<Provider>` | Repeatable. Overrides the default host pin. |
| `--provider=a,b` | Fallback order for models without a pin. |
| `--allow-fallbacks` | Off by default. On, a downed host reroutes silently. |
| `--analysis-tokens=N` | Answer budget per cell. Default 16384, matching production. |
| `--reasoning=off\|low\|medium\|high\|default` | Hidden reasoning. A bare value applies to every model in the run. Repeatable. |
| `--reasoning=<model>:<level>` | Overrides one model, e.g. `--reasoning=google/gemini-2.5-flash:default`. Repeatable; an unknown model is rejected. |
| `--reasoning-tokens=N` | Extra `max_tokens` headroom reserved for reasoning when it is enabled. Default 8192. |
| `--known-parties=<text>` | Passed into `buildAnalysisPrompt`. |
| `--analysis-mode=bounded\|single` | Default `bounded`: segment dense/long source inputs and deterministically merge their JSON. `single` retains the original whole-document analysis condition. |
| `--no-cache` / `--force-rerun` | Bypass checkpoint reads and run each segment again; successful outputs still refresh checkpoints. |
| `--timeout-ms=N` | Per-request timeout. Default 300000 (5 min); `0` disables it. |
| `--debug` | Adds stack traces and inspection detail to the progress log. |
| `--verbose` | Prints request start/end events and every heartbeat to stderr; the full trace is always in `progress.log`. |
| `--concurrency=N` | Keep up to 1–4 independent cells running, refilling each slot immediately on completion. Default 1; already-running cells and multi-request raster cells may overshoot `--max-cost`. |
| `--gold-dir=<path>` | Enables gold scoring. |
| `--doc-id=<id>` / `--sample=N --seed=N` | Explicit selection. |
| `--max-docs`, `--max-pages`, `--max-cost` | Caps; required for live runs. |
| `--ignore-cost-estimate` | Skip only the estimated-cost preflight rejection. Keep `--max-cost` and all runtime spend/unknown-cost guards; does not approve paid calls. |
| `--repeats=N` | Run every planned cell N times. Default 1. Applies to smoke too. |
| `--raster-max-pages=N` | Page cap for the `local-raster` arm. Defaults to `OCR_MAX_PAGES` (20). |
| `--capability=<model>:fileNative:true` | Manual override when probing is impossible. |
| `--us-region` | Mistral US pricing ($2.2 / 1k pages) in estimates. |

Benchmark artifacts land in `data/pdf-engine-bench/<runId>/`: `run.json`,
`report.json`, `report-partial.json` on SIGINT/SIGTERM, per-cell
`analysis-<hash>.json`, and `progress.log`. Segment checkpoints live across runs
in `data/pdf-engine-bench/checkpoints/`. Gold sets use a separate `goldSetId`;
review sheets and judge triage each get their own generated directory.


Stage A cost estimates include both condition requests per segment. Stage T
cost and page maps are recorded separately in the frozen transcript fixtures
and Stage T report.

### If a run looks stuck

Live progress is written to **stderr and `progress.log`**, not stdout. Stdout
carries exactly one JSON document — the run result. By default, terminal output
shows plan, cell start/completion, retries, and a 30-second heartbeat; detailed
request lifecycle events are always in `progress.log`. Pass `--verbose` to print
every request event to stderr as well.

```
[bench 12:53:14.021] run 2026-...-867b05bd · scope=smoke · dryRun=false ...
[bench 12:53:14.480] plan · 3 document(s) · 12 analysis cell(s) · timeout=300.0s
[bench 12:53:14.482] [1/12] start · local-text · z-ai/glm-5.3-flash · 1:Podnesak.pdf · 2 page(s)
[bench 12:53:14.483] request → local-text · z-ai/... · attempt 1 · engine=text · timeout=300.0s
[bench 12:53:29.511] waiting · local-text · z-ai/... · attempt 1 · 15.0s elapsed
[bench 12:53:44.002] request ← local-text · attempt 1 · 29.5s · provider=Z.AI · $0.0041
[bench 12:53:44.005] [1/12] done · local-text · ... · 29.5s · $0.0041 · Z.AI · valid-json · 3/4 quotes grounded
```

On SIGINT or SIGTERM, completed cells are synchronously flushed to
`report-partial.json` before the process exits. The last `start`/`request →`/
`waiting` line names the exact cell in flight. `--timeout-ms` bounds each
attempt; a timeout is reported and **not retried** automatically, because the
provider may still be processing the first request. Paste `progress.log` (or
the stderr tail) when asking for help.

Slots refill independently; a slow cell no longer holds up a whole batch.
An unreported call cost still stops new cells, because a timeout does not prove
the provider stopped processing or billing. Already-running cells finish.
Failed cells print their error below the completion line. Only an expired local
deadline is labelled a configured timeout; upstream aborts retain their cause
instead. A longer `--timeout-ms` can help slow generation, but cannot guarantee
against an upstream disconnect. Do not treat it as a proven fix for missing costs.

Transport exceptions are never automatically retried, including disconnects
after HTTP 200 headers and failures before headers arrive: neither proves that
the provider did not execute or bill the request. Explicit HTTP 429/5xx
responses retain bounded retries.

Transport failures include structured diagnostics in `progress.log` (and analysis
rows in `report.json`): `awaiting-headers` versus `reading-body`, HTTP status,
request ID when supplied (`x-request-id`, otherwise `cf-ray`), the nested error
name/code/message chain, and whether the local deadline actually fired.
Request/heartbeat timings use a monotonic clock; diagnostics also retain wall
elapsed time to expose clock adjustments. Header arrival is logged separately,
so HTTP 200 followed by a body disconnect cannot look like a missing response.
These events do not include request contents or authorization headers.

### Why a slow cell is usually not the network

A benchmark cell is slow when the model *generates* a lot of tokens, not when
the connection stalls. Reasoning tokens are billed as completion tokens and, on
Chat Completions, count against `max_tokens`. A thinking model can therefore
spend the whole budget before writing any JSON: the response comes back with
`finish_reason: "length"`, empty content, and a bill for the reasoning.

For each Stage A cell, inspect its recorded token usage, latency, and finish
reason. Compare models only when they receive the same canonical transcript;
Stage T parser costs and latency are reported separately.

Controls:

* `--reasoning=off` removes the hidden reasoning (OpenRouter `reasoning.enabled:
  false`); `low`/`medium`/`high` cap its effort instead.
* When reasoning is left on, `--reasoning-tokens` (default 8192) is **added** to
  `max_tokens`, so the answer keeps the full `--analysis-tokens` budget and is
  not truncated.
* Unless reasoning is `off`, the dry-run estimate budgets the whole output cap
  per cell, because a thinking model may spend all of it.

#### Set reasoning per model, not per run

A bare `--reasoning=<level>` applies to *every* model in the run, baseline
included. That is sometimes what you want and sometimes a silent condition
change — the flag cannot tell which:

Historical native-PDF timing data is not comparable to current Stage A results:
Stage A now analyzes canonical text for every model. Compare current reports
under the same reasoning settings rather than carrying forward native-file
benchmarks.
Gemini does not think by default, so `low` switches thinking *on*; `off` pins
the non-thinking condition explicitly. GLM is the opposite — it thinks unless
told not to. Use `--reasoning=<model>:<level>` when the two models should not
share a condition:

```bash
# GLM at low effort, Gemini explicitly not thinking
node scripts/benchmark-pdf-engines.js --scope=smoke --repeats=3 \
  --models=z-ai/glm-5.3-flash --baseline=google/gemini-2.5-flash \
  --reasoning=off --reasoning=z-ai/glm-5.3-flash:low \
  --max-docs=3 --max-pages=5 --max-cost=0.75 --approved
```

`--reasoning=off` on the baseline is a deliberate departure from production
(it is the fast, cheap, non-thinking condition), and the runner warns about it.
Pass `--reasoning=google/gemini-2.5-flash:default` instead when the reference
must stay the production condition. Either way the resolved level is logged per
model (`reasoning · <model>=<level>`) and recorded in `run.json`, so the
condition a report was produced under is readable after the fact instead of
being inferred from latency.

Re-run one cell instead of the matrix while diagnosing:

```bash
node scripts/benchmark-pdf-engines.js --scope=pilot \
  --models=z-ai/glm-5.3-flash --arms=local-text \
  --doc-id="1:Podnesak.pdf" --max-docs=1 --max-pages=2 --max-cost=0.05 \
  --reasoning=off --approved
```

### Provider pinning is a measurement decision

A model id is served by many hosts with different quantization. For
`z-ai/glm-5.3-flash` alone OpenRouter lists 40+ endpoints, including
`relace/fp4`, `z-ai/fp8`, `wafer/nvfp4`. Unpinned, "the arm" quietly changes
weights between runs, and a host-side 429 looks like a parser failure.

Defaults: GLM → `Z.AI`, Gemini → `Google AI Studio`, `allow_fallbacks: false`.
The pinned host is recorded in `run.json` under `pins`. Pinning also changes the
*price*: the same model can be $0.03/M on a cheap `fp4` host and $0.15/M on
first-party `Z.AI`. `MODEL_PRICES` in `benchmark-pdf-engines.js` carries the
pinned-host price, so a dry-run estimate does not hide that 5x difference.

---

## 4. Gold facts

Gold is **ground truth**, not opinion. It is the only thing that turns an
analysis cell into a precision/recall number.

It is distinct from:

* **human review** — "is this output usable?" verdicts, blinded;
* **judge calibration** — checking the LLM judge against those verdicts.

### Build the templates

Lab → *Build gold templates* (or `node scripts/build-gold-template.js`). The
command returns a `goldSetId` (not a benchmark run ID) and writes one JSON per
document at `data/pdf-engine-bench/<goldSetId>/gold/<sha256(docId)[:16]>.json`.
Each invocation creates a new set; it does not merge into an existing one.

### Fill them

Lab → *Edit gold facts*, or directly:

```
http://127.0.0.1:4181/gold?set=<goldSetId>
```

To continue an existing set, open it in the editor rather than building new
templates. The lab's **Verified answer key · gold set** selector shows saved
sets and how many selected documents have complete gold. **Back to the lab**
preserves the selected set. A custom folder path overrides the selector.

Pending suggestions are bound to the document that requested them. Unsaved
drafts survive document switches within the open page; they are not durable
across reloads. The page warns before leaving with drafts. During saving,
document navigation is locked but editing can continue; newer edits remain
explicitly unsaved when the earlier version finishes saving.

The editor shows the rendered source page next to the fact ledger:

* amounts (`rawValue` + `EUR`/`HRK`, stored canonically),
* OIBs with their legal role (`vjerovnik`, `dužnik`, …),
* dates, filing numbers (`poslovni broj`),
* decision outcome,
* itemized tables: one entry per table, with the table name and its count of
  **data rows** (exclude headings and the UKUPNO/total row). The individual line
  amounts belong under **Amounts**, not in the table entry. Example: table
  `Prafakturiranje odvjetničkog troška`, 2 data rows, plus amounts
  `67.320,00 EUR`, `16.830,00 EUR`, and `84.150,00 EUR` (the printed total).
  The row count is the only table signal scored today; there is deliberately no
  cell-by-cell table editor.

Copy what is **actually printed**. Do not normalize, translate, or "fix" the
source — `scoreGold` canonicalizes both sides itself.

#### How each category is matched

* **Amounts** are compared as `number|currency`, so `1.397,50 EUR` and
  `1.397,50 HRK` are different facts. A dual-currency line (`185,48 €
  (1.397,50 kn)`) is two entries with two currencies.
* **OIBs** are compared **by value only**. Gold stores the legal role printed in
  the document (`Stečajni dužnik`); extraction reports a flow side
  (`payer`/`recipient`). Those role vocabularies never intersect, so comparing
  them scored every real match as a miss. Only 11-digit values count; spaces and
  separators are stripped first.
* **Dates** accept Croatian `dd.mm.yyyy.`, `11. svibnja 2022.g.`, dotted ISO, and
  model-emitted ISO.
* **Filing numbers** preserve the register prefix (`4 St-2/2013` ≠ `St-2/2013`).
* **Decision outcomes** compare a shared vocabulary: `odbija se` matches
  `rejected`, while `odbacuje se` matches `dismissed`. Saved source wording is
  preserved. Unknown or ambiguous wording is not silently treated as equivalent.
* **Table row counts** are structural: only the number of data rows is scored.

The production extraction schema includes `documentParties` with party OIBs,
so flow-free documents can express identifiers too. OIB scores still compare
identifier values only, not whether the model assigned the correct party role.
Document-party grounding requires the identifier itself in the supporting
quote and source; a quote about a different OIB is not sufficient.

Saving is free and offline. Pages render locally with `pdfjs`. Optional AI
assistance sends only the selected PDF to OpenRouter; Gemini 3.7 Flash is pinned
to Google AI Studio and returns an unsaved suggestion with page quotes. The
suggestion must be applied and saved as a draft before it changes the editor;
it never marks a category reviewed. Writes are atomic (`tmp` + rename), mode
`0600`, confined to `<goldSetId>/gold/`.

### AI draft suggestions

In `/gold`, open **Suggest a draft with Gemini 3.7 Flash** for the selected
document. One PDF of at most 12 pages is sent per request. OpenRouter metadata
must declare native file input. The request disables fallback providers and
data collection, caps output at 4096 tokens, and reports the provider-reported
cost when available. Model-cited page quotes are advisory, not deterministically
verified. Review each fact against the rendered source before applying it.

Applying suggestions only fills an unsaved draft. Editing a category clears
that category's review check. To mark a template complete, explicitly review
all six categories (`amounts`, `oibs`, `dates`, `filingNumbers`,
`decisionOutcome`, and `tables`), including categories with no facts. A fully
reviewed document may legitimately contain zero facts. The suggestion model is
for gold authoring only; it is not the Gemini control in the benchmark.

### Completion is all-or-nothing

A template counts only when `factsComplete: true` and all six source-review
categories are recorded. This distinguishes a confirmed-empty category from
unreviewed work. The editor refuses half-filled rows (blank amount value, OIB
not 11 digits, table row count missing or not a whole number) rather than
storing junk.

```bash
# Score a whole run against a gold folder
node scripts/score-gold.js --gold-dir=data/pdf-engine-bench/<goldSetId>/gold \
                           --report=data/pdf-engine-bench/<runId>/report.json

# Score one document
node scripts/score-gold.js --gold=<template.json> --extraction=<extraction.json>
```

Templates without `factsComplete: true` and all six review categories are
skipped, not scored as zero. Older templates with a completion flag but no
review coverage must be re-reviewed before scoring.
Matching is set-based after canonicalization, so duplicate identical amounts
collapse. Tables are row-count-only.

### Which documents need gold first

1. The smoke trio: `1:Podnesak.pdf`, the Adria invoice (image-only), and
   `10:Troškovnik.pdf` (itemized table). That set separates "GLM can emit JSON"
   from "the path can read a scan and a cost schedule".
2. Then 2–3 dense text-layer stress documents (`Diobeni popis`, `Završni
   račun`, the assignment agreement).
3. Then the remaining image-only exhibits if the decision is about replacing
   Gemini OCR, not only the analysis role.

## 5. Human review and judge

Build an offline blinded sheet from a completed benchmark report:

```bash
node scripts/build-review-sheet.js \
  --report=data/pdf-engine-bench/<runId>/report.json \
  --sample=3 --seed=7
```

The sheet rehydrates Stage-A analysis answers from their per-cell artifacts,
shows source-page images, and hides model/arm names behind deterministic
candidate labels. Selection prioritizes gold-amount recall disagreement,
recorded failures, and latency outliers, then adds a seeded stratified sample.
Token highlights are navigation aids, not correctness judgments.

The optional CLI judge compares two full candidate answers for the same source
pages (one by default, up to three with `--image-pages`), swaps presentation order, and writes triage only.
It must use a model family different from every model in the report, and image
capability must already be confirmed by probe or manual override. Give it
explicit finite document, page, and cost caps matching the report selection:

```bash
node scripts/judge-review.js --judge \
  --report=data/pdf-engine-bench/<smokeRunId>/report.json \
  --judge-model=<different-family/model> \
  --image-pages=3 \
  --max-docs=3 --max-pages=5 --max-cost=0.25 --approved
```

To calibrate judge preferences against the blinded human verdicts, use
`--calibrate=<judge-triage.json> --verdicts=<human-verdicts.json>
--answer-key=<answer-key.json>`. Calibration reports agreement only. Neither
the judge nor human review replaces deterministic gold scoring or selects a
production winner.

---

## 6. Capability probes are honest

A probe only proves a capability *absent* when the provider actually answered
about the input.

Auth, billing, rate-limit, timeout and transport failures store **`null` —
unknown**, never `false`:

```json
{ "capabilities": { "fileNative": null, "imageInput": null },
  "details": { "fileNative": { "status": 402, "note": "Capability unknown: …" } } }
```

A cached `null` does not shadow a metadata hint, does not claim `source: probe`,
and makes the next run probe again.

When the model's declared `input_modalities` answer the question, the note says
so instead of hedging:

* metadata has no `file` → *"The rejection is expected, not a routing
  artifact."* (this is the GLM Flash case: `["text","image","video"]`);
* metadata **does** declare the modality but the routed provider rejected the
  body → capability stays `null` with *"pin a provider and re-probe"*, because
  that is a host bug, not a model limit.

---

## 7. Tests

```bash
cd backend
npx jest tests/pdf-benchmark --runInBand     # offline regression tests; no live calls
```

No test in this lane touches the network. Live lanes (`test:nightly-live`) are
CI-nightly only.

---

## 8. Known limits

* **Stage T is ingestion, not analysis.** Cloudflare and Mistral parser output
  is diagnostic; scanned documents use local-raster OCR as their canonical
  transcript, while text controls use local `pdf.js`.
* **Stage A compares models on identical frozen text.** It does not send PDFs
  or images and skips documents whose canonical transcript is under 100
  characters or marked incomplete.
* **Gold columns appear only when gold is scored.** Without verified gold the
  decision table shows one `Gold` column reading "no gold" / "not verified" —
  never a row of `—`, which would read as a measured zero.
* **"Valid JSON" is measured among answered calls.** A transport failure is
  counted under `Failed`, not as the model emitting invalid JSON. Truncation is
  still a model failure and stays in the invalid count.
* The amount metric counts bare integers, so a page number can score as an
  amount.
* The judge is CLI-only. Human review selection uses gold-score disagreement
  when complete gold exists; without gold it falls back to failures, latency,
  and seeded sampling.
* Cost is checked when an analysis cell returns — a single request, concurrent
  calls, or a multi-request raster cell can exceed the cap.
* `usage.cost` is the reported total for the OpenRouter request. Mistral's
  per-page parser-fee estimate is used only when request cost is missing; it is
  not added on top of an available reported total.
* **Gold scores compare fact sets, not relationships.** Perfect amount/OIB
  scores do not prove correct creditor-to-amount associations. Table row count
  is only structural, not proof that the rows are right. Manually review these
  associations and procedural conclusions on the shortlisted systems.
* **Quote matching is not fact coverage.** Only supplied, nonblank quotes enter
  its denominator. A high rate does not establish that all facts have evidence.
* Parser date comparisons normalize equivalent numeric, ISO and Croatian
  month-name spellings; scan-only fields with no reference stay unmeasured.

---

## 9. Status

This lab supports document-quality comparison, not production migration or a
100-entry load guarantee. Production still uses Google clients. Before a paid
pilot, verify the selected gold set and inspect a no-cost plan. Before switching
providers, exercise the actual OpenRouter-enabled production pipeline on a
varied batch, including long documents, scans, timeouts, rate limits and restart
behavior. Measure extraction, repair, synthesis and verification costs together.
