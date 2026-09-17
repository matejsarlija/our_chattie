const {
    MAX_SIGNIFICANCE_ITEMS,
    buildSignificanceShortlist,
    buildSignificancePrompt,
    parseSignificanceRanking,
    runSignificance,
    applySignificance
} = require('../../court-analysis/reasoning/significance');

describe('buildSignificanceShortlist (TX-2)', () => {
    test('conflicts come first, textless items never reach the model, list is capped', () => {
        const reconciliation = {
            conflicts: [
                { finding: 'Sukob A', kind: 'arithmetic' },
                { kind: 'arithmetic' },
                { finding: 'Sukob B', kind: 'lifecycle' }
            ],
            openQuestions: [{ text: 'Pitanje?', kind: 'arithmetic' }]
        };
        const shortlist = buildSignificanceShortlist(reconciliation, { maxItems: 2 });

        expect(shortlist).toHaveLength(2);
        expect(shortlist[0]).toEqual(expect.objectContaining({ list: 'conflict', itemIndex: 0 }));
        expect(shortlist[1]).toEqual(expect.objectContaining({ list: 'conflict', itemIndex: 2 }));
    });

    test('empty input yields an empty shortlist', () => {
        expect(buildSignificanceShortlist(null)).toEqual([]);
        expect(buildSignificanceShortlist({ conflicts: [], openQuestions: [] })).toEqual([]);
        expect(MAX_SIGNIFICANCE_ITEMS).toBe(20);
    });
});

describe('parseSignificanceRanking + applySignificance (TX-2)', () => {
    const shortlist = [
        { list: 'conflict', itemIndex: 0, kind: 'arithmetic', text: 'Sukob A' },
        { list: 'openQuestion', itemIndex: 0, kind: 'lifecycle', text: 'Pitanje?' }
    ];

    test('valid rows apply verbatim; invalid rows drop without touching items', () => {
        const ranking = parseSignificanceRanking(JSON.stringify([
            { index: 0, rank: 1, significance: 'high', reason: 'Utječe na diobu.' },
            { index: 5, rank: 2, significance: 'high', reason: 'Nepostojeća stavka.' },
            { index: 1, rank: 2, significance: 'maybe', reason: 'Nevaljana razina.' },
            'garbage'
        ]), shortlist);

        expect(ranking).toEqual([{ index: 0, rank: 1, significance: 'high', reason: 'Utječe na diobu.' }]);

        const reconciliation = {
            conflicts: [{ finding: 'Sukob A', kind: 'arithmetic' }],
            openQuestions: [{ text: 'Pitanje?', kind: 'lifecycle' }]
        };
        expect(applySignificance(reconciliation, shortlist, ranking)).toEqual({ applied: 1 });
        expect(reconciliation.conflicts[0].heuristicRank).toEqual({
            rank: 1, significance: 'high', reason: 'Utječe na diobu.'
        });
        expect(reconciliation.openQuestions[0].heuristicRank).toBeUndefined();
    });

    test('unparseable rankings degrade to null; application is total-safe', () => {
        expect(parseSignificanceRanking('not json', shortlist)).toBeNull();
        expect(parseSignificanceRanking('[]', shortlist)).toBeNull();
        expect(applySignificance(null, null, null)).toEqual({ applied: 0 });
        expect(applySignificance({ conflicts: [] }, shortlist, [{ index: 0 }])).toEqual({ applied: 0 });
    });

    test('runSignificance makes at most one call and never throws', async () => {
        const judgeLlm = jest.fn().mockResolvedValue([
            { index: 0, rank: 1, significance: 'high', reason: 'Bitno.' }
        ]);
        const ranking = await runSignificance(shortlist, { significanceLlm: judgeLlm });
        expect(judgeLlm).toHaveBeenCalledTimes(1);
        expect(ranking).toHaveLength(1);

        expect(await runSignificance([], { significanceLlm: judgeLlm })).toBeNull();
        expect(judgeLlm).toHaveBeenCalledTimes(1);
        const failing = jest.fn().mockRejectedValue(new Error('boom'));
        expect(await runSignificance(shortlist, { significanceLlm: failing })).toBeNull();
    });

    test('prompt lists every shortlist item exactly once', () => {
        const prompt = buildSignificancePrompt(shortlist);
        expect(prompt).toContain('0. [conflict/arithmetic] Sukob A');
        expect(prompt).toContain('1. [openQuestion/lifecycle] Pitanje?');
    });
});
