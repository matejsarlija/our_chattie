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

const stages = [];
const report = await generateClusterReport(evidencePackage, {
    onStage: (event) => stages.push(event)
});

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
    console.error('\nReport schema validation FAILED:', reportValidation.error);
    process.exit(1);
}

const findings = report.verifiedFindings && report.verifiedFindings.length > 0 ? report.verifiedFindings : report.findings;
if (!findings || findings.length === 0) {
    console.error('\nNo findings produced.');
    process.exit(1);
}

fs.writeFileSync(path.join(__dirname, '..', 'test-artifacts', 'live-reasoning-report.json'), JSON.stringify(report, null, 2), 'utf8');
console.log('\nLIVE REASONING PATH OK. Report written to test-artifacts/live-reasoning-report.json');
})();
