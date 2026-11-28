'use strict';

const { buildRunScorecard } = require('../court-analysis/reasoning/ledger/runScorecard');

function scoreReportOutput({ report, pkg = null } = {}) {
    const findings = Array.isArray(report?.findings) ? report.findings : [];
    const verifiedFindings = findings.filter(
        (f) => f?.verificationStatus === 'verified_deterministic' || f?.verificationStatus === 'verified_llm',
    );
    const deterministicCount = findings.filter((f) => f?.verificationStatus === 'verified_deterministic').length;
    const unverifiedCount = findings.filter((f) => f?.verificationStatus === 'unverified').length;
    const conflictsCount = Array.isArray(report?.conflicts) ? report.conflicts.length : 0;
    const scorecard = pkg ? buildRunScorecard({ pkg, report }) : null;

    return {
        findingsCount: findings.length,
        verifiedCount: verifiedFindings.length,
        deterministicCount,
        unverifiedCount,
        conflictsCount,
        hasNarrative: typeof report?.narrative === 'string' && report.narrative.trim().length > 0,
        scorecard,
    };
}

async function runStage2ReportBench({
    pkg,
    report = null,
    dryRun = true,
    approved = false,
    maxCost = 0,
    synthesizerFn = null,
} = {}) {
    if (!dryRun) {
        if (approved !== true) throw new Error('Explicit approval is required for live Stage-2 Report Bench.');
        if (!Number.isFinite(Number(maxCost)) || Number(maxCost) <= 0) {
            throw new Error('Set a strict positive maxCost > 0 for live Stage-2 Report Bench.');
        }
    }
    if (dryRun || typeof synthesizerFn !== 'function') {
        const metrics = scoreReportOutput({ report: report || {}, pkg });
        return {
            dryRun: true,
            estimatedCostUsd: 0.02,
            metrics,
        };
    }

    const started = Date.now();
    const generated = await synthesizerFn({ pkg });
    const latencyMs = Date.now() - started;
    return {
        dryRun: false,
        latencyMs,
        metrics: scoreReportOutput({ report: generated, pkg }),
    };
}

module.exports = {
    scoreReportOutput,
    runStage2ReportBench,
};
