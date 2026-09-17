#!/usr/bin/env node
// backend/scripts/eval-reasoning.js
//
// Purpose: Offline reasoning-quality eval runner. Scores the deterministic
//          reasoning stack (lexical retrieval + money-flow extraction) against
//          gold-labeled fixture clusters, and self-checks the seeded-conflict
//          mutator. No Gemini calls — safe for CI.
//
// Usage:
//     npm run eval:reasoning
//     npm run eval:reasoning -- --strict          # exit 1 below thresholds (CI gate)
//     npm run eval:reasoning -- --json            # machine-readable output only
//     npm run eval:reasoning -- --fixtures path/to/dir --seed 7
//
// Exit codes: 0 = ran fine (strict: all thresholds met), 1 = strict threshold
// failure, 2 = fixture load/validation error.
//
// RL note: the emitted report is a flat {fixture, metric, value, details}[]
// list of reward components — reusable as-is in a future training loop.

const fs = require('fs');
const path = require('path');

const DEFAULT_FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'fixtures', 'eval');
// Regression floors for fixtures WITHOUT their own thresholdFloors block
// (measured 2026-08-24: recall@10=1.000, amountF1=1.000). They exist to catch
// breakage in indexer/retriever/moneyFlow, not to certify quality. Raise
// deliberately as phases land; never lower without a written reason.
const DEFAULT_THRESHOLDS = {
    'retrieval.recall@10': 0.95,
    'amount.f1': 0.95
};

// Per-fixture floors: different case archetypes have different intrinsic
// reachability under the FIXED template queries (measured, not aspirational —
// e.g. ovršni vocabulary barely overlaps template tokens). When the query
// planner lands and improves coverage, raise these with a written reason.
function thresholdsForFixture(fixtureSourcePath) {
    try {
        const raw = JSON.parse(require('fs').readFileSync(fixtureSourcePath, 'utf-8'));
        if (raw?.thresholdFloors && typeof raw.thresholdFloors === 'object') {
            return { ...DEFAULT_THRESHOLDS, ...raw.thresholdFloors };
        }
    } catch (err) {
        // fall through to defaults
    }
    return DEFAULT_THRESHOLDS;
}

