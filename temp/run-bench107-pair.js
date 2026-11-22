'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.chdir(path.resolve(__dirname, '../backend'));
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../backend/.env') });
const bench = require('../backend/scripts/benchmark-pdf-engines');

const DOC_IDS = [
    '26:Prilog St-2_2013-1159-2 - Prilog 2. - Specifikacija djelomičnog namirenja tražbine B2 KAPITAL d.o.o..pdf',
    '6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf',
];

async function main() {
    const goldDir = path.resolve(__dirname, '../backend/data/pdf-engine-bench/2026-11-20T14-13-11-497Z-0c71f691/gold');
    const args = bench.parseArgs([
        '--models=z-ai/glm-5.3-flash', '--baseline=google/gemini-2.5-flash',
        '--reasoning=z-ai/glm-5.3-flash:low', '--analysis-condition=structured_mode',
        `--gold-dir=${goldDir}`, '--max-cost=0.05', '--timeout-ms=240000',
        '--concurrency=1', '--repeats=1', '--approved',
        ...DOC_IDS.map((id) => `--doc-id=${id}`),
    ]);
    const models = ['z-ai/glm-5.3-flash', 'google/gemini-2.5-flash'];
    const docs = bench.resolveRunDocuments(args, 'pilot');
    const pages = docs.map((doc) => Number(doc.pages) || 0);
    const totalPages = pages.reduce((sum, n) => sum + n, 0);
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
    const outputDir = path.resolve(__dirname, '../backend/data/pdf-engine-bench', runId);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const logger = bench.createBenchLogger({ debug: false, verbose: false, logFile: path.join(outputDir, 'progress.log') });
    const capabilitiesByModel = {};
    for (const model of models) capabilitiesByModel[model] = await bench.resolveRunCapabilities(model, { dryRun: false, apiKey: process.env.OPENROUTER_API_KEY });
    const estimate = bench.estimateRunCost({ models, pages, documents: docs, repeats: 1, args });
    if (estimate.totalUsd > 0.05) throw new Error(`Estimated cost $${estimate.totalUsd} exceeds $0.05`);
    const reasoning = bench.resolveReasoningByModel(args, models, { baseline: args.baseline });
    const context = {
        runId, scope: 'pilot', models, baseline: args.baseline, baselineArm: 'local-text',
        analysisCondition: 'structured_mode', estimatedCost: estimate.totalUsd,
        estimatedAnalysisRequests: estimate.analysisRequests, reasoning: reasoning.byModel,
        maxCost: 0.05, dryRun: false, totalPages,
        docs: docs.map(({ docId, pages: pageCount }) => ({ docId, pages: pageCount })),
        capabilitiesByModel,
    };
    fs.writeFileSync(path.join(outputDir, 'run.json'), JSON.stringify(context, null, 2), { mode: 0o600 });
    const report = await bench.execute({ args, documents: docs, models, capabilitiesByModel, outputDir, dryRun: false, logger });
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify({ ...context, ...report }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ runId, outputDir, docsCount: docs.length, totalPages, estimatedCost: estimate.totalUsd, actualCost: report.actualCost, aborted: report.aborted }, null, 2));
}

main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 1; });
