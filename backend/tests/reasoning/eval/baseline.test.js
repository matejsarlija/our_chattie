// Quality regression gate for the deterministic reasoning stack.
//
// These assertions run the REAL production path (fixtureLoader -> production
// attachAnalysesToEvidencePackage -> retrieveEvidence) against frozen
// gold-labeled fixtures. If indexer/retriever/moneyFlow behavior changes,
// these floors catch it in CI — before any user sees degraded reports.
//
// Floors are PER-FIXTURE: different case archetypes have different intrinsic
// reachability under the fixed template queries (ovršni vocabulary barely
// overlaps template tokens; parnični does). A fixture may declare its own
// `thresholdFloors` block; fixtures without one use the strict defaults.
// Floors mirror scripts/eval-reasoning.js (thresholdsForFixture). Raise both
// together when a phase legitimately improves metrics, never lower without a
// written reason.

const path = require('path');
const { loadFixtures } = require('../../../court-analysis/reasoning/eval/fixtureLoader');
const { retrievalRecallAtK, amountScore } = require('../../../court-analysis/reasoning/eval/scorers');
const { retrieveEvidence } = require('../../../court-analysis/reasoning/retriever');

const FIXTURES_DIR = path.join(__dirname, '..', '..', 'fixtures', 'eval');

const DEFAULT_FLOORS = { 'retrieval.recall@10': 0.95, 'amount.f1': 0.95 };
const floorsFor = (fixture) => ({ ...DEFAULT_FLOORS, ...(fixture.floors || {}) });

const fixtures = loadFixtures(FIXTURES_DIR);

describe('reasoning quality baseline (gold-labeled fixtures)', () => {
    test('fixtures exist and validate through the production assembly path', () => {
        expect(fixtures.length).toBeGreaterThanOrEqual(3);
    });

    describe.each(fixtures.map((f) => [path.basename(f.sourcePath), f]))('%s', (name, fixture) => {
        // topK 20 so the k=10/20 slices are meaningful per-query windows.
        const retrieval = retrieveEvidence(fixture.pkg, { topK: 20 });
        const floors = floorsFor(fixture);

        test('retrieval recall@10 meets the regression floor', () => {
            const r = retrievalRecallAtK(retrieval, fixture.gold, 10);
            expect(r.value).toBeGreaterThanOrEqual(floors['retrieval.recall@10']);
            if (r.value < 1) {
                console.warn(`[${name}] missed gold spans: ${JSON.stringify(r.details.missedSpanIndexes)}`);
            }
        });

        test('amount extraction F1 meets the regression floor', () => {
            const s = amountScore(fixture.pkg.moneyFlow?.entries || [], fixture.gold);
            expect(s.value).toBeGreaterThanOrEqual(floors['amount.f1']);
        });

        // Grounding-gap span (Phase 0.1 regression guard). The sampled fact
        // lives ONLY in rawDocuments full text — retrievable solely because
        // the fixture loader runs it through the production chunker into
        // pkg.chunks. Probed TARGETED (the span queried with its own tokens):
        // this isolates chunk INDEXING from template-query coverage, which
        // the per-fixture floors above already account for. Skipped for
        // fixtures that ship no rawDocuments.
        if ((fixture.rawDocumentSpans || []).length > 0) {
            test('full-document-only facts are retrievable when probed directly', () => {
                const span = fixture.rawDocumentSpans[0];
                const targeted = retrieveEvidence(fixture.pkg, {
                    topK: 5,
                    queries: [{ id: 'grounding-probe', purpose: 'grounding-gap', text: span, anchors: [], queryType: 'text' }]
                });
                const hit = targeted.results[0]?.matches?.some((m) => m.text.includes(span));
                expect(hit).toBe(true);
            });
        }
    });
});
