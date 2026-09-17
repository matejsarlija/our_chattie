const { reconcileMoneyFlows } = require('../../court-analysis/reasoning/reconciliation');

// sourceId is required (no shared default): entries that are supposed to
// represent different files must carry different ids, otherwise multi-entry
// tests silently exercise isSameDocument's same-id fallback path instead of
// the realistic different-file path their names claim to cover.
const entry = (overrides = {}) => {
    if (!overrides.sourceId) {
        throw new Error('entry() requires an explicit sourceId per entry — shared defaults mask same-document vs cross-document behavior.');
    }
    return {
        amount: 1000,
        currency: 'EUR',
        description: 'Polog za troškove postupka',
        fileName: 'dokument-1.pdf',
        ...overrides
    };
};

describe('reconcileMoneyFlows', () => {
    test('flags divergent amounts for the same purpose across documents', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1200, description: 'Polog za troškove stečajnog postupka', fileName: 'a.pdf', sourceId: 's-a' }),
                entry({ amount: 2500, description: 'polog za troskove stecajnog postupka', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].finding).toContain('1,200');
        expect(result.conflicts[0].finding).toContain('2,500');
        expect(result.conflicts[0].sources).toEqual(['s-a', 's-b']);
    });

    test('divergence conflicts carry reconciliation provenance tags (M-05)', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1200, description: 'Polog za troškove stečajnog postupka', fileName: 'a.pdf', sourceId: 's-a' }),
                entry({ amount: 2500, description: 'polog za troskove stecajnog postupka', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        expect(result.conflicts[0]).toEqual(expect.objectContaining({
            source: 'reconciliation',
            kind: 'arithmetic'
        }));
    });

    test('does not flag matching duplicate descriptions', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1200, sourceId: 's-a' }),
                entry({ amount: 1200.005, description: 'polog za troskove postupka', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
    });

    test('ignores generic one-token descriptions that would collide across documents', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 100, description: 'Iznos', fileName: 'a.pdf', sourceId: 's-a' }),
                entry({ amount: 99999, description: 'iznos razlicit', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        // 'iznos' alone is too short to group; 'razlicit' differs anyway.
        expect(result.conflicts).toHaveLength(0);
    });

    test('total-vs-parts mismatch becomes a validation warning, not a conflict or question (TR-1)', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 90000, description: 'Ukupno prijavljene tražbine', fileName: 'izvjestaj.pdf', sourceId: 's-izvjestaj' }),
                entry({ amount: 84500, description: 'Tražbina banke', fileName: 'izvjestaj.pdf', sourceId: 's-izvjestaj' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
        expect(result.openQuestions).toHaveLength(0);
        expect(result.validationWarnings).toHaveLength(1);
        expect(result.validationWarnings[0]).toEqual(expect.objectContaining({
            source: 'reconciliation',
            kind: 'arithmetic',
            check: 'total-vs-parts',
            text: expect.stringContaining('90,000')
        }));
        expect(result.validationWarnings[0].text).toContain('84,500');
        // Targeted row-recovery pointers travel with the warning.
        expect(result.validationWarnings[0].total).toEqual(expect.objectContaining({
            value: 90000,
            sourceId: 's-izvjestaj'
        }));
        expect(result.validationWarnings[0].parts).toHaveLength(1);
    });

    test('matching total suppresses the question entirely', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, description: 'Ukupno za naknade', sourceId: 's-doc' }),
                entry({ amount: 600, description: 'Naknada vjerovniku A', sourceId: 's-doc' }),
                entry({ amount: 400, description: 'Naknada upravitelju', sourceId: 's-doc' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
        expect(result.openQuestions).toHaveLength(0);
    });

    test('does not compare a total against parts from unrelated documents in the same case', () => {
        // Regression for a real production bug: a "total" line was being checked
        // against the sum of every non-total entry across the ENTIRE case
        // (hundreds of unrelated documents spanning years), producing a wildly
        // inflated, meaningless "sum of parts" and a nonsense openQuestion.
        // Totals only ever summarize line items within their own document.
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 90000, description: 'Ukupno prijavljene tražbine', fileName: 'izvjestaj.pdf', sourceId: 's-izvjestaj' }),
                entry({ amount: 1200000000, description: 'Namirenje vjerovnika', fileName: 'nepovezan-dokument.pdf', sourceId: 's-nepovezan' })
            ]
        });
        expect(result.openQuestions).toHaveLength(0);
    });

    test('empty money flow yields empty output without throwing', () => {
        expect(reconcileMoneyFlows(null)).toEqual({ conflicts: [], openQuestions: [], validationWarnings: [] });
        expect(reconcileMoneyFlows({ entries: [] })).toEqual({ conflicts: [], openQuestions: [], validationWarnings: [] });
    });

    test('K-03: equal values in HRK and EUR do not conflict (consolidated scale)', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, currency: 'EUR', amountEur: 1000, description: 'Polog za troškove stečajnog postupka', fileName: 'a.pdf', sourceId: 's-a' }),
                entry({ amount: 7534.5, currency: 'HRK', amountEur: 1000, description: 'polog za troskove stecajnog postupka', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
    });

    test('K-03: genuinely different values across currencies still conflict on EUR scale', () => {        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, currency: 'EUR', amountEur: 1000, description: 'Polog za troškove stečajnog postupka', fileName: 'a.pdf', sourceId: 's-a' }),
                entry({ amount: 15000, currency: 'HRK', amountEur: 1991.01, description: 'polog za troskove stecajnog postupka', fileName: 'b.pdf', sourceId: 's-b' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].finding).toContain('EUR');
    });

    test('TR-2: one figure stated twice in the same filing (HRK + EUR) collapses silently', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 355134652.87, currency: 'HRK', amountEur: 47134468.55, description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'izvjestaj.pdf', sourceId: 's-doc', sourceDocumentLinkId: 'link-1' }),
                entry({ amount: 47134468.49, currency: 'EUR', amountEur: 47134468.49, description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'izvjestaj.pdf', sourceId: 's-doc', sourceDocumentLinkId: 'link-1' })
            ]
        });
        // Conversion dust (0.06) would trip the absolute divergence rule
        // without the same-source dual-statement collapse.
        expect(result.conflicts).toHaveLength(0);
        expect(result.openQuestions).toHaveLength(0);
        expect(result.validationWarnings).toHaveLength(0);
    });

    test('TR-2: same filing restating one figure in both currencies collapses (dual ratio)', () => {
        // Kerum shape, one source: HRK 355,134,652.87 (= 47,134,468.49 EUR at
        // the fixed rate) plus a separately stated 355,134,652 EUR line. The
        // 7.53450 relationship is established by the filing itself (§4.4.2),
        // so no arithmetic conflict fires. Residual risk (a mislabeled EUR tag
        // hiding inside a routine dual display) is deliberately not flagged:
        // same-document dual display is routine, and flagging it would
        // recreate the noise this track removes. Cross-source pairs stay
        // reviewable (next test).
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 355134652.87, currency: 'HRK', amountEur: 47134468.49, description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'izvjestaj.pdf', sourceId: 's-doc', sourceDocumentLinkId: 'link-1' }),
                entry({ amount: 355134652, currency: 'EUR', description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'izvjestaj.pdf', sourceId: 's-doc', sourceDocumentLinkId: 'link-1' })
            ]
        });
        expect(result.conflicts).toHaveLength(0);
        expect(result.openQuestions).toHaveLength(0);
        expect(result.validationWarnings).toHaveLength(0);
    });

    test('TR-2: cross-source HRK/EUR mismatch stays reviewable with both raw values', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 355134652.87, currency: 'HRK', amountEur: 47134468.49, description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'izvjestaj-2024.pdf', sourceId: 's-2024' }),
                entry({ amount: 355134652, currency: 'EUR', description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'izvjestaj-2025.pdf', sourceId: 's-2025' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0].finding).toContain('355,134,652.87 HRK');
        expect(result.conflicts[0].finding).toContain('355,134,652 EUR');
    });

    test('TR-2 regression: shared local path does not collapse dual values from distinct filings', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 355134652.87, currency: 'HRK', amountEur: 47134468.49, description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'Podnesak.pdf', sourceId: '/tmp/Podnesak.pdf', sourceDocumentLinkId: 'St-2/2013::entry-1::doc-1' }),
                entry({ amount: 355134652, currency: 'EUR', description: 'Iznos prijavljenih tražbina razlučnih vjerovnika', fileName: 'Podnesak.pdf', sourceId: '/tmp/Podnesak.pdf', sourceDocumentLinkId: 'St-2/2013::entry-2::doc-1' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
    });

    test('TR-2: same-source all-EUR figures at a coincidental 7.5x ratio still conflict', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, currency: 'EUR', description: 'Naknada upravitelju', fileName: 'x.pdf', sourceId: 's-x' }),
                entry({ amount: 7534.5, currency: 'EUR', description: 'Naknada upravitelju', fileName: 'x.pdf', sourceId: 's-x' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
    });

    test('TL-2: amountRole total is detected without keyword markers', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 96500, description: 'Zbroj potraživanja na dan', amountRole: 'total', fileName: 'popis.pdf', sourceId: 's-doc' }),
                entry({ amount: 84500, description: 'Glavnica vjerovnika Alfa', amountRole: 'line_item', fileName: 'popis.pdf', sourceId: 's-doc' }),
                entry({ amount: 12000, description: 'Zatezne kamate vjerovnika Beta', amountRole: 'line_item', fileName: 'popis.pdf', sourceId: 's-doc' })
            ]
        });
        // 84,500 + 12,000 = 96,500 matches the role-declared total: silent.
        expect(result.conflicts).toHaveLength(0);
        expect(result.validationWarnings).toHaveLength(0);
    });

    test('TL-2: amountRole overrides keyword guessing in both directions', () => {
        // 'Ukupno' in the description but role says line_item → treated as part.
        const lineItem = reconcileMoneyFlows({
            entries: [
                entry({ amount: 96500, description: 'Ukupno potraživanje', amountRole: 'total', fileName: 'x.pdf', sourceId: 's-x' }),
                entry({ amount: 90000, description: 'Ukupno djelomično namirenje', amountRole: 'line_item', fileName: 'x.pdf', sourceId: 's-x' })
            ]
        });
        expect(lineItem.validationWarnings).toHaveLength(1);

        // No keyword anywhere, but role declares the total → still caught.
        const roleOnly = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, description: 'Zbroj potraživanja na dan', amountRole: 'total', fileName: 'y.pdf', sourceId: 's-y' }),
                entry({ amount: 600, description: 'Glavnica', fileName: 'y.pdf', sourceId: 's-y' })
            ]
        });
        expect(roleOnly.validationWarnings).toHaveLength(1);
        expect(roleOnly.validationWarnings[0]).toEqual(expect.objectContaining({ check: 'total-vs-parts' }));
    });

    test('TR-2: same-source mixed-currency pair with a genuine gap still conflicts', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 100000, currency: 'HRK', amountEur: 13272.28, description: 'Trošak objave', fileName: 'x.pdf', sourceId: 's-x' }),
                entry({ amount: 20000, currency: 'EUR', description: 'Trošak objave', fileName: 'x.pdf', sourceId: 's-x' })
            ]
        });
        expect(result.conflicts).toHaveLength(1);
    });

    test('K-03: cross-currency totals compare on the EUR scale (HRK part joins the EUR sum)', () => {
        // Total 1,000 EUR vs one HRK part worth 2,000 EUR in the same
        // document: on the EUR scale the sum (2,000) mismatches the total →
        // one question quoting the EUR-scale sum. A raw same-currency-only
        // comparison would see no EUR parts and stay silent.
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 1000, currency: 'EUR', amountEur: 1000, description: 'Ukupno za naknade', fileName: 'izvjestaj.pdf', sourceId: 's-doc' }),
                entry({ amount: 15069, currency: 'HRK', amountEur: 2000, description: 'Naknada vjerovniku A', fileName: 'izvjestaj.pdf', sourceId: 's-doc' })
            ]
        });
        expect(result.openQuestions).toHaveLength(0);
        expect(result.validationWarnings).toHaveLength(1);
        expect(result.validationWarnings[0].text).toContain('2,000 EUR');
    });

    test('K-04: dual-mismatch entries produce their own reconciliation question', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({
                    amount: 248.86, currency: 'EUR', amountEur: 248.86, amountEurSource: 'stated',
                    currencyNote: 'dual-mismatch',
                    dualCurrency: { statedEur: 248.86, statedHrk: 1500, convertedEur: 199.1, deviationPct: 24.97 },
                    description: 'Sporni trošak postupka', fileName: 'x.pdf', sourceId: 's-x'
                })
            ]
        });
        expect(result.openQuestions).toHaveLength(1);
        expect(result.openQuestions[0]).toEqual(expect.objectContaining({
            source: 'reconciliation', kind: 'arithmetic',
        }));
        expect(result.openQuestions[0].text).toContain('7.53450');
    });

    test('isSameDocument: same display name on different files is not the same document', () => {
        const { isSameDocument } = require('../../court-analysis/reasoning/reconciliation');
        expect(isSameDocument(
            entry({ fileName: 'Podnesak.pdf', sourceId: '/tmp/a.pdf' }),
            entry({ fileName: 'Podnesak.pdf', sourceId: '/tmp/b.pdf' })
        )).toBe(false);
        expect(isSameDocument(
            entry({ fileName: 'izvjestaj.pdf', sourceId: '/tmp/a.pdf' }),
            entry({ fileName: 'izvjestaj.pdf', sourceId: '/tmp/a.pdf' })
        )).toBe(true);
        // Legacy entries without a stable id keep the fileName-equality path.
        expect(isSameDocument({ fileName: 'x.pdf' }, { fileName: 'x.pdf' })).toBe(true);
        expect(isSameDocument({ fileName: 'x.pdf' }, { fileName: 'y.pdf' })).toBe(false);
    });

    test('total-vs-parts ignores same-named totals from unrelated files', () => {
        const result = reconcileMoneyFlows({
            entries: [
                entry({ amount: 90000, description: 'Ukupno prijavljene tražbine', fileName: 'Podnesak.pdf', sourceId: '/tmp/a.pdf' }),
                entry({ amount: 84500, description: 'Tražbina banke', fileName: 'Podnesak.pdf', sourceId: '/tmp/b.pdf' })
            ]
        });
        expect(result.openQuestions).toHaveLength(0);
    });
});

