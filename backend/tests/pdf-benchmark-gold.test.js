'use strict';

const { scoreGold, canonicalAmount } = require('../scripts/lib/gold');
const reviewedCategories = ['amounts', 'oibs', 'dates', 'filingNumbers', 'decisionOutcome', 'tables'];

test('gold scoring matches locale-formatted raw amounts and OIBs by value', () => {
    expect(canonicalAmount('1.234,56', 'EUR')).toBe('1234.56|EUR');
    const gold = {
        factsComplete: true,
        reviewedCategories,
        document: { docId: 'doc-1' },
        facts: {
            amounts: [{ rawValue: '1.234,56', currency: 'EUR' }],
            // Gold carries the legal party role; extraction carries a flow
            // side. Only the OIB value is comparable, so roles are not scored.
            oibs: [{ value: '66124057408', role: 'Stečajni dužnik' }],
            dates: ['23.06.2026.'],
            filingNumbers: ['St-2/2013'],
            decisionOutcome: 'granted',
            tables: [{ description: 'register', rowCount: 2 }],
        },
    };
    const extraction = {
        parsed: {
            caseNumber: 'St-2/2013',
            decisionDate: '23.06.2026.',
            documentParties: [{ name: 'KERUM d.o.o.', oib: '66124057408', role: 'dužnik', quote: 'OIB: 66124057408' }],
            amounts: [
                { amount: 1234.56, currency: 'EUR', date: '23.06.2026.', amountRole: 'line_item' },
                { amount: 10, currency: 'EUR', amountRole: 'line_item' },
            ],
            proceduralEvents: [{ outcome: 'granted' }],
        },
    };
    const score = scoreGold(gold, extraction);
    expect(score.complete).toBe(true);
    expect(score.amounts.counts).toEqual({ truePositive: 1, predicted: 2, reference: 1 });
    expect(score.oibs.counts).toEqual({ truePositive: 1, predicted: 1, reference: 1 });
    expect(score.oibs.recall).toBe(1);
    expect(score.oibsWithRoles).toBeUndefined();
    expect(score.dates.recall).toBe(1);
    expect(score.filingNumbers.recall).toBe(1);
    expect(score.decisionOutcome.recall).toBe(1);
    expect(score.tableRowCounts.counts).toEqual({ truePositive: 2, predicted: 2, reference: 2 });
});

test('a wrong or short OIB number never counts as a match', () => {
    const gold = {
        factsComplete: true,
        reviewedCategories,
        facts: { amounts: [], oibs: [{ value: '66124057408', role: 'Stečajni dužnik' }], dates: [], filingNumbers: [], tables: [] },
    };
    const wrong = scoreGold(gold, { parsed: { parties: [{ oib: '66124057409', role: 'debtor' }] } });
    expect(wrong.oibs.counts).toEqual({ truePositive: 0, predicted: 1, reference: 1 });
    const short = scoreGold(gold, { parsed: { parties: [{ oib: '6612405' }] } });
    expect(short.oibs.counts).toEqual({ truePositive: 0, predicted: 0, reference: 1 });
    const spaced = scoreGold(gold, { parsed: { parties: [{ oib: '661 240 574 08' }] } });
    expect(spaced.oibs.counts.truePositive).toBe(1);
});

test('incomplete local gold templates are not silently scored as correct', () => {
    expect(scoreGold({ factsComplete: false, facts: {} }, {}).complete).toBe(false);
    expect(scoreGold({ factsComplete: true, facts: {} }, {}).complete).toBe(false);
});

test('gold dates match Croatian month names, dotted ISO dates, and model ISO output', () => {
    const gold = {
        factsComplete: true,
        reviewedCategories,
        facts: { dates: ['11. svibnja 2022.g.', '2026.06.17'], amounts: [], oibs: [], filingNumbers: [], tables: [] },
    };
    const score = scoreGold(gold, { parsed: { decisionDate: '2022-05-11', amounts: [{ date: '2026-06-17' }] } });
    expect(score.dates.counts).toEqual({ truePositive: 2, predicted: 2, reference: 2 });
});

test('report scoring reads the one-shot analysis rows, and still reads legacy extraction rows', () => {
    const { scoreReport } = require('../scripts/score-gold');
    const gold = {
        factsComplete: true,
        reviewedCategories,
        document: { docId: 'doc-1' },
        facts: { amounts: [{ rawValue: '1.234,56', currency: 'EUR' }], oibs: [], dates: [], filingNumbers: [], tables: [] },
    };
    const parsed = { amounts: [{ amount: 1234.56, currency: 'EUR' }] };
    const modern = scoreReport([gold], { rows: [{ docId: 'doc-1', arm: 'or-cloudflare', model: 'x/y', repeat: 1, parsed }] });
    expect(modern).toHaveLength(1);
    expect(modern[0]).toMatchObject({ document: 'doc-1', arm: 'or-cloudflare', model: 'x/y' });
    expect(modern[0].score.complete).toBe(true);
    const legacy = scoreReport([gold], { extractionRows: [{ docId: 'doc-1', transcriptArm: 'local-text', extractionModel: 'x/y', repeat: 1, parsed }] });
    expect(legacy[0]).toMatchObject({ arm: 'local-text', model: 'x/y' });
});

test.each([
    ['odbija se', 'rejected'],
    [' ODBIJA   SE. ', 'rejected'],
    ['odbacuje se', 'dismissed'],
    ['usvaja se', 'granted'],
    ['prihvaća se', 'granted'],
    ['potvrđuje se', 'upheld'],
    ['ukida se', 'overturned'],
    ['preinačuje se', 'modified'],
    ['vraća se na ponovni postupak', 'remanded'],
])('gold outcome %j matches schema outcome %s without changing saved wording', (wording, outcome) => {
    const gold = { factsComplete: true, reviewedCategories, facts: { decisionOutcome: wording } };
    const score = scoreGold(gold, { parsed: { proceduralEvents: [{ outcome }] } });
    expect(score.decisionOutcome.counts).toEqual({ truePositive: 1, predicted: 1, reference: 1 });
    expect(gold.facts.decisionOutcome).toBe(wording);
});

test('outcome matching preserves the merits/admissibility distinction and does not guess compound rulings', () => {
    const gold = { factsComplete: true, reviewedCategories, facts: { decisionOutcome: 'odbija se' } };
    expect(scoreGold(gold, { parsed: { proceduralEvents: [{ outcome: 'dismissed' }] } }).decisionOutcome.recall).toBe(0);
    gold.facts.decisionOutcome = 'odbija se i ukida se';
    expect(scoreGold(gold, { parsed: { proceduralEvents: [{ outcome: 'rejected' }] } }).decisionOutcome.recall).toBe(0);
    gold.facts.decisionOutcome = 'odgođeno';
    expect(scoreGold(gold, { parsed: { decisionOutcome: 'odgođeno' } }).decisionOutcome.recall).toBe(1);
});
