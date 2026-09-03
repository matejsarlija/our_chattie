// Live verification of the reasoning engine chain against real Gemini.
// Builds a ClusterEvidencePackage from the frozen baseline fixture (real scraped
// + analyzed ST-2/2013 Kerum data) and runs generateClusterReport end-to-end.
(async () => {
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const path = require('path');
const fs = require('fs');
const { buildClusterEvidencePackage } = require('../court-analysis/reasoning/evidencePackage');
const { validateClusterEvidencePackage } = require('../court-analysis/reasoning/evidencePackage');
const { generateClusterReport } = require('../court-analysis/reasoning/reportService');
const { validateReport } = require('../court-analysis/reasoning/schema');

// Every run of this script spends real Gemini tokens, so every run also
// writes a small, structured, diffable snapshot to .eval/snapshots/ —
// win or lose — giving a free regression baseline without any manual
// copy-pasting. Metrics only (no narrative prose, which varies run to run
// regardless of quality); pair with test-artifacts/live-reasoning-report.json
// (full raw report, overwritten each run) when the prose itself matters.
const SNAPSHOT_DIR = path.join(__dirname, '..', '.eval', 'snapshots');

function writeSnapshot(payload) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const slug = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(SNAPSHOT_DIR, `live-reasoning-${slug}.json`);
    fs.writeFileSync(file, JSON.stringify({ timestamp: new Date().toISOString(), ...payload }, null, 2), 'utf8');
    console.log(`[snapshot] Saved eval baseline to .eval/snapshots/${path.basename(file)}`);
    return file;
}

function logUsage(usage) {
    console.log(
        `[token-usage] live-reasoning: ${usage.calls} calls, ` +
        `${usage.inputTokens} in / ${usage.outputTokens} out / ${usage.totalTokens} total tokens`
    );
}

const fixturePath = path.join(__dirname, '..', 'fixtures', 'analysis-baselines', '66124057408-baseline.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const processedCases = fixture.pipeline.rawResult.processedCases;

if (!process.env.GOOGLE_API_KEY) {
    console.error('GOOGLE_API_KEY is not set.');
    process.exit(2);
}

if (!processedCases || processedCases.length === 0) {
    console.error('Fixture has no processedCases.');
    process.exit(2);
}

const selected = processedCases[0];
const caseInfo = selected.caseResult;
const clusterId = selected.groupMetadata?.clusterId || caseInfo.caseNumber || 'ST-2/2013';
const documentLinks = (selected.files || []).map((f, i) => ({
    id: `${clusterId}::doc-${i + 1}`,
    url: f.url,
    text: f.text,
    caseNumber: clusterId,
    entryTitle: caseInfo.title
}));

const cluster = {
    clusterId,
    caseNumber: clusterId,
    isAnonymous: selected.groupMetadata?.isAnonymous || false,
    entries: [
        {
            caseNumber: clusterId,
            caseInfo: {
                title: caseInfo.title,
                caseNumber: caseInfo.caseNumber,
                court: caseInfo.court,
                date: caseInfo.date,
                detailLink: caseInfo.detailLink,
                participants: caseInfo.participants || []
            },
            documentLinks
        }
    ]
};

const clusterSummary = {
    clusterId,
    primaryCaseNumber: clusterId,
    entryCount: selected.groupMetadata?.entryCount || 1,
    score: 1,
    selectionDiagnostics: { entryCoverage: 0.5, dateSpan: 0.5, recency: 0.5, dominance: 0.5, documentCoverage: 0.5, identityMultiplier: 1, finalScore: 0.5 },
    identityConsistency: 'consistent',
    identityNotes: [],
    participantNames: (caseInfo.participants || []).map(p => p.name).filter(Boolean),
    participantOibs: (caseInfo.participants || []).map(p => p.oib).filter(Boolean),
    acquisitionModes: ['search-window'],
    acquisitionProvenance: [{ mode: 'search-window', sourceCaseNumber: clusterId }],
    expansionEligibility: { eligible: false, reason: 'fixture' },
    expansionPlan: null
};

const discoverySummary = {
    reasoningClusterId: clusterId,
    recommendedPrimaryClusterId: clusterId,
    secondaryClusterIds: [],
    discoveryMode: 'search-window',
    acquisitionModes: ['search-window'],
    acquisitionProvenance: [{ mode: 'search-window', sourceCaseNumber: clusterId }],
    totalResults: fixture.discovery?.count || 1,
    totalPages: 1,
    pagesScanned: 1,
    rawEntryCount: fixture.discovery?.count || 1,
    capturedDistinctCaseCount: 1,
    coverageConfidence: 'medium',
    query: { type: 'oib', value: '66124057408' },
    clusters: [clusterSummary]
};

let evidencePackage;
try {
    evidencePackage = buildClusterEvidencePackage({ cluster, clusterSummary, discoverySummary, query: discoverySummary.query });
} catch (err) {
    console.error('buildClusterEvidencePackage failed:', err.message);
    process.exit(1);
}

const validation = validateClusterEvidencePackage(evidencePackage);
if (!validation.valid) {
    console.error('ClusterEvidencePackage validation failed:', validation.error);
    process.exit(1);
}
console.log('ClusterEvidencePackage valid. clusterId =', evidencePackage.clusterId);
console.log('entries:', evidencePackage.entries.length, 'documentLinks:', evidencePackage.documentLinks.length);

// Surface real token spend alongside the assertions: this lane pays for
// planner + synthesis + verifier (+ optional rerank/follow-up), so a
// silently-zero snapshot would hide erroneous spend.
const { createUsageTracker } = require('../helpers/geminiUsage');
const usageTracker = createUsageTracker();

const stages = [];
let report;
try {
    report = await generateClusterReport(evidencePackage, {
        onStage: (event) => stages.push(event),
        tracker: usageTracker
    });
} catch (err) {
    const usage = usageTracker.snapshot();
    logUsage(usage);
    writeSnapshot({
        status: 'error',
        error: err.message,
        stagesEmitted: stages.map((s) => `${s.step}(${s.progress})`),
        tokenUsage: usage
    });
    throw err;
}
const usage = usageTracker.snapshot();
logUsage(usage);

const reportValidation = validateReport(report);
console.log('\nStages emitted:', stages.map(s => `${s.step}(${s.progress})`).join(' -> '));
console.log('\nreport.schemaVersion:', report.schemaVersion);
console.log('report.narrative length:', (report.narrative || '').length);
console.log('report.findings:', (report.findings || []).length);
console.log('report.verifiedFindings:', (report.verifiedFindings || []).length);
console.log('report.openQuestions:', (report.openQuestions || []).length);
console.log('report.nextSteps:', (report.nextSteps || []).length);
console.log('report conflicts:', (report.conflicts || []).length);
console.log('report meta keys:', Object.keys(report.meta || {}));
console.log('retrieval matchCount:', report.meta?.retrieval?.metrics?.matchCount);
console.log('rerank status:', report.meta?.rerank?.rerankStatus);

if (!reportValidation.valid) {
    writeSnapshot({
        status: 'schema_invalid',
        error: reportValidation.error,
        stagesEmitted: stages.map((s) => `${s.step}(${s.progress})`),
        tokenUsage: usage
    });
    console.error('\nReport schema validation FAILED:', reportValidation.error);
    process.exit(1);
}

const findings = report.verifiedFindings && report.verifiedFindings.length > 0 ? report.verifiedFindings : report.findings;
if (!findings || findings.length === 0) {
    writeSnapshot({
        status: 'no_findings',
        stagesEmitted: stages.map((s) => `${s.step}(${s.progress})`),
        tokenUsage: usage,
        schemaVersion: report.schemaVersion
    });
    console.error('\nNo findings produced.');
    process.exit(1);
}

fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'live-reasoning-report.json'), JSON.stringify(report, null, 2), 'utf8');

writeSnapshot({
    status: 'ok',
    stagesEmitted: stages.map((s) => `${s.step}(${s.progress})`),
    tokenUsage: usage,
    schemaVersion: report.schemaVersion,
    metrics: {
        narrativeLength: (report.narrative || '').length,
        findings: (report.findings || []).length,
        verifiedFindings: (report.verifiedFindings || []).length,
        openQuestions: (report.openQuestions || []).length,
        nextSteps: (report.nextSteps || []).length,
        conflicts: (report.conflicts || []).length,
        retrievalMatchCount: report.meta?.retrieval?.metrics?.matchCount ?? null,
        rerankStatus: report.meta?.rerank?.rerankStatus ?? null
    }
});

console.log('\nLIVE REASONING PATH OK. Report written to test-artifacts/live-reasoning-report.json');
})();