describe('dedupeQuestions (TD-3)', () => {
    const { dedupeQuestions } = require('../../court-analysis/reasoning/reconciliation');

    test('folds the same totals pair repeated across filings into one question with provenance', () => {
        const docs = ['Zalba-1.pdf', 'Rjesenje-2.pdf', 'Podnesak-3.pdf', 'Zalba-4.pdf', 'Rjesenje-5.pdf'];
        const entries = docs.flatMap((fileName, i) => ([
            entry({ amount: 1117223.43, description: 'Ukupno potraživanje', fileName, sourceId: `s-t-${i}` }),
            entry({ amount: 3000000, description: 'Glavnica potraživanja', fileName, sourceId: `s-t-${i}` }),
            entry({ amount: 841706.15, description: 'Zatezne kamate', fileName, sourceId: `s-t-${i}` })
        ]));
        const result = reconcileMoneyFlows({ entries });
        // TR-1 moved same-document totals to extraction-validation warnings;
        // TD-3 folds the repeats there instead of in openQuestions.
        const totals = result.validationWarnings.filter((q) => q.text.includes('Navodni ukupni iznos'));

        // 5 documents × same pair → one folded warning, all filings retained.
        expect(totals).toHaveLength(1);
        expect(totals[0].occurrences).toBe(5);
        expect(totals[0].documents).toEqual(expect.arrayContaining(docs));
        expect(totals[0].documents).toHaveLength(5);
        expect(result.openQuestions.filter((q) => q.text.includes('Navodni ukupni iznos'))).toHaveLength(0);
    });

    test('distinct pairs never fold together', () => {
        const folded = dedupeQuestions([
            { text: 'Navodni ukupni iznos 1,000 EUR (a.pdf) ne odgovara zbroju 900 EUR.', source: 'reconciliation', kind: 'arithmetic' },
            { text: 'Navodni ukupni iznos 2,000 EUR (b.pdf) ne odgovara zbroju 900 EUR.', source: 'reconciliation', kind: 'arithmetic' }
        ]);
        expect(folded).toHaveLength(2);
        expect(folded.every((q) => q.occurrences === undefined)).toBe(true);
        expect(folded[0].documents).toEqual(['a.pdf']);
    });

    test('tolerates string inputs and questions without document names', () => {
        expect(dedupeQuestions(null)).toEqual([]);
        expect(dedupeQuestions(['plain warning'])).toEqual([
            { text: 'plain warning', source: 'reconciliation', kind: 'arithmetic', documents: [] }
        ]);
    });
});