function parseArgs(argv) {
    const args = { fixtures: DEFAULT_FIXTURES_DIR, seed: 42, strict: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--fixtures') args.fixtures = argv[++i];
        else if (arg === '--seed') args.seed = Number(argv[++i]);
        else if (arg === '--strict') args.strict = true;
        else if (arg === '--json') args.json = true;
        else if (arg === '--help' || arg === '-h') args.help = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    return args;
}

function evaluateFixture(fixture, seed) {
    const { retrieveEvidence } = require('../court-analysis/reasoning/retriever');
    const { mutateEvidencePackage } = require('../court-analysis/reasoning/eval/conflictMutator');
    const { retrievalRecallAtK, retrievalMrr, amountScore } = require('../court-analysis/reasoning/eval/scorers');

    const retrieval = retrieveEvidence(fixture.pkg, { topK: 20 });
    const metrics = [
        retrievalRecallAtK(retrieval, fixture.gold, 5),
        retrievalRecallAtK(retrieval, fixture.gold, 10),
        retrievalRecallAtK(retrieval, fixture.gold, 20),
        retrievalMrr(retrieval, fixture.gold),
        amountScore(fixture.pkg.moneyFlow?.entries || [], fixture.gold)
    ];

    // Mutator self-check: applied must be non-empty and byte-reproducible for
    // a fixed seed — otherwise detection denominators are meaningless.
    const firstPass = mutateEvidencePackage(fixture.pkg, { seed });
    const secondPass = mutateEvidencePackage(fixture.pkg, { seed });
    metrics.push({
        metric: 'mutator.selfCheck',
        value: firstPass.applied.length > 0 && JSON.stringify(firstPass) === JSON.stringify(secondPass) ? 1 : 0,
        details: { appliedCount: firstPass.applied.length }
    });

    return { fixture: path.basename(fixture.sourcePath), retrievalMatchCount: retrieval.metrics.matchCount, metrics };
}

function checkThresholds(report) {
    const failures = [];
    for (const fixtureReport of report.fixtures) {
        const floors = fixtureReport.thresholds || DEFAULT_THRESHOLDS;
        for (const [metricName, floor] of Object.entries(floors)) {
            const metric = fixtureReport.metrics.find((m) => m.metric === metricName);
            if (!metric) {
                failures.push(`${fixtureReport.fixture}: missing metric ${metricName}`);
                continue;
            }
            if (metric.value < floor) {
                failures.push(`${fixtureReport.fixture}: ${metricName}=${metric.value.toFixed(3)} < floor ${floor}`);
            }
        }
    }
    return failures;
}

function main() {
    run().catch((err) => {
        console.error(`[eval] ${err.message}`);
        process.exit(2);
    });
}

async function run() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    } catch (err) {
        console.error(`[eval] ${err.message}`);
        process.exit(2);
        return;
    }
    if (args.help) {
        console.log('Usage: npm run eval:reasoning [-- --fixtures DIR --seed N --strict --json]');
        process.exit(0);
        return;
    }

    let fixtures;
    try {
        const { loadFixtures } = require('../court-analysis/reasoning/eval/fixtureLoader');
        fixtures = loadFixtures(args.fixtures);
    } catch (err) {
        console.error(`[eval] Fixture error: ${err.message}`);
        process.exit(2);
        return;
    }

    if (fixtures.length === 0) {
        console.error(`[eval] No *.fixture.json files under ${args.fixtures}`);
        process.exit(2);
        return;
    }

    const report = {
        generatedAt: new Date().toISOString(),
        seed: args.seed,
        fixtures: fixtures.map((fixture) => {
            const fixtureReport = evaluateFixture(fixture, args.seed);
            fixtureReport.thresholds = thresholdsForFixture(fixture.sourcePath);
            return fixtureReport;
        })
    };

    // Real-corpus lane (self-skipping): two distinct questions on the actual
    // downloaded e-Oglasna documents. (a) INDEXER CEILING — can the chunk
    // index surface a passage when probed with that passage's own rarest
    // tokens? Measures chunker/scorer quality. (b) TEMPLATE COVERAGE — how
    // much of the corpus is reachable through today's fixed production
    // queries? Quantifies the planner/rerank headroom. Weak gold throughout;
    // report-only, never threshold-gated.
    try {
        const { isAvailable, buildRealCorpusFixture } = require('../court-analysis/reasoning/eval/realCorpusLane');
        if (isAvailable()) {
            const real = await buildRealCorpusFixture();
            if (real) {
                const { retrieveEvidence } = require('../court-analysis/reasoning/retriever');
                const { tokenize } = require('../court-analysis/reasoning/indexer');
                const { retrievalRecallAtK, retrievalMrr } = require('../court-analysis/reasoning/eval/scorers');

                const broadRetrieval = retrieveEvidence(real.pkg, { topK: 20 });
                const templateMetrics = [
                    retrievalRecallAtK(broadRetrieval, real.gold, 5),
                    retrievalRecallAtK(broadRetrieval, real.gold, 20),
                    retrievalMrr(broadRetrieval, real.gold)
                ];

                // Targeted probes: per-span query built from the span's own
                // rarest long tokens (df-aware, cheap approximation).
                const { buildLexicalIndex } = require('../court-analysis/reasoning/indexer');
                const index = buildLexicalIndex(real.pkg);
                const df = index.idfStats.df || {};
                let targetedHits = 0;
                const targetedQueries = real.gold.citationSpans.map((span, i) => ({
                    id: `probe-${i + 1}`,
                    purpose: 'span-probe',
                    text: tokenize(span.textIncludes)
                        .sort((a, b) => (df[a] || 0) - (df[b] || 0))
                        .slice(0, 6)
                        .join(' '),
                    anchors: [],
                    queryType: 'text'
                }));
                const probeRetrieval = retrieveEvidence(real.pkg, { index, queries: targetedQueries, topK: 5 });
                const probeUnion = probeRetrieval.results.flatMap((r) => r.matches);
                for (const span of real.gold.citationSpans) {
                    if (probeUnion.some((m) => m.text.includes(span.textIncludes))) targetedHits += 1;
                }

                report.realCorpus = {
                    documents: real.docCount,
                    chunks: real.pkg.chunks.length,
                    metrics: [
                        ...templateMetrics,
                        { metric: 'indexer.targetedProbeRecall@5', value: real.gold.citationSpans.length ? targetedHits / real.gold.citationSpans.length : 0, details: { totalSpans: real.gold.citationSpans.length } }
                    ]
                };
            }
        } else if (!args.json) {
            console.log('[eval] Real-corpus lane skipped (fixtures not downloaded).');
        }
    } catch (err) {
        if (!args.json) console.warn(`[eval] Real-corpus lane failed softly: ${err.message}`);
    }

    const failures = args.strict ? checkThresholds(report) : [];

    if (args.json) {
        console.log(JSON.stringify({ ...report, strictFailures: failures }, null, 2));
    } else {
        for (const fixtureReport of report.fixtures) {
            console.log(`\n=== ${fixtureReport.fixture} (${fixtureReport.retrievalMatchCount} lexical matches) ===`);
            for (const metric of fixtureReport.metrics) {
                console.log(`  ${metric.metric.padEnd(28)} ${metric.value.toFixed(3)}  ${JSON.stringify(metric.details)}`);
            }
        }
        if (report.realCorpus) {
            console.log(`\n=== REAL corpus probe: ${report.realCorpus.documents} documents, ${report.realCorpus.chunks} chunks (weak gold — coverage only) ===`);
            for (const metric of report.realCorpus.metrics) {
                console.log(`  ${metric.metric.padEnd(28)} ${metric.value.toFixed(3)}  ${JSON.stringify(metric.details)}`);
            }
        }
        if (args.strict) {
            console.log(failures.length === 0
                ? '\n[eval] STRICT: all thresholds met.'
                : `\n[eval] STRICT failures:\n  - ${failures.join('\n  - ')}`);
        } else {
            console.log('\n[eval] Report-only mode (use --strict to enforce thresholds).');
        }
    }

    // Keep a stable artifact location for CI diffing without polluting stdout.
    fs.mkdirSync(path.join(__dirname, '..', '.eval'), { recursive: true });
    fs.writeFileSync(
        path.join(__dirname, '..', '.eval', 'reasoning-report.json'),
        JSON.stringify({ ...report, strictFailures: failures }, null, 2)
    );

    process.exit(args.strict && failures.length > 0 ? 1 : 0);
}

main();
