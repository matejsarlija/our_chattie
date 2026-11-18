'use strict';

const fs = require('fs');
const path = require('path');

function readJson(file) { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); }

function aggregateReviews(verdictData, answerKey, report, minNumberRecall = 1) {
    const cells = new Map();
    const rows = report.rows || [];
    for (const verdict of verdictData.verdicts || []) {
        const identity = answerKey.mappings?.[verdict.docId]?.[verdict.label];
        if (!identity) continue;
        const reportRow = rows.find((row) => row.docId === verdict.docId && row.arm === identity.arm && (row.model || null) === (identity.model || null) && (row.repeat || 1) === (identity.repeat || 1));
        const docType = reportRow?.documentType || 'unknown';
        const key = `${identity.arm}|${identity.model || 'model-independent'}|${docType}`;
        if (!cells.has(key)) cells.set(key, { arm: identity.arm, model: identity.model || null, documentType: docType, N: 0, usable: 0, notUsable: 0, unscored: 0, errorTypes: {}, agreement: { matches: 0, compared: 0 } });
        const cell = cells.get(key);
        if (!['usable', 'not usable'].includes(verdict.verdict)) { cell.unscored += 1; continue; }
        cell.N += 1;
        if (verdict.verdict === 'usable') cell.usable += 1;
        if (verdict.verdict === 'not usable') cell.notUsable += 1;
        for (const type of verdict.errorTypes || []) cell.errorTypes[type] = (cell.errorTypes[type] || 0) + 1;
        const recall = reportRow?.metrics?.amounts?.recall ?? reportRow?.goldAccuracy?.amounts?.recall;
        const pageCompleteness = reportRow?.metrics?.pageCompleteness;
        if (Number.isFinite(recall)) {
            const deterministicUsable = recall >= minNumberRecall && (pageCompleteness == null || pageCompleteness.complete === true);
            cell.agreement.compared += 1;
            if ((verdict.verdict === 'usable') === deterministicUsable) cell.agreement.matches += 1;
        }
    }
    return [...cells.values()].map((cell) => ({
        ...cell,
        usableRate: cell.N ? cell.usable / cell.N : null,
        deterministicAgreement: cell.agreement.compared ? cell.agreement.matches / cell.agreement.compared : null,
    }));
}

function main(argv = process.argv.slice(2)) {
    const args = {};
    for (const item of argv) {
        const match = /^--([^=]+)=(.*)$/.exec(item);
        if (match) args[match[1]] = match[2];
    }
    if (!args.verdicts || !args['answer-key'] || !args.report) throw new Error('Provide --verdicts=<review-verdicts.json> --answer-key=<answer-key.json> --report=<benchmark-report.json>');
    const threshold = args['min-number-recall'] == null ? 1 : Number(args['min-number-recall']);
    const results = aggregateReviews(readJson(args.verdicts), readJson(args['answer-key']), readJson(args.report), threshold);
    console.log(JSON.stringify({ minNumberRecall: threshold, interpretation: 'Descriptive agreement only; human verdicts remain independent of metrics.', results }, null, 2));
}

if (require.main === module) {
    try { main(); } catch (error) { console.error(`[score-review] ${error.message}`); process.exitCode = 1; }
}

module.exports = { aggregateReviews, main };
