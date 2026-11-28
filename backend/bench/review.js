'use strict';

const fs = require('fs');
const path = require('path');
const reviewLib = require('../scripts/lib/review');
const { DEFAULT_DATA_ROOT, ALLOWED_RUNS } = require('./corpus');

function getBlindedReviewPayload(runId, { sample = 3, seed = 7, dataRoot = DEFAULT_DATA_ROOT } = {}) {
    if (!ALLOWED_RUNS.test(String(runId || ''))) {
        throw new Error('Unknown benchmark run ID.');
    }
    const runDir = path.join(dataRoot, runId);
    const reportPath = path.join(runDir, 'report.json');
    if (!fs.existsSync(reportPath)) {
        throw new Error('This run has no completed report to review.');
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const safeSample = Math.max(0, Math.min(20, Number(sample) || 3));
    const safeSeed = Math.trunc(Number(seed) || 7);
    const selectedDocs = reviewLib.selectReviewDocs(report.rows || [], {
        sample: safeSample,
        seed: safeSeed,
    });
    const reviewData = reviewLib.makeReviewData(selectedDocs, {}, safeSeed);

    const answerKeyPath = path.join(runDir, 'answer-key.json');
    if (reviewData.answerKey) {
        fs.writeFileSync(answerKeyPath, JSON.stringify(reviewData.answerKey, null, 2), { mode: 0o600 });
    }
    const existingVerdictsPath = path.join(runDir, 'human-verdicts.json');
    const existingVerdicts = fs.existsSync(existingVerdictsPath)
        ? JSON.parse(fs.readFileSync(existingVerdictsPath, 'utf8'))
        : null;

    return {
        runId,
        sample: safeSample,
        seed: safeSeed,
        items: reviewData.viewDocs || [],
        answerKeyReady: fs.existsSync(answerKeyPath),
        existingVerdicts,
    };
}

function submitBlindedReviewVerdicts(runId, verdictsPayload, { dataRoot = DEFAULT_DATA_ROOT } = {}) {
    if (!ALLOWED_RUNS.test(String(runId || ''))) {
        throw new Error('Unknown benchmark run ID.');
    }
    const runDir = path.join(dataRoot, runId);
    const reportPath = path.join(runDir, 'report.json');
    const answerKeyPath = path.join(runDir, 'answer-key.json');
    if (!fs.existsSync(reportPath)) throw new Error('This run has no completed report to review.');
    if (!fs.existsSync(answerKeyPath)) throw new Error('Build a blinded review sheet before submitting verdicts.');

    const verdicts = Array.isArray(verdictsPayload) ? verdictsPayload : verdictsPayload?.verdicts;
    if (!Array.isArray(verdicts) || verdicts.length === 0 || verdicts.length > 100) {
        throw new Error('Verdicts must be a non-empty array of up to 100 entries.');
    }

    const verdictPath = path.join(runDir, 'human-verdicts.json');
    const normalizedPayload = { verdicts, submittedAt: new Date().toISOString() };
    fs.writeFileSync(verdictPath, JSON.stringify(normalizedPayload, null, 2), { mode: 0o600 });

    const answerKey = JSON.parse(fs.readFileSync(answerKeyPath, 'utf8'));
    const scored = typeof reviewLib.scoreReviewVerdicts === 'function'
        ? reviewLib.scoreReviewVerdicts({ verdicts, answerKey })
        : { total: verdicts.length, matched: 0, byArm: {} };

    return {
        ok: true,
        runId,
        verdictsCount: verdicts.length,
        scored,
    };
}

module.exports = {
    ...reviewLib,
    getBlindedReviewPayload,
    submitBlindedReviewVerdicts,
};
