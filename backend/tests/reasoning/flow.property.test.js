// Property-based tests for the deterministic parsers everything downstream
// stands on (flow-consolidation hardening item 4). Uses fast-check (already
// a devDependency) to fuzz:
// - parseAmount (flow.js): Croatian + international formatted numbers
//   round-trip; malformed input never throws (null instead).
// - parseDate (timelineBuilder.js): ISO + Croatian formats round-trip and
//   preserve chronological ordering.
// - descriptionKey / propertyGroupKey: invariant under word reordering,
//   case changes, and Croatian diacritic normalization.
const fc = require('fast-check');
const { parseAmount } = require('../../court-analysis/reasoning/flow');
const { parseDate } = require('../../court-analysis/reasoning/timelineBuilder');
const { descriptionKey } = require('../../court-analysis/reasoning/reconciliation');
const { propertyGroupKey } = require('../../court-analysis/reasoning/propertyFlow');

function formatGrouped(intPart, thousandsSep, decimalSep) {
    const grouped = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
    return grouped;
}

describe('parsers (property-based)', () => {
    describe('parseAmount', () => {
        const moneyArb = fc.integer({ min: 0, max: 999999999 }).map((cents) => cents / 100);

        test('Croatian format round-trips (1.200.000,00)', () => {
            fc.assert(fc.property(moneyArb, (value) => {
                const [int, frac = '00'] = String(value).split('.');
                const text = `${formatGrouped(int, '.', ',')},${(frac + '00').slice(0, 2)}`;
                expect(parseAmount(text)).toBeCloseTo(value, 8);
            }));
        });

        test('international format round-trips (1,200,000.00)', () => {
            fc.assert(fc.property(moneyArb, (value) => {
                const [int, frac = '00'] = String(value).split('.');
                const text = `${formatGrouped(int, ',', '.')}.${(frac + '00').slice(0, 2)}`;
                expect(parseAmount(text)).toBeCloseTo(value, 8);
            }));
        });

        test('malformed/mixed-separator input never throws (null instead)', () => {
            fc.assert(fc.property(fc.string(), (text) => {
                let result;
                expect(() => { result = parseAmount(text); }).not.toThrow();
                expect(result === null || Number.isFinite(result)).toBe(true);
            }));
        });
    });

    describe('parseDate', () => {
        // Generate real calendar dates via UTC construction (no invalid
        // Feb-30 style inputs), then render in both supported formats.
        const dateArb = fc.integer({ min: 0, max: 10957 }).map((days) => {
            const ts = Date.UTC(2000, 0, 1) + days * 24 * 60 * 60 * 1000;
            const d = new Date(ts);
            return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, day: d.getUTCDate(), ts };
        });
        const pad = (n) => String(n).padStart(2, '0');
        const iso = ({ y, m, day }) => `${y}-${pad(m)}-${pad(day)}`;
        const croatian = ({ y, m, day }) => `${day}.${m}.${y}.`;

        test('ISO format round-trips to the same day', () => {
            fc.assert(fc.property(dateArb, ({ ts, ...parts }) => {
                expect(parseDate(iso(parts))).toBe(ts);
            }));
        });

        test('Croatian dd.mm.yyyy. format round-trips to the same day', () => {
            fc.assert(fc.property(dateArb, ({ ts, ...parts }) => {
                expect(parseDate(croatian(parts))).toBe(ts);
            }));
        });

        test('chronological ordering is preserved across formats', () => {
            fc.assert(fc.property(dateArb, dateArb, (a, b) => {
                fc.pre(a.ts !== b.ts);
                const earlier = a.ts < b.ts ? a : b;
                const later = a.ts < b.ts ? b : a;
                // Cross-format: ISO for one side, Croatian for the other.
                expect(parseDate(iso(earlier))).toBeLessThan(parseDate(croatian(later)));
                expect(parseDate(croatian(earlier))).toBeLessThan(parseDate(iso(later)));
            }));
        });
    });

    describe('grouping-key stability', () => {
        const wordsArb = fc.array(
            fc.constantFrom('polog', 'troškove', 'stečajnog', 'postupka', 'tražbine', 'vjerovnika'),
            { minLength: 2, maxLength: 5 }
        );
        const shuffle = (arr) => {
            const out = [...arr];
            for (let i = out.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [out[i], out[j]] = [out[j], out[i]];
            }
            return out;
        };
        const stripDiacritics = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

        test('descriptionKey invariant under reorder/case/diacritics/whitespace', () => {
            fc.assert(fc.property(wordsArb, (words) => {
                const base = words.join(' ');
                const variants = [
                    shuffle(words).join(' '),
                    base.toUpperCase(),
                    stripDiacritics(base),
                    words.join('   \n\t '),
                ];
                const expected = descriptionKey(base);
                fc.pre(expected !== null);
                for (const variant of variants) {
                    expect(descriptionKey(variant)).toBe(expected);
                }
            }));
        });

        test('propertyGroupKey invariant under the same transformations (same assetType)', () => {
            fc.assert(fc.property(wordsArb, (words) => {
                const of = (description) => ({ description, assetType: 'pokretnina' });
                const expected = propertyGroupKey(of(words.join(' ')));
                fc.pre(expected !== null);
                expect(propertyGroupKey(of(shuffle(words).join(' ')))).toBe(expected);
                expect(propertyGroupKey(of(words.join(' ').toUpperCase()))).toBe(expected);
                expect(propertyGroupKey(of(stripDiacritics(words.join(' '))))).toBe(expected);
            }));
        });

        test('genuinely different descriptions key differently (sanity)', () => {
            expect(descriptionKey('Polog za troškove postupka')).not.toBe(
                descriptionKey('Prodaja proizvodnih strojeva Rijeka')
            );
        });
    });
});
