const { mutateEvidencePackage, mutationDetected, MUTATION_KINDS } = require('../../../court-analysis/reasoning/eval/conflictMutator');
const { loadFixture } = require('../../../court-analysis/reasoning/eval/fixtureLoader');
const path = require('path');

const FIXTURE_PATH = path.join(__dirname, '..', '..', 'fixtures', 'eval', 'stecaj-klaster.fixture.json');

describe('eval conflictMutator', () => {
    const fixture = loadFixture(FIXTURE_PATH);

    test('never mutates the input package', () => {
        const snapshot = JSON.stringify(fixture.pkg);
        mutateEvidencePackage(fixture.pkg, { seed: 7 });
        expect(JSON.stringify(fixture.pkg)).toBe(snapshot);
    });

    test('same seed produces byte-identical mutations (reproducible environments)', () => {
        const a = mutateEvidencePackage(fixture.pkg, { seed: 1234 });
        const b = mutateEvidencePackage(fixture.pkg, { seed: 1234 });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    test('applies all requested kinds and records an honest ledger', () => {
        const { pkg, applied } = mutateEvidencePackage(fixture.pkg, {
            seed: 42,
            kinds: ['amount-mismatch', 'date-conflict', 'party-swap']
        });

        expect(applied.map((m) => m.kind).sort()).toEqual(['amount-mismatch', 'date-conflict', 'party-swap']);

        // Ledger entries must describe real changes in the mutated package.
        for (const mutation of applied) {
            if (mutation.kind === 'amount-mismatch') {
                const analysis = pkg.analyses.find((a) => mutation.path.includes(`id=${a.id}`));
                expect(analysis.amounts.some((entry) => entry.amount === mutation.after)).toBe(true);
                expect(mutation.after).not.toBe(mutation.before);
            }
            if (mutation.kind === 'date-conflict') {
                expect(pkg.analyses.some((a) => a.decisionDate === mutation.after)).toBe(true);
            }
            if (mutation.kind === 'party-swap') {
                const names = pkg.entries.flatMap((e) => e.participants.map((p) => p.name));
                expect(names).toContain(mutation.after);
            }
        }
    });

    test('respects requested kind subsets and rejects unknown kinds', () => {
        const onlyDates = mutateEvidencePackage(fixture.pkg, { seed: 5, kinds: ['date-conflict'] });
        expect(onlyDates.applied).toHaveLength(1);
        expect(onlyDates.applied[0].kind).toBe('date-conflict');

        expect(() => mutateEvidencePackage(fixture.pkg, { kinds: ['nope'] })).toThrow(/Unknown mutation kind/);
    });

    test('exposes the full kind registry', () => {
        expect(Object.keys(MUTATION_KINDS).sort()).toEqual(['amount-mismatch', 'date-conflict', 'party-swap']);
    });

    describe('mutationDetected matching heuristic', () => {
        const amountMutation = { kind: 'amount-mismatch', fileName: 'izvjestaj.pdf', before: 84500, after: 160000, path: 'x' };

        test('detects on fileName co-occurrence', () => {
            expect(mutationDetected(amountMutation, ['Neuspjela provjera izvještaja izvjestaj.pdf'])).toBe(true);
        });

        test('detects on before/after value presence', () => {
            expect(mutationDetected(amountMutation, ['Iznos 160000 ne odgovara dokazima.'])).toBe(true);
        });

        test('misses vague statements without identifiers or values', () => {
            expect(mutationDetected(amountMutation, ['Neki podaci se ne slažu.'])).toBe(false);
            expect(mutationDetected(amountMutation, [])).toBe(false);
        });
    });
});
