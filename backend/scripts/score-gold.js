'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseArgs } = require('./benchmark-pdf-engines');
const { scoreGold } = require('./lib/gold');

const OUTPUT_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');
const makeRunId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;

function readJson(filePath) { return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8')); }

function scoreSingle(gold, extraction) {
    return { document: gold.document?.docId || gold.docId || null, score: scoreGold(gold, extraction) };
}

function scoreReport(goldDocuments, report) {
    const output = [];
    // New runs record analysis cells in `rows`; older artifacts used a separate
    // `extractionRows` list. Read whichever exists so old reports still score.
    const rows = report.extractionRows || report.rows || [];
    for (const gold of goldDocuments) {
        const id = gold.document?.docId || gold.docId;
        const candidates = rows.filter((row) => row.docId === id && row.parsed);
        for (const candidate of candidates) {
            const arm = candidate.arm || candidate.transcriptArm;
            const model = candidate.model || candidate.extractionModel;
            output.push({
                document: id,
                arm,
                model,
                transcriptArm: arm,
                extractionModel: model,
                repeat: candidate.repeat,
                documentType: candidate.documentType,
                score: scoreGold(gold, candidate.parsed),
            });
        }
    }
    return output;
}

function loadGold(input) {
    const resolved = path.resolve(input);
    if (fs.statSync(resolved).isFile()) return [readJson(resolved)];
    return fs.readdirSync(resolved).filter((name) => name.endsWith('.json')).sort().map((name) => readJson(path.join(resolved, name)));
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    let scores;
    if (args.extraction && args.gold) {
        scores = [scoreSingle(readJson(args.gold), readJson(args.extraction))];
    } else if (args.report && args['gold-dir']) {
        scores = scoreReport(loadGold(args['gold-dir']), readJson(args.report));
    } else {
        throw new Error('Use --gold=<template.json> --extraction=<json>, or --gold-dir=<gold-folder> --report=<report.json>');
    }
    const id = makeRunId();
    const outputDir = path.join(OUTPUT_ROOT, id);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(outputDir, 'gold-scores.json');
    fs.writeFileSync(filePath, JSON.stringify({ scores, interpretation: 'Deterministic fact comparisons; no automatic winner is selected.' }, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ outputDir, filePath, N: scores.length, scores }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(`[score-gold] ${error.message}`); process.exitCode = 1; });
module.exports = { scoreSingle, scoreReport, loadGold, main };
