const {
    MAX_CLAIM_JUDGE_PAIRS,
    selectClaimJudgePairs,
    groupSharesIdentifiers,
    buildClaimJudgePrompt,
    parseClaimVerdict,
    runClaimJudge,
    applyClaimVerdicts
} = require('../../court-analysis/reasoning/claimJudge');

function flowEntry(sourceId, overrides = {}) {
    return {
        sourceId,
        fileName: `${sourceId}.pdf`,
        description: 'Ustup tražbine',
        value: 15000,
        valueEur: 15000,
        currency: 'EUR',
        transferor: null,
        transferee: null,
        claimRegistryNumber: null,
        filingReference: null,
        date: null,
        quote: 'Ustupam tražbinu u iznosu od 15.000 EUR.',
        ...overrides
    };
}

describe('selectClaimJudgePairs (TX-1 gate)', () => {
    test('possibly-related lifecycle questions with identifier-less entries become pairs', () => {
        const reconciliation = {
            openQuestions: [{
                text: 'Moguće povezane tvrdnje...',
                sources: ['s-a', 's-b'],
                source: 'reconciliation',
                kind: 'lifecycle',
                relationship: 'possibly-related'
            }],
            conflicts: []
        };
        const flows = { entries: [flowEntry('s-a'), flowEntry('s-b')] };
        const pairs = selectClaimJudgePairs(reconciliation, flows, {});

        expect(pairs).toHaveLength(1);
        expect(pairs[0]).toEqual(expect.objectContaining({
            itemKind: 'openQuestion',
            itemIndex: 0,
            reason: 'identifier-less possibly-related pair'
        }));
        expect(pairs[0].entryA.sourceId).toBe('s-a');
    });

    test('identifier-backed pairs cost zero calls', () => {
        const withRegistry = {
            openQuestions: [{
                text: 'q',
                sources: ['s-a', 's-b'],
                kind: 'lifecycle',
                relationship: 'possibly-related'
            }],
            conflicts: [{
                finding: 'f',
                sources: ['s-c', 's-d'],
                kind: 'arithmetic'
            }]
        };
        const flows = {
            entries: [
                flowEntry('s-a', { claimRegistryNumber: '106' }),
                flowEntry('s-b', { claimRegistryNumber: '106' }),
                flowEntry('s-c', { payerOib: '66124057408' }),
                flowEntry('s-d', { recipientOib: '66124057408' })
            ]
        };
        // Shared registry across the question pair; shared OIB across the
        // conflict pair (payer vs recipient still counts as shared identity).
        expect(selectClaimJudgePairs(withRegistry, flows, {})).toEqual([]);
    });

    test('arithmetic conflicts pair min/max effective value', () => {
        const reconciliation = {
            openQuestions: [],
            conflicts: [{ finding: 'f', sources: ['s-lo', 's-mid', 's-hi'], kind: 'arithmetic' }]
        };
        const flows = {
            entries: [
                flowEntry('s-lo', { value: 100, valueEur: 100 }),
                flowEntry('s-mid', { value: 500, valueEur: 500 }),
                flowEntry('s-hi', { value: 900, valueEur: 900 })
            ]
        };
        const pairs = selectClaimJudgePairs(reconciliation, flows, {});
        expect(pairs).toHaveLength(1);
        expect(pairs[0].entryA.sourceId).toBe('s-lo');
        expect(pairs[0].entryB.sourceId).toBe('s-hi');
    });

    test('unresolvable sources are skipped, pairs are capped', () => {
        const questions = Array.from({ length: 7 }, (_, i) => ({
            text: `q${i}`,
            sources: [`s-${i}-a`, `s-${i}-b`],
            kind: 'lifecycle',
            relationship: 'possibly-related'
        }));
        const flows = {
            entries: questions.flatMap((q, i) => [
                flowEntry(`s-${i}-a`, { description: `Tvrdnja ${i} alfa` }),
                flowEntry(`s-${i}-b`, { description: `Tvrdnja ${i} beta` })
            ])
        };
        expect(MAX_CLAIM_JUDGE_PAIRS).toBe(5);
        expect(selectClaimJudgePairs({ openQuestions: questions, conflicts: [] }, flows, {})).toHaveLength(5);

        const ghosts = selectClaimJudgePairs({
            openQuestions: [{ text: 'q', sources: ['ghost-1', 'ghost-2'], kind: 'lifecycle', relationship: 'possibly-related' }],
            conflicts: []
        }, { entries: [flowEntry('s-a')] }, {});
        expect(ghosts).toEqual([]);
    });

    test('groupSharesIdentifiers detects each identifier class', () => {
        expect(groupSharesIdentifiers([
            flowEntry('a', { transferor: 'Vjerovnik A' }),
            flowEntry('b', { transferee: 'Vjerovnik A' })
        ])).toBe(true);
        expect(groupSharesIdentifiers([flowEntry('a'), flowEntry('b')])).toBe(false);
        expect(groupSharesIdentifiers([])).toBe(false);
    });
});

