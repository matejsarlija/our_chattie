# Backend test layout

Tests are grouped by the production boundary they protect. Keep a new test
beside its closest production concern instead of adding it to the test root.

- `change-detection/` — change snapshot, diff, persistence, CLI, and API tests
- `replays/` — regression replays distilled from observed production runs
- `reasoning/` — evidence, retrieval, grounding, reconciliation, and report tests
- `resilience/` — offline adversarial chaos, prompt–schema lockstep, and 100-entry scale regression suites
- `fixtures/` — deterministic data, grouped by source or test lane

Offline `npm run test:unit` must never perform live network or LLM calls (mock `backend/llm/openrouterClient.js` for model invocation tests).

The remaining root-level tests predate this layout. New suites should use a
domain directory; existing suites move only as part of a focused maintenance
change that updates their relative imports and verification command together.

`fixtures/real-documents/` is local-only and intentionally excluded from Git.
It is a replay corpus, not a general fixture bucket. See its README before
refreshing or deleting files.