describe('reconcileFlows (unified engine)', () => {
    const { reconcileFlows } = require('../../court-analysis/reasoning/reconciliation');
    const { collectFlows } = require('../../court-analysis/reasoning/flow');

    const flowAnalyses = [
        {
            id: 'a-1',
            fileName: 'izvjestaj.pdf',
            caseNumber: 'Stč-2150/2022',
            amounts: [
                { description: 'Ukupno prijavljene tražbine', amount: 90000, currency: 'EUR' },
                { description: 'Tražbina banke', amount: 84500, currency: 'EUR' },
            ],
            propertyFlow: [
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', transferee: 'Kupac A d.o.o.', value: 25000, currency: 'EUR' },
            ],
        },
        {
            id: 'a-2',
            fileName: 'rjesenje.pdf',
            caseNumber: 'Stč-2150/2022',
            amounts: [
                { description: 'Polog za troškove stečajnog postupka', amount: 1200, currency: 'EUR' },
            ],
            propertyFlow: [
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', transferee: 'Kupac B d.o.o.', value: 18000, currency: 'EUR' },
            ],
        },
    ];

    test('divergent groups fire per kind with their own texts', () => {
        const result = reconcileFlows(collectFlows(flowAnalyses), {});
        // Only the property strojevi pair diverges (25,000 vs 18,000 +
        // different buyers); no money group and no lifecycle chain here.
        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0]).toEqual(expect.objectContaining({
            source: 'reconciliation',
            kind: 'property',
        }));
    });

    test('money totals still compare against money parts only (no cross-vocabulary double count)', () => {
        const result = reconcileFlows(collectFlows(flowAnalyses), {});
        // TR-1: totals route to extraction-validation warnings, partitioned by
        // kind exactly like the questions they replace.
        const totalWarnings = result.validationWarnings.filter((q) => q.text.includes('Navodni ukupni iznos'));
        expect(totalWarnings).toHaveLength(1);
        // 90,000 vs money parts only (84,500) — the 25,000 property value for
        // the same sale must not inflate the sum.
        expect(totalWarnings[0].text).toContain('84,500');
        expect(totalWarnings[0].kind).toBe('arithmetic');
        expect(result.openQuestions.filter((q) => q.text.includes('Navodni ukupni iznos'))).toHaveLength(0);
    });

    test('asset-value totals are caught against asset parts (new capability)', () => {
        const result = reconcileFlows(collectFlows([
            {
                id: 'a-9',
                fileName: 'popis.pdf',
                caseNumber: 'Stč-2150/2022',
                amounts: [],
                propertyFlow: [
                    { description: 'Ukupna vrijednost pokretne imovine društva', assetType: 'pokretnina', value: 50000, currency: 'EUR' },
                    { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', value: 25000, currency: 'EUR' },
                ],
            },
        ]), {});
        const totalWarnings = result.validationWarnings.filter((q) => q.text.includes('Navodni ukupni iznos'));
        expect(totalWarnings).toHaveLength(1);
        expect(totalWarnings[0].kind).toBe('property');
        expect(totalWarnings[0].text).toContain('50,000');
        expect(totalWarnings[0].text).toContain('25,000');
    });

    test('dual-mismatch residue fires per origin kind over the whole array', () => {
        const result = reconcileFlows(collectFlows([
            {
                id: 'a-9',
                fileName: 'x.pdf',
                caseNumber: 'Stč-2150/2022',
                amounts: [
                    { description: 'Sporni trošak postupka', amount: 248.86, currency: 'EUR', amountHrk: 1500 },
                ],
                propertyFlow: [
                    {
                        description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina',
                        value: 248.86, currency: 'EUR', amountHrk: 1500,
                    },
                ],
            },
        ]), {});
        const residue = result.openQuestions.filter((q) => q.text.includes('7.53450'));
        expect(residue).toHaveLength(2);
        expect(residue.map((q) => q.kind).sort()).toEqual(['arithmetic', 'property']);
    });

    test('empty flows yield empty output without throwing', () => {
        expect(reconcileFlows(null, {})).toEqual({ conflicts: [], openQuestions: [], validationWarnings: [], valueChanges: [] });
        expect(reconcileFlows({ entries: [] }, {})).toEqual({ conflicts: [], openQuestions: [], validationWarnings: [], valueChanges: [] });
    });
});
