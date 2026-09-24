# Analysis Lab Spec: Replayable Context-Builder Comparison

Status: draft | Date: 2026-09-22 | Scope: `backend/court-analysis/`, `backend/services/`, `simple-chat/` (Dashboard)

## 1. Decision, motivation, and problem

The court-analysis pipeline has a canonical, source-grounded evidence package,
but its report path currently assembles a largely flat synthesis input. That is
a reasonable baseline, yet it can lose relationships between filings that are
far apart in time: a claim registration, later assignment, distribution, and
appeal/reversal may be individually extracted but not presented as one
auditable thread.

We want to test a narrow alternative: a derived `CaseContextBuilder` that
organizes the same evidence into cited case branches before report generation.
This is an experiment, not a declaration that recursive context construction
is inherently better.

### 1.1 Why this direction

KERUM is representative of the hard part of this product: a long-running case
fans out into many independently useful filings rather than one monolithic
document that simply does not fit into a model context. A flat map/reduce
extraction is appropriate for the first half of that problem—documents can be
read independently and deterministic code can preserve amounts, currencies,
identifiers, grounding, and provenance. It is weaker at the second half:
writing a legally useful account of how distant filings affect one another.

For example, an original claim registration, a later receivable assignment,
distribution, appeal, and reversal can all be correctly extracted but still
appear as disconnected facts when the final synthesis sees a broad,
position-limited flat claim list. The user then receives a digest rather than
an auditable account of what changed, who now holds which claim, and which
link remains uncertain.

The ContextNode idea borrows only the useful part of recursive/context-folding
approaches: preserve structured intermediate context around a bounded branch
of evidence. It does **not** make the model an autonomous researcher. Branch
selection, identity/currency logic, coverage, and the permissible evidence
set remain deterministic; model summaries stay grounded against original
sources. This is closer to a conservative, cited case outline than a general
purpose recursive agent.

The Analysis Lab comes first because plausible architecture is not evidence of
improvement. It lets us hold acquisition/extraction constant and inspect
whether a context-aware report actually improves the causal thread, current
posture, source support, and auditability enough to justify its additional
calls and complexity. Its initial human review is intentionally more valuable
than an uncalibrated LLM judge or a premature “RL signal.”

The first product need is therefore an internal **Analysis Lab**:

```text
Frozen evidence package (one hash, no new acquisition)
                  |
           +------+-------+------+
           |              |      |
      baseline-flat  context-tree  context-tree-summarized
           |              |      |
        report A        report B report C
           +------+-------+------+
                  |
   three reports + fragments + deterministic comparison
```

For this phase, a human reads all three reports and inspects the analysis/context
fragments when needed. There is deliberately no LLM judge, blind ordering,
preference dataset, reward model, RL loop, or production auto-selection.

## 2. Goals and non-goals

### Goals

- G1. Compare three report-generation profiles from the exact same frozen
  evidence package, so differences cannot be caused by scraping, download,
  OCR, discovery depth, or a changed docket.
- G2. Keep the current flat path as an explicit baseline and separate the
  deterministic ContextNode effect from the added effect of model summaries.
- G3. Let a reviewer read all three reports side by side and inspect the material
  that led to each: selected evidence, derived context nodes, citations,
  grounded claims, gaps, and deterministic reconciliation results.
- G4. Persist enough metadata to replay the comparison setup: evidence hash,
  profile/config snapshots, model and prompt/schema versions, code revision,
  usage/cost telemetry, outputs, and deterministic scorecard.
- G5. Make regressions visible without pretending that a single numeric score
  can decide legal usefulness.

### Non-goals

- N1. No change to discovery, downloading, OCR/native-PDF routing, extraction,
  grounding, fact ledger, reconciliation, or the canonical evidence-package
  schema.
- N2. No fresh/live analysis inside a comparison. The Lab accepts only an
  already persisted or fixture-backed evidence package.
- N3. No unbounded model-written recursion, arbitrary document expansion, or
  model authority to overwrite deterministic money/currency calculations.
- N4. No replacement of the ordinary analysis dashboard/report path in this
  phase; Lab runs are opt-in and offline/replay-oriented.
- N5. No LLM judging, blind pairwise voting, human-label persistence, model
  fine-tuning, RL signal, or benchmark publication yet.
- N6. No new Storybook stories. A later pure HTML design document is the UI
  design artifact.

## 3. Invariants

