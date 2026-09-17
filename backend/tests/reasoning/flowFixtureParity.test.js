// Flow-consolidation parity gate: for every eval fixture, the derived
// `moneyFlow`/`propertyFlow` views and both reconciliation outputs must equal
// the frozen expectations in tests/fixtures/parity/. This is the regression
// net proving the unified collector + derived views reproduce the
// pre-refactor output byte-for-byte; any future edit to flow.js or the
// derived views that changes legacy-visible output fails here first.
//
// NOTE on fixture location: the task description pointed at
// backend/court-analysis/reasoning/eval/, but that directory holds the
// fixture *loader* — the actual *.fixture.json files live in
// backend/tests/fixtures/eval/. This test loads them through the production
// loader (`loadFixtures`), i.e. the same `attachAnalysesToEvidencePackage`
// path the pipeline uses.
const fs = require('fs');
const path = require('path');
const { loadFixtures } = require('../../court-analysis/reasoning/eval/fixtureLoader');

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/eval');
const PARITY_DIR = path.resolve(__dirname, '../fixtures/parity');
const PARITY_KEYS = ['moneyFlow', 'propertyFlow', 'reconciliation', 'propertyReconciliation'];

describe('flow fixture parity (derived views byte-identical to pre-refactor output)', () => {
    const loaded = loadFixtures(FIXTURE_DIR);

    test('every eval fixture has a frozen parity expectation', () => {
        expect(loaded.length).toBeGreaterThan(0);
        for (const { sourcePath } of loaded) {
            const base = path.basename(sourcePath, '.fixture.json');
            for (const key of PARITY_KEYS) {
                expect(fs.existsSync(path.join(PARITY_DIR, `${base}.${key}.json`))).toBe(true);
            }
        }
    });

    for (const { pkg, sourcePath } of loaded) {
        const base = path.basename(sourcePath, '.fixture.json');
        describe(base, () => {
            for (const key of PARITY_KEYS) {
                test(`${key} matches frozen expectation`, () => {
                    const expected = JSON.parse(
                        fs.readFileSync(path.join(PARITY_DIR, `${base}.${key}.json`), 'utf8')
                    );
                    expect(pkg[key]).toEqual(expected);
                });
            }
        });
    }
});
