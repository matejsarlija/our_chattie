'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadDocuments, parseArgs } = require('./benchmark-pdf-engines');
const { renderPdfPages } = require('./lib/arms');
const { selectReviewDocs, makeReviewData, buildReviewHtml } = require('./lib/review');

const OUTPUT_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');

// The report keeps scores, not answer bodies. The review sheet needs the body,
// which lives in the per-cell `analysis-<hash>.json` artifact next to it.
function loadAnswerText(reportPath) {
    const texts = new Map();
    let names = [];
    try {
        names = fs.readdirSync(path.dirname(path.resolve(reportPath)));
    } catch {
        return texts;
    }
    for (const name of names) {
        if (!/^analysis-[a-f0-9]{16}\.json$/.test(name)) continue;
        try {
            const artifact = JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(reportPath)), name), 'utf8'));
            if (!artifact?.text) continue;
            texts.set(`${artifact.docId}|${artifact.arm}|${artifact.model}|${artifact.repeat}`, artifact.text);
        } catch { /* One corrupt artifact must not block the review sheet. */ }
    }
    return texts;
}

function reportRowsWithText(reportPath, report) {
    const texts = loadAnswerText(reportPath);
    return (report.rows || [])
        .filter((row) => !row.planned && row.status !== 'SKIPPED')
        .map((row) => ({ ...row, text: texts.get(`${row.docId}|${row.arm}|${row.model}|${row.repeat}`) }))
        .filter((row) => row.text !== undefined);
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    if (!args.report) throw new Error('Provide --report=<benchmark-report.json>');
    const reportPath = path.resolve(args.report);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const rows = reportRowsWithText(reportPath, report);
    const selected = selectReviewDocs(rows, { sample: Math.max(0, Number(args.sample || 3)), seed: args.seed || 1 });
    const allDocs = loadDocuments({ manifest: args.manifest, docs: args.docs });
    const byId = new Map(allDocs.map((doc) => [doc.docId, doc]));
    const imageLimit = Math.max(1, Math.min(5, Number(args['image-pages'] || 3)));
    const imagesByDoc = {};
    for (const doc of selected) {
        const source = byId.get(doc.docId);
        if (!source?.filePath) throw new Error(`Local PDF not found for selected document ${doc.docId}; pass --manifest or --docs`);
        const rendered = await renderPdfPages(source.filePath, imageLimit);
        imagesByDoc[doc.docId] = rendered.images.map((image, index) => ({ pageNumber: index + 1, dataUri: `data:image/jpeg;base64,${image.toString('base64')}` }));
    }
    const { viewDocs, answerKey } = makeReviewData(selected, imagesByDoc, args.seed || 1);
    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
    const outputDir = path.join(OUTPUT_ROOT, runId);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const htmlPath = path.join(outputDir, 'review.html');
    const keyPath = path.join(outputDir, 'answer-key.json');
    fs.writeFileSync(htmlPath, buildReviewHtml(viewDocs), { mode: 0o600 });
    fs.writeFileSync(keyPath, JSON.stringify({ runId, sourceReport: path.basename(reportPath), mappings: answerKey }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ runId, selectedDocuments: selected.length, candidateCount: viewDocs.reduce((sum, doc) => sum + doc.candidates.length, 0), htmlPath, answerKeyPath: keyPath, imagePagesPerDocument: imageLimit }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(`[build-review-sheet] ${error.message}`); process.exitCode = 1; });
module.exports = { main, loadAnswerText, reportRowsWithText };