1. **Canonical evidence remains canonical.** `EvidencePackage` and its
   source-document/claim provenance are the only evidentiary truth. A
   `ContextNode` is recomputable derived report input, never a replacement
   ledger or a new source of legal fact.
2. **All three profiles receive the same immutable input and shared upstream
   artifacts.** The Lab refuses to compare variants whose
   `evidencePackageHash` differs.
3. **Every derived statement remains inspectable.** A context node carries
   source-document ids, claim/fact ids, quote/citation references, and coverage
   status. Summaries without evidence references are retained only as degraded
   fragments, never promoted to supported report facts.
4. **Deterministic systems retain ownership.** Reconciliation, currency
   conversion, identity resolution, scope contract, and grounding stay in
   existing code. The builder can arrange/summarize evidence; it cannot alter
   computed totals or resolve an ambiguity by assertion.
5. **Experiments are immutable.** An existing comparison stores output and
   configuration snapshots. Re-running creates a new experiment, never
   overwrites an old result.

## 4. Profiles and experiment contract

### 4.1 Profiles

A profile is a named, versioned report-construction configuration. Phase 1
ships exactly three built-ins:

| Profile | Context strategy | Purpose |
|---|---|---|
| `baseline-flat-v1` | Current `buildSynthesisInput` / flat assembly | Control: today’s report behavior |
| `context-tree-v1` | Deterministic `CaseContextBuilder` DAG, summaries disabled | Isolates the effect of organizing evidence as a DAG |
| `context-tree-summarized-v1` | Same deterministic DAG plus bounded model-written node summaries | Measures the summaries’ added effect and full candidate cost |

Each profile snapshot records at least:

```json
{
  "id": "context-tree-summarized-v1",
  "contextStrategy": "case-context",
  "modelRoles": { "synthesis": "…", "verify": "…" },
  "promptVersions": { "contextNode": "v1", "synthesis": "vCurrent" },
  "schemaVersions": { "evidence": 1, "extraction": 1 },
  "featureFlags": {},
  "budgets": { "maxContextNodes": 24, "maxNodeCalls": 4 },
  "nodeSummaries": "on",
  "codeRevision": "git SHA"
}
```

`context-tree-v1` has node summaries off and a zero node-call budget;
`context-tree-summarized-v1` enables summaries with explicit bounded node/call
budgets. The exact role/config values are snapshots, not a second configuration system.
They are read from the existing Gemini role configuration and the profile
definition once at experiment creation, then passed explicitly to all three
variants. The experiment also stores an `executionSnapshot` of effective
runtime settings that can affect output: planner, reranker, claim-judge,
significance and follow-up-verification gates; retrieval/rerank settings;
environment-derived limits; model identifiers and relevant generation
parameters; and versions for all prompts/schemas used. Secrets are excluded.
This makes the setup auditable and replayable, but not the generated text
byte-for-byte reproducible: model calls remain stochastic and provider behavior
may change.

### 4.2 Experiment run

An `ExperimentRun` is an immutable comparison record:

```json
{
  "id": "…",
  "createdAt": "ISO-8601",
  "evidencePackageRef": "saved-run-or-fixture-id",
  "evidencePackageHash": "sha256…",
  "executionSnapshot": {},
  "sharedUpstream": { "retrievalHash": "sha256…", "rerankHash": "sha256…", "advisoryHash": "sha256…" },
  "inputSummary": { "caseNumber": "St-2/2013", "documents": 57 },
  "profiles": ["baseline-flat-v1", "context-tree-v1", "context-tree-summarized-v1"],
  "variants": {
    "baseline-flat-v1": {
      "profileSnapshot": {},
      "report": {},
      "trace": {},
      "usage": {},
      "deterministicScorecard": {}
    },
    "context-tree-v1": { "profileSnapshot": {}, "report": {}, "trace": {}, "usage": {}, "deterministicScorecard": {} },
    "context-tree-summarized-v1": { "profileSnapshot": {}, "report": {}, "trace": {}, "usage": {}, "deterministicScorecard": {} }
  },
  "comparison": { "inputHashMatches": true, "createdBy": "local" }
}
```

The persistence implementation may begin in the existing local-store/run-data
area. It must use a distinct experiment namespace and must not mutate the
source analysis run or its report.

## 5. CaseContextBuilder v1

### 5.1 Boundary

`CaseContextBuilder` is an adapter between frozen shared report artifacts and
the existing report service. The comparison boundary is after shared
retrieval/reranking/advisory processing and before profile-specific context
construction:

