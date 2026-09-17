// Reports which backend test suites the unit lane skips and why, so a green
// `npm run test:unit` can never be mistaken for full coverage.
//
// Two skip mechanisms exist:
//  1. Excluded from the lane: package.json `test:unit` --testPathIgnorePatterns
//     (live-service suites; covered by test:integration / test:nightly-live).
//  2. Conditionally skipped in-file: `describe.skip` (or a conditional alias)
//     gated on an env var / missing fixture download.
//
// Usage: `node scripts/report-skipped-lanes.js` (stdout; CI appends it to
// $GITHUB_STEP_SUMMARY). Never fails — this is telemetry, not a gate.
const fs = require('fs');
const path = require('path');

const TESTS_DIR = path.resolve(__dirname, '../tests');
// Mirrors package.json test:unit --testPathIgnorePatterns (repo-root-relative).
const UNIT_LANE_EXCLUDES = [
    'backend/tests/pipeline.live.integration.test.js',
    'backend/tests/pipeline.csv.live.integration.test.js',
    'backend/tests/court-analysis-integration.test.js',
    'backend/tests/app.smoke.puppeteer.test.js',
];
const LANE_FOR_EXCLUDED = {
    'backend/tests/pipeline.live.integration.test.js': 'test:integration',
    'backend/tests/pipeline.csv.live.integration.test.js': 'test:integration',
    'backend/tests/court-analysis-integration.test.js': 'test:integration',
    'backend/tests/app.smoke.puppeteer.test.js': 'test:e2e:smoke / nightly-live job',
};

function listTestFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'fixtures') continue;
            out.push(...listTestFiles(full));
        } else if (entry.name.endsWith('.test.js')) {
            out.push(path.relative(path.resolve(__dirname, '..', '..'), full));
        }
    }
    return out.sort();
}

function findSkipGates(src) {
    const gates = [];
    if (/(^|[^\w$.])describe\.skip\b/.test(src)) gates.push('describe.skip');
    if (/(^|[^\w$.])(test|it)\.skip\b/.test(src)) gates.push('test.skip');
    if (/(^|[^\w$.])xdescribe\s*\(/.test(src)) gates.push('xdescribe');
    if (/(^|[^\w$.])xit\s*\(/.test(src)) gates.push('xit');
    for (const match of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        gates.push(`env:${match[1]}`);
    }
    if (/fixtures:fetch|hasFixtures/.test(src)) gates.push('needs fixture download (npm run fixtures:fetch)');
    return [...new Set(gates)];
}

function hasSkip(src) {
    return /(^|[^\w$.])describe\.skip\b/.test(src)
        || /(^|[^\w$.])(test|it)\.skip\b/.test(src)
        || /(^|[^\w$.])xdescribe\s*\(/.test(src)
        || /(^|[^\w$.])xit\s*\(/.test(src);
}

function main() {
    const rows = [];
    for (const file of listTestFiles(path.resolve(__dirname, '../tests'))) {
        const src = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
        if (UNIT_LANE_EXCLUDES.includes(file)) {
            rows.push({ file, status: 'excluded from unit lane', why: `covered by \`${LANE_FOR_EXCLUDED[file]}\`` });
        } else if (hasSkip(src)) {
            rows.push({ file, status: 'conditionally skipped', why: findSkipGates(src).join(', ') || 'unconditional .skip — investigate' });
        }
    }

    const lines = [
        '## Skipped test lanes (backend unit run)',
        '',
        'Green `test:unit` does not mean everything ran. Suites below are skipped by design (live services / downloads); anything marked for the unit lane itself would be accidental.',
        '',
        '| Suite | Status | Why / covering lane |',
        '|---|---|---|',
        ...rows.map((r) => `| \`${r.file}\` | ${r.status} | ${r.why} |`),
        '',
        `Total: ${rows.length} suite(s) outside the unit lane.`,
    ];
    process.stdout.write(lines.join('\n') + '\n');
}

main();
