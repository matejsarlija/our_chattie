const {
    collectFlows,
    derivePropertyFlowView,
    normalizeFlowItem,
    inferAssetType,
    normalizeCurrency,
    parseAmount,
    normalizeDirection,
    normalizeOib,
} = require('../../court-analysis/reasoning/flow');

const analysis = (overrides = {}) => ({
    id: 'a-1',
    fileName: 'doc.pdf',
    caseNumber: 'St-1/2024',
    entryDate: '2023-05-17',
    ...overrides,
});

describe('reasoning flow (unified normalize + collect)', () => {
    describe('assetType inference/hinting boundary', () => {
        test('amounts path is always novac regardless of raw.assetType', () => {
            const entry = normalizeFlowItem(
                { description: 'Polog', amount: 100, currency: 'EUR', assetType: 'nekretnina' },
                0,
                analysis(),
                { assetTypeHint: 'novac' }
            );
            expect(entry.assetType).toBe('novac');
        });

        test('property path infers assetType, defaults to drugo', () => {
            expect(inferAssetType({ assetType: 'tražbina' }, null)).toBe('tražbina');
            expect(inferAssetType({ assetType: 'trazbina' }, null)).toBe('tražbina');
            expect(inferAssetType({ assetType: 'pokretnina' }, null)).toBe('pokretnina');
            expect(inferAssetType({}, null)).toBe('drugo');
            expect(inferAssetType({ assetType: 'avion' }, null)).toBe('drugo');
            // 'novac' is never inferred, only hinted.
            expect(inferAssetType({ assetType: 'novac' }, null)).toBe('drugo');
        });

        test('collectFlows keeps the two source arrays in separate lanes', () => {
            const flows = collectFlows([
                {
                    ...analysis({ id: 'a-1', fileName: 'a.pdf' }),
                    amounts: [{ description: 'Polog', amount: 100, currency: 'EUR' }],
                    propertyFlow: [{ description: 'Strojevi pogona Rijeka', assetType: 'pokretnina', value: 5000, currency: 'EUR' }],
                },
                {
                    ...analysis({ id: 'a-2', fileName: 'b.pdf' }),
                    amounts: [{ description: 'Pristojba', amount: 50, currency: 'EUR' }],
                    propertyFlow: [],
                },
            ]);
            expect(flows.count).toBe(3);
            expect(flows.entries.map((e) => e.assetType)).toEqual(['novac', 'pokretnina', 'novac']);
            expect(flows.entries.map((e) => e.id)).toEqual(['flow-1', 'flow-2', 'flow-3']);
            expect(flows.hasFlows).toBe(true);
        });

        test('malformed raws drop per their own path rules', () => {
            // Money path: unparseable figure drops even with a description.
            expect(normalizeFlowItem({ description: 'X' }, 0, analysis(), { assetTypeHint: 'novac' })).toBeNull();
            // Property path: missing description drops even with a value.
            expect(normalizeFlowItem({ assetType: 'pokretnina', value: 5 }, 0, analysis())).toBeNull();
            // Property path: unparseable value is kept (permissive rule).
            expect(normalizeFlowItem(
                { description: 'Imovina bez vrijednosti', assetType: 'pokretnina', value: 'neodređeno' },
                0,
                analysis()
            )).toEqual(expect.objectContaining({ value: null }));
            expect(normalizeFlowItem(null, 0, analysis())).toBeNull();
        });
    });

    describe('value/currency/EUR/dual-currency', () => {
        test('money precedence (amount wins) vs property precedence (value wins)', () => {
            const money = normalizeFlowItem(
                { description: 'X', amount: 100, value: 200, currency: 'EUR' },
                0, analysis(), { assetTypeHint: 'novac' }
            );
            const prop = normalizeFlowItem(
                { description: 'Strojevi pogona Rijeka', amount: 100, value: 200, currency: 'EUR', assetType: 'pokretnina' },
                0, analysis()
            );
            expect(money.value).toBe(100);
            expect(prop.value).toBe(200);
        });

        test('Croatian number format and EUR consolidation', () => {
            expect(parseAmount('1.200.000,00')).toBe(1200000);
            const entry = normalizeFlowItem(
                { description: 'Stara obveza', amount: '7.534,50', currency: 'HRK' },
                0, analysis(), { assetTypeHint: 'novac' }
            );
            expect(entry).toEqual(expect.objectContaining({ valueEur: 1000, valueEurSource: 'converted' }));
        });

        test('source-stated dual figures prefer EUR and record the pair', () => {
            const entry = normalizeFlowItem(
                {
                    description: 'Trošak prijeboja postupka',
                    amount: '248,86', currency: 'EUR',
                    quote: 'Trošak prijeboja iznosi 248,86 € (1.875,oo kn).',
                },
                0, analysis(), { assetTypeHint: 'novac' }
            );
            expect(entry).toEqual(expect.objectContaining({
                valueEur: 248.86,
                valueEurSource: 'stated',
                dualCurrency: expect.objectContaining({ statedEur: 248.86, statedHrk: 1875 }),
            }));
        });
    });

    describe('date fallback + provenance', () => {
        test('extracted date wins, entryDate fills the gap', () => {
            expect(normalizeFlowItem(
                { description: 'X', amount: 1, currency: 'EUR', date: '2022-01-10' }, 0, analysis()
                , { assetTypeHint: 'novac' }).date).toBe('2022-01-10');
            expect(normalizeFlowItem(
                { description: 'X', amount: 1, currency: 'EUR' }, 0, analysis(), { assetTypeHint: 'novac' }
            ).date).toBe('2023-05-17');
            expect(normalizeFlowItem(
                { description: 'X', amount: 1, currency: 'EUR' }, 0, { id: 'a-9' }, { assetTypeHint: 'novac' }
            ).date).toBeNull();
        });

        test('provenance threads through from the analysis record', () => {
            const entry = normalizeFlowItem(
                { description: 'X', amount: 1, currency: 'EUR' }, 0,
                analysis({ sourceEntryIndex: 2, sourceDocumentLinkId: 'link-1' }),
                { assetTypeHint: 'novac' }
            );
            expect(entry).toEqual(expect.objectContaining({
                sourceId: 'a-1', fileName: 'doc.pdf', caseNumber: 'St-1/2024',
                sourceEntryIndex: 2, sourceDocumentLinkId: 'link-1',
            }));
        });
    });

    describe('transferor/transferee unification', () => {
        test('money payer/recipient aliases land on canonical fields', () => {
            const entry = normalizeFlowItem({
                description: 'Tražbina', amount: 1000, currency: 'EUR',
                payerName: 'Kerum d.o.o.', payerOib: '66124057408',
                recipientName: 'CroGo d.o.o.', recipientOib: '12345678901',
            }, 0, analysis(), { assetTypeHint: 'novac' });
            expect(entry).toEqual(expect.objectContaining({
                transferor: 'Kerum d.o.o.', transferorOib: '66124057408',
                transferee: 'CroGo d.o.o.', transfereeOib: '12345678901',
                // Non-canonical aliases preserved for the derived money view.
                payerName: 'Kerum d.o.o.', from: 'Kerum d.o.o.',
                recipientName: 'CroGo d.o.o.', to: 'CroGo d.o.o.',
            }));
        });

        test('property transferor/transferee pass through unchanged', () => {
            const entry = normalizeFlowItem({
                description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina',
                transferor: 'Ducanor d.o.o.', transferee: 'Kupac A d.o.o.',
                value: 25000, currency: 'EUR',
            }, 0, analysis());
            expect(entry).toEqual(expect.objectContaining({
                transferor: 'Ducanor d.o.o.', transferee: 'Kupac A d.o.o.',
            }));
        });
    });

    describe('direction gating', () => {
        test('direction populates for novac and tražbina only, never backfilled', () => {
            expect(normalizeDirection('dosuđeno')).toBe('awarded');
            expect(normalizeOib('66124057408')).toBe('66124057408');
            expect(normalizeCurrency('kn')).toBe('HRK');
            const money = normalizeFlowItem(
                { description: 'X', amount: 1, currency: 'EUR', direction: 'obveza' },
                0, analysis(), { assetTypeHint: 'novac' }
            );
            const traz = normalizeFlowItem(
                { description: 'Tražbina vjerovnika prema dužniku', assetType: 'tražbina', eventType: 'prijava', value: 5, currency: 'EUR' },
                0, analysis()
            );
            const sale = normalizeFlowItem(
                { description: 'Proizvodni strojevi pogona Rijeka', assetType: 'pokretnina', value: 5, currency: 'EUR' },
                0, analysis()
            );
            expect(money.direction).toBe('obveza');
            // Property prompt never extracts direction → null, not guessed from eventType.
            expect(traz.direction).toBeNull();
            expect(sale.direction).toBeNull();
        });
    });

    describe('lifecycle fields + legacy supersedes rewrite', () => {
        test('eventType/supersedes only survive on tražbina', () => {
            const traz = normalizeFlowItem(
                { description: 'Tražbina vjerovnika', assetType: 'tražbina', eventType: 'ustup', supersedes: 'nešto', value: 5, currency: 'EUR' },
                0, analysis()
            );
            const sale = normalizeFlowItem(
                { description: 'Proizvodni strojevi pogona', assetType: 'pokretnina', eventType: 'ustup', supersedes: 'nešto', value: 5, currency: 'EUR' },
                0, analysis()
            );
            expect(traz.eventType).toBe('ustup');
            expect(traz.supersedes).toBe('nešto');
            expect(sale.eventType).toBeNull();
            expect(sale.supersedes).toBeUndefined();
        });

        test('legacy prop-N supersedes rewrites to the unified id', () => {
            const flows = collectFlows([
                {
                    ...analysis(),
                    amounts: [],
                    propertyFlow: [
                        { description: 'Tražbina vjerovnika prema dužniku', assetType: 'tražbina', eventType: 'prijava', value: 84500, currency: 'EUR' },
                        { description: 'Tražbina vjerovnika prema dužniku', assetType: 'tražbina', eventType: 'ustup', value: 15000, currency: 'EUR', supersedes: 'prop-1' },
                    ],
                },
            ]);
            expect(flows.entries[1].supersedes).toBe('flow-1');
        });
    });

    describe('entry duplicate handling', () => {
        const assignment = (overrides = {}) => ({
            description: 'Ustup tražbine od Banke A na Društvo B',
            assetType: 'tražbina',
            eventType: 'ustup',
            transferor: 'Banka A',
            transferee: 'Društvo B',
            value: 27888441.11,
            currency: 'EUR',
            date: '2019-09-27',
            claimRegistryNumber: '200',
            isplatniRed: 'II. višeg isplatnog reda',
            ...overrides,
        });

        test('dedupes paraphrases within one unhashed source and retains provenance/count', () => {
            const flows = collectFlows([{
                ...analysis({ sourceEntryIndex: 4, sourceDocumentLinkId: 'link-a' }),
                amounts: [],
                propertyFlow: [
                    assignment(),
                    assignment({
                        description: 'Ustup i prijenos prava i tražbina',
                        claimRegistryNumber: null,
                        isplatniRed: 'drugi viši isplatni red',
                        filingReference: 'OV – 8580/19',
                    }),
                    assignment({
                        description: 'Ustup tražbine Zagrebačke banke na DDM INVEST III AG',
                        filingReference: 'OV - 8580/19',
                    }),
                ],
            }]);

            expect(flows.entries).toHaveLength(1);
            expect(flows.entries[0]).toEqual(expect.objectContaining({
                duplicateCount: 3,
                filingReference: 'OV – 8580/19',
                sources: ['a-1'],
                filings: [expect.objectContaining({
                    sourceId: 'a-1',
                    sourceEntryIndex: 4,
                    sourceDocumentLinkId: 'link-a',
                })],
            }));
            expect(derivePropertyFlowView(flows).entries[0]).toEqual(expect.objectContaining({
                duplicateCount: 3,
                descriptionVariants: [
                    'Ustup tražbine od Banke A na Društvo B',
                    'Ustup i prijenos prava i tražbina',
                    'Ustup tražbine Zagrebačke banke na DDM INVEST III AG',
                ],
                sources: ['a-1'],
                filings: [expect.objectContaining({ sourceDocumentLinkId: 'link-a' })],
            }));
        });

        test('keeps conflicting filings and unhashed filename collisions apart', () => {
            const first = {
                ...analysis({ id: 'uploads/Podnesak.pdf', sourceEntryIndex: 4, sourceDocumentLinkId: 'link-a' }),
                amounts: [],
                propertyFlow: [assignment({ filingReference: 'OV - 8580/19' })],
            };
            const distinctFiling = {
                ...analysis({ id: 'uploads/Podnesak.pdf', sourceEntryIndex: 4, sourceDocumentLinkId: 'link-a' }),
                amounts: [],
                propertyFlow: [assignment({ filingReference: 'St - 2/2013' })],
            };
            const samePathDifferentFiling = {
                ...analysis({ id: 'uploads/Podnesak.pdf', sourceEntryIndex: 5, sourceDocumentLinkId: 'link-b' }),
                amounts: [],
                propertyFlow: [assignment({ filingReference: 'OV - 8580/19' })],
            };
            const differentBytes = {
                ...analysis({ id: 'uploads/Podnesak.pdf', contentHash: 'other-bytes' }),
                amounts: [],
                propertyFlow: [assignment({ filingReference: 'OV - 8580/19' })],
            };

            expect(collectFlows([first, distinctFiling, samePathDifferentFiling, differentBytes]).entries).toHaveLength(4);
        });

        test('byte-identical attachments still merge across filings with paraphrased descriptions', () => {
            const flows = collectFlows([
                {
                    ...analysis({ id: 'a-1', sourceEntryIndex: 4, sourceDocumentLinkId: 'link-a', contentHash: 'same-bytes' }),
                    amounts: [],
                    propertyFlow: [assignment({ filingReference: 'OV – 8580/19' })],
                },
                {
                    ...analysis({ id: 'a-2', sourceEntryIndex: 5, sourceDocumentLinkId: 'link-b', contentHash: 'same-bytes' }),
                    amounts: [],
                    propertyFlow: [assignment({
                        description: 'Ustup i prijenos prava i tražbina',
                        claimRegistryNumber: '200.',
                        isplatniRed: 'drugi viši isplatni red',
                        filingReference: 'OV - 8580/19',
                        date: '27.09.2019.',
                    })],
                },
            ]);

            expect(flows.entries).toHaveLength(1);
            expect(flows.entries[0].duplicateCount).toBe(2);
            expect(flows.entries[0].filings).toHaveLength(2);
        });
    });

    describe('totals shape', () => {
        test('empty input → empty output, no errors', () => {
            expect(collectFlows([])).toEqual({ count: 0, entries: [], currencyTotals: {}, hasFlows: false });
            expect(collectFlows(null)).toEqual({ count: 0, entries: [], currencyTotals: {}, hasFlows: false });
        });

        test('currencyTotals + eurTotal consolidate across families', () => {
            const flows = collectFlows([
                {
                    ...analysis(),
                    amounts: [{ description: 'Isplata', amount: 1000, currency: 'EUR' }],
                    propertyFlow: [{ description: 'Strojevi pogona Rijeka', assetType: 'pokretnina', value: 7534.5, currency: 'HRK' }],
                },
            ]);
            expect(flows.currencyTotals).toEqual({ EUR: 1000, HRK: 7534.5 });
            expect(flows.eurTotal).toBe(2000);
        });
    });
});
