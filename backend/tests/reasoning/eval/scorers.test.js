const { retrievalRecallAtK, retrievalMrr, amountScore, conflictDetectionRate } = require('../../../court-analysis/reasoning/eval/scorers');

// Minimal builders: matches carry only the fields scorers read (text,
// sourceId) plus rank for MRR ordering.
const retrieval = (matchesPerQuery) => ({
    results: matchesPerQuery.map((matches, i) => ({ query: { id: `q${i + 1}` }, matches }))
});

const gold = (...textIncludes) => ({ citationSpans: textIncludes.map((t) => ({ textIncludes: t })) });

describe('eval scorers', () => {
    describe('retrievalRecallAtK', () => {
        test('counts spans found within top-k per query, unioned across queries', () => {
            const result = retrievalRecallAtK(
                retrieval([
                    [{ sourceId: 'a', text: 'Prva rečenica o stečaju' }],
                    [
                        { sourceId: 'b', text: 'Druga o tražbinama' },
                        { sourceId: 'c', text: 'Treća o prodaji imovine' }
                    ]
                ]),
                gold('o stečaju', 'prodaji imovine', 'nepostojeća fraza'),
                2
            );
            expect(result.value).toBeCloseTo(2 / 3);
            expect(result.details.missedSpanIndexes).toEqual([2]);
        });

        test('k limits the per-query window', () => {
            const deep = retrieval([[{ sourceId: 'y', text: 'filler' }, { sourceId: 'x', text: 'duboko zakopana fraza' }]]);
            expect(retrievalRecallAtK(deep, gold('zakopana'), 1).value).toBe(0);
            expect(retrievalRecallAtK(deep, gold('zakopana'), 2).value).toBe(1);
        });

        test('sourceId pinning rejects same phrase in the wrong source', () => {
            const pinned = retrieval([[{ sourceId: 'a', text: 'fraza u krivom izvoru' }, { sourceId: 'b', text: 'bez fraze' }]]);
            expect(retrievalRecallAtK(pinned, { citationSpans: [{ textIncludes: 'fraza', sourceId: 'b' }] }, 5).value).toBe(0);
            expect(retrievalRecallAtK(pinned, { citationSpans: [{ textIncludes: 'fraza', sourceId: 'a' }] }, 5).value).toBe(1);
        });

        test('diacritics/case are normalized on both sides', () => {
            const r = retrieval([[{ sourceId: 'a', text: 'TRAGAČKI ZAKLJUČAK donesen' }]]);
            expect(retrievalRecallAtK(r, gold('tragački zaključak'), 5).value).toBe(1);
        });
    });

    describe('retrievalMrr', () => {
        test('rewards early first hits across queries', () => {
            const mrr = retrievalMrr(
                retrieval([
                    [{ text: 'šum' }, { text: 'tražbina vjerovnika' }]
                ]),
                gold('tražbina')
            );
            expect(mrr.value).toBeCloseTo(1 / 2);
        });

        test('zero when nothing relevant is retrieved', () => {
            expect(retrievalMrr(retrieval([[{ text: 'ništa' }]]), gold('tražbina')).value).toBe(0);
        });
    });

    describe('amountScore', () => {
        test('perfect match yields f1 of 1', () => {
            const score = amountScore([{ amount: 1200, currency: 'EUR', description: 'polog' }], {
                expectedAmounts: [{ value: 1200, currency: 'EUR', tolerancePct: 0.001 }]
            });
            expect(score.value).toBe(1);
            expect(score.details.tp).toBe(1);
            expect(score.details.fp).toBe(0);
        });

        test('tolerance boundary and currency mismatch behave as specified', () => {
            const withinTolerance = amountScore(
                [{ amount: 1201, currency: 'EUR' }],
                { expectedAmounts: [{ value: 1200, currency: 'EUR', tolerancePct: 0.001 }] }
            );
            expect(withinTolerance.details.tp).toBe(1);

            const wrongCurrency = amountScore(
                [{ amount: 1200, currency: 'HRK' }],
                { expectedAmounts: [{ value: 1200, currency: 'EUR' }] }
            );
            expect(wrongCurrency.details.tp).toBe(0);
            expect(wrongCurrency.details.fn).toBe(1);
        });

        test('descriptionIncludes disambiguates equal-value entries', () => {
            const entries = [{ amount: 25000, currency: 'EUR', description: 'Prodaja strojeva' }, { amount: 25000, currency: 'EUR', description: 'Najam prostorija' }];
            expect(amountScore(entries, { expectedAmounts: [{ value: 25000, currency: 'EUR', descriptionIncludes: 'strojeva' }] }).details.tp).toBe(1);
            expect(amountScore(entries, { expectedAmounts: [{ value: 25000, currency: 'EUR', descriptionIncludes: 'nepoznata namjena' }] }).details.tp).toBe(0);
        });

        test('hallucinated extra amounts reduce precision via fp', () => {
            const score = amountScore(
                [{ amount: 100, currency: 'EUR' }, { amount: 999999, currency: 'EUR' }],
                { expectedAmounts: [{ value: 100, currency: 'EUR' }] }
            );
            expect(score.details.precision).toBeCloseTo(0.5);
            expect(score.details.f1 ?? score.value).toBeGreaterThan(0);
        });
    });

    describe('conflictDetectionRate', () => {
        test('is zero with an empty ledger (honest denominator)', () => {
            const r = conflictDetectionRate([], ['anything']);
            expect(r.value).toBe(0);
            expect(r.details.reason).toBe('nothing-applied');
        });

        test('counts detected mutations over applied', () => {
            const applied = [
                { kind: 'amount-mismatch', fileName: 'a.pdf', before: 1, after: 2 },
                { kind: 'date-conflict', fileName: null, before: '2022-01-01', after: '2024-01-01' }
            ];
            const r = conflictDetectionRate(applied, ['Problem s a.pdf', 'Datum 2024-01-01 je sumnjiv']);
            expect(r.value).toBe(1);
            expect(r.details.detectedCount).toBe(2);

            const partial = conflictDetectionRate(applied, ['Samo a.pdf se spominje']);
            expect(partial.value).toBeCloseTo(0.5);
        });
    });
});