describe('runClaimJudge + applyClaimVerdicts (TX-1)', () => {
    const pair = {
        itemKind: 'openQuestion',
        itemIndex: 0,
        entryA: { sourceId: 's-a', fileName: 'a.pdf', description: 'Ustup tražbine' },
        entryB: { sourceId: 's-b', fileName: 'b.pdf', description: 'Ustup tražbine' },
        reason: 'test'
    };

    test('mocked verdicts are recorded verbatim on items and links', async () => {
        const judgeLlm = jest.fn().mockResolvedValue({ verdict: 'same', confidence: 'high', reasons: 'Isti dužnik i iznos.' });
        const verdicts = await runClaimJudge([pair], { judgeLlm });

        expect(judgeLlm).toHaveBeenCalledTimes(1);
        expect(verdicts).toEqual([{ verdict: 'same', confidence: 'high', reasons: 'Isti dužnik i iznos.' }]);

        const reconciliation = { openQuestions: [{ text: 'q', kind: 'lifecycle' }], conflicts: [] };
        const { claimLinks } = applyClaimVerdicts(reconciliation, [pair], verdicts);
        expect(reconciliation.openQuestions[0].claimJudge).toEqual(verdicts[0]);
        expect(claimLinks).toEqual([expect.objectContaining({
            itemKind: 'openQuestion',
            itemIndex: 0,
            verdict: 'same'
        })]);
    });

    test('unparseable output and transport failures degrade to uncertain', async () => {
        expect(parseClaimVerdict('not json')).toEqual({ verdict: 'uncertain', confidence: 'low', reasons: 'unparseable judge output' });
        expect(parseClaimVerdict('{"verdict": "maybe"}')).toEqual(expect.objectContaining({ verdict: 'uncertain' }));

        const failing = jest.fn().mockRejectedValue(new Error('boom'));
        const verdicts = await runClaimJudge([pair], { judgeLlm: failing });
        expect(verdicts[0]).toEqual(expect.objectContaining({ verdict: 'uncertain' }));
    });

    test('missing verdicts and items are safe no-ops', () => {
        const reconciliation = { openQuestions: [], conflicts: [] };
        expect(applyClaimVerdicts(reconciliation, [pair], []).claimLinks).toEqual([]);
        expect(applyClaimVerdicts(null, null, null).claimLinks).toEqual([]);
    });

    test('judge prompt carries both sides with bounded quotes', () => {
        const prompt = buildClaimJudgePrompt({
            entryA: flowEntry('s-a', { quote: 'x'.repeat(2000) }),
            entryB: flowEntry('s-b', { quote: null })
        });
        expect(prompt).toContain('Tvrdnja A');
        expect(prompt).toContain('Tvrdnja B');
        expect(prompt).toContain('(nema citata)');
        expect(prompt.length).toBeLessThan(3000);
    });
});