```js
const shared = await prepareSharedReportArtifacts(evidencePackage, executionSnapshot);
const reportInput = profile.contextStrategy === 'case-context'
  ? await buildCaseContext(evidencePackage, shared, profile)
  : buildSynthesisInput(evidencePackage, shared.retrieval, shared.rerankedRetrieval);

return generateClusterReport(reportInput, {
  verification: 'standard',
  followUpVerification: 'off',
  ...executionSnapshot.reportOptions
});
```

For a fair comparison, retrieval, reranking, claim-judge and significance
passes run once against an isolated clone of the frozen package. Their outputs
are snapshotted and supplied identically to all three variants; neither the
canonical package nor its persisted source-run copy is mutated. Variants must
not rerun those passes or mutate shared artifacts. The report-service boundary must accept these
precomputed artifacts explicitly; it must not silently recompute them from
process settings. Follow-up verification is disabled for Lab runs in v1;
synthesis and ordinary report verification run per variant. The existing
flat `buildSynthesisInput` remains present and independently callable.
Disabling/removing the builder selects the baseline; it requires no
evidence-package migration or frontend contract change.

### 5.2 ContextNode shape

Nodes form a DAG, not an unconstrained conversation/agent trace. Multiple
branches may cite the same source document or ledger fact without duplicating
the source.

```ts
type ContextSummaryStatement = {
  text: string;
  sourceDocumentIds: string[];
  factIds: string[];
  citationIds: string[];
  status: 'validated-reference' | 'partial' | 'unavailable';
};

type ContextNode = {
  id: string;
  kind: 'case-root' | 'procedural-period' | 'claim-thread' | 'property-thread' | 'unresolved';
  title: string;
  summary?: ContextSummaryStatement[];
  sourceDocumentIds: string[];
  factIds: string[];
  citationIds: string[];
  childIds: string[];
  parentIds: string[];
  coverage: { groundedClaims: number; totalClaims: number; gaps: string[] };
  status: 'complete' | 'partial' | 'unresolved';
  derivedBy: { strategy: 'deterministic' | 'model'; promptVersion?: string };
};
```

`summary` is optional and is structured as statements with source/citation ids.
Citation ids are checked against node evidence, but that membership check is
not itself a grounding proof. Summaries are explicitly marked derived context;
they cannot independently support report findings. The report writer must cite
the original evidence for findings and receives those evidence references
alongside each summary. Any failed summary validation leaves the raw node
available and marks its summary partial or unavailable.

### 5.3 v1 construction policy

The first candidate is intentionally **not recursive**. It establishes the
reversible DAG seam without speculative autonomous traversal:

1. Deterministically index evidence by date, filing reference, claim registry
   number, party/OIB, document role, `propertyFlow`/fact-ledger identities,
   citation graph edges, and known coverage gaps.
2. Create a case root, chronological procedural-period nodes, and only those
   claim/property thread nodes supported by explicit identifiers or existing
   conservative linkage rules.
3. Attach the same evidence to multiple nodes where warranted. Do not merge
   competing claims merely because descriptions resemble each other.
4. Only `context-tree-summarized-v1` summarizes eligible nodes from bounded
   evidence sets, with citations required. `context-tree-v1` makes zero node
   summary calls. A summary failure leaves a partial node and its raw evidence
   available; it does not fail the experiment or the other variants.
5. Build the report input from root + selected child nodes, preserving current
   chronology and current scope/reconciliation data.

There is no `auto` branch expansion in v1. The summaries-on profile uses a
fixed, snapshotted node/call budget, and its summary cost is reported separately
from shared preprocessing and report synthesis/verification. A later phase may
add a bounded `hasMaterialUncertainty` expansion policy, but only after this
Lab can show it beats the fixed DAG and baseline on Kerum replays.

### 5.4 Candidate trace

Each context variant stores a bounded trace:

- deterministic branch-selection reasons and omitted-branch reasons;
- each ContextNode’s ids, kind, parent/child links, source/fact/citation ids,
  coverage and status;
- node input size/counts, summary/model call metadata, and failures;
- the exact report-input claims/nodes selected for synthesis.

The baseline trace stores the analogous flat selected-claim list, retrieval
provenance, source coverage, reconciliation, and final synthesis input counts.

## 6. Deterministic scorecard

The scorecard is descriptive, not a composite winner. It records per variant:

| Dimension | Measures |
|---|---|
| Input identity | Evidence hash match, source/document/claim counts |
| Source support | Grounded/total source claims, report findings with valid citations, unsupported/degraded findings |
| Coverage and honesty | Scope-contract status, blocked conclusions, critical failed documents, OCR/native truncation/degradation |
| Reconciliation safety | Currency conflicts, identity-unresolved links, duplicate-pair suppression, unresolved lifecycle links |
| Context/report shape | Timeline span, selected source/claim/node counts, ContextNode partial/unresolved counts |
| Reliability | Schema/repair failures, report/verifier errors, error fallback use |
| Cost and time | Calls, input/output/total tokens, elapsed time by stage and total |

Keep source-claim counts distinct from report-finding counts; they have
different denominators and must never share an ambiguous label such as
“supported claims.” No scorecard field declares a winner automatically. The
Lab displays labeled differences such as “4 more report findings with valid
citations; 2 unresolved branches,” so a reviewer can assess the legal
significance.

## 7. Reviewer workflow and later UI contract

The later Analysis Lab screen will begin with:

1. Choose a saved/frozen evidence package, inspect its case identity and hash,
   and launch all three built-in profiles.
2. Start a comparison; show that the input hash is shared before outputs
   appear.
3. Read the flat baseline, DAG-only report, and DAG-plus-summaries report in
   synchronized panes. Show the added summary calls, tokens, and elapsed time
   separately.
4. Open a variant’s **Fragments** drawer when a conclusion needs checking:
   selected claims/facts, source excerpts and citations, flat input or
   ContextNode DAG, node summary, grounding result, omitted evidence reason,
   and any extraction/coverage gap.
5. Read the deterministic scorecard and usage/cost delta.

The first UI has no “A wins/B wins,” voting, randomization, or hidden order.
The labels are intentionally visible because the initial task is engineering
inspection, not calibrated preference collection.

## 8. Execution and safety

- The Lab runs only from a persisted evidence package or a fixture/replay.
  It never calls the scraper or downloader.
- A comparison validates the frozen package and computes its hash before all
  profiles run. A mismatch fails the comparison clearly before report
  generation.
- Each variant is isolated: its model usage tracker, trace, temporary context,
  and errors cannot contaminate the other.
- A failed candidate variant does not erase a successful baseline result; the
  experiment completes as `partial` with the failure rendered.
- Existing source-grounding and report verifier behavior stays in force. Lab
  metadata may be stored, but raw court PDFs, credentials, and unbounded
  prompts must not be persisted in experiment records.

## 9. Acceptance criteria

1. A fixture-backed Kerum replay can run all three profiles from one identical
   evidence-package hash, without any
   scraper/download/OCR call.
2. The comparison record contains immutable profile snapshots, reports,
   bounded traces, deterministic scorecards, and per-variant usage/time.
3. The baseline output uses the existing flat path unchanged; its replay
   behavior is covered by a regression test.
4. Both context profiles construct the same deterministic DAG with cited
   nodes and do not alter canonical evidence, currency calculations,
   reconciliation results, or scope-contract computation. Source-grounding
   counts from the canonical package are identical across all three variants.
5. An explicit receivable/property thread with stable identifiers appears as a
   traceable candidate node; an ambiguous relationship remains unresolved,
   rather than becoming a false merged thread.
6. The DAG-only profile makes no node-summary calls. In the summaries-on
   profile, a failed summary call remains inspectable as partial and does not
   abort other variants or hide source evidence.
7. The scorecard reports source-support, coverage/degradation,
   reconciliation-safety, shape, reliability, and cost/time measures without a
   synthetic overall score or winner.
8. The comparison reports the flat-to-DAG difference separately from the
   DAG-to-DAG-plus-summaries difference, including the summaries’ incremental
   calls, tokens, and elapsed time.
9. The future side-by-side screen exposes the exact fragments used by each
   variant, including citations and gaps, rather than reports alone.
10. All default tests remain offline; one Kerum replay fixture covers the
   comparison boundary. Live case analysis is not a test prerequisite.

## 10. Deferred phases

Only after Phase 1 produces stable, inspectable comparisons:

1. Add bounded, model-suggested branch expansion with explicit budget and
   allowed-child enforcement.
2. Add blind pairwise human review and structured reasons.
3. Calibrate an LLM judge against those human reviews.
4. Treat approved preferences as an evaluation dataset; consider optimization
   only after reliability and governance criteria are separately specified.
