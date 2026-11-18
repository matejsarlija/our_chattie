// Fixture manifest (I-06): offline grounding + property-flow coverage.
//
// - Tražbina lifecycle pair: the stecaj-klaster eval fixture carries a
//   prijava entry (doc 2, becomes prop-1 at collect time) and a later ustup
//   entry (doc 3, supersedes "prop-1") sharing one normalized description.
//   Expected: ONE valueChanges timeline (84500 → 15000), ZERO conflicts.
// - False-conflict case: two competing cessions below share one description
//   with NO resolving supersedes chain and different transferees.
//   Expected: ONE genuine conflict.
// - Hallucinated quote: an amounts entry whose quote appears nowhere in the
//   source text. Expected: grounded:false, run never fails.
// - Pre-migration entries (no quote/grounded fields at all) must not crash
//   any consumer (spec §7.1 backward compatibility).

const { isQuoteGrounded, applyGroundingToAnalysis, countGroundedClaims } = require('../../court-analysis/reasoning/grounding');

describe('reasoning grounding containment check', () => {
    const SOURCE = 'Polog za troškove stečajnog postupka u iznosu od 1.200,00 EUR dužnik je uplatio na žiro račun suda.';

    test('exact substring match → grounded:true', () => {
        expect(isQuoteGrounded('Polog za troškove stečajnog postupka', SOURCE)).toBe(true);
    });

    test('near-match tolerant of whitespace/line-break/OCR noise → grounded:true', () => {
        expect(isQuoteGrounded('Polog  za  troškove\nstečajnog\tpostupka', SOURCE)).toBe(true);
    });

    test('no match anywhere in source text → grounded:false, never throws', () => {
        expect(() => isQuoteGrounded('Izmišljeni trošak od 9.999,99 EUR', SOURCE)).not.toThrow();
        expect(isQuoteGrounded('Izmišljeni trošak od 9.999,99 EUR', SOURCE)).toBe(false);
    });

    test('empty/missing quote → grounded:false (not a crash, not silently true)', () => {
        expect(isQuoteGrounded('', SOURCE)).toBe(false);
        expect(isQuoteGrounded(null, SOURCE)).toBe(false);
        expect(isQuoteGrounded(undefined, SOURCE)).toBe(false);
        expect(isQuoteGrounded('   ', SOURCE)).toBe(false);
    });

    test('runs per-entry across both amounts[] and propertyFlow[]', () => {
        const aiResult = {
            amounts: [{ description: 'Polog', amount: 1200, currency: 'EUR', quote: 'Polog za troškove stečajnog postupka' }],
            propertyFlow: [
                { description: 'Strojevi', assetType: 'pokretnina', quote: 'proizvodne strojeve' },
                { description: 'Halucinacija', assetType: 'nekretnina', quote: 'nepostojeća katastarska čestica 9999' },
            ],
        };
        applyGroundingToAnalysis(aiResult, `${SOURCE} Prodaju se proizvodne strojeve kupcu.`);
        expect(aiResult.amounts[0].grounded).toBe(true);
        expect(aiResult.propertyFlow[0].grounded).toBe(true);
        expect(aiResult.propertyFlow[1].grounded).toBe(false);
    });
    test('document party OIBs are grounded against the source quote', () => {
        const aiResult = {
            documentParties: [{ name: 'ADRIA', oib: '08697489827', quote: 'ADRIA d.o.o., OIB: 08697489827' }],
        };
        applyGroundingToAnalysis(aiResult, 'ADRIA d.o.o., OIB: 08697489827.');
        expect(aiResult.documentParties[0].grounded).toBe(true);
    });

    test.each([
        ['different extracted identifier', '08697489828', 'ADRIA d.o.o., OIB: 08697489827', 'ADRIA d.o.o., OIB: 08697489827.'],
        ['different source identifier despite high token overlap', '08697489827', 'Dužnik ADRIA d.o.o. sa sjedištem u Rijeci OIB 08697489827', 'Dužnik ADRIA d.o.o. sa sjedištem u Rijeci OIB 08697489828'],
        ['identifier missing from quote', '08697489827', 'Dužnik ADRIA d.o.o. sa sjedištem u Rijeci', 'Dužnik ADRIA d.o.o. sa sjedištem u Rijeci OIB 08697489827'],
        ['identifier only elsewhere in source', '08697489827', 'Dužnik ADRIA d.o.o. sa sjedištem u Rijeci OIB 08697489827', 'Dužnik ADRIA d.o.o. sa sjedištem u Rijeci OIB 08697489828. Vjerovnik OIB 08697489827.'],
        ['longer identifier in source', '08697489827', 'OIB: 08697489827', 'OIB: 086974898279'],
        ['longer identifier in quote', '08697489827', 'OIB: 108697489827', 'OIB: 108697489827'],
        ['unsupported source separators', '08697489827', 'OIB: 08697489827', 'OIB: 086/974/89827'],
        ['OCR letter substitution', '08697489827', 'OIB: 08697489827', 'OIB: O8697489827'],
        ['unsupported extracted separators', '086/974/89827', 'OIB: 08697489827', 'OIB: 08697489827'],
        ['missing extracted identifier', undefined, 'OIB: 08697489827', 'OIB: 08697489827'],
    ])('does not ground a party with %s', (_description, oib, quote, source) => {
        const aiResult = { documentParties: [{ name: 'ADRIA', oib, quote }] };
        applyGroundingToAnalysis(aiResult, source);
        expect(aiResult.documentParties[0].grounded).toBe(false);
    });

    test.each([
        ['08697489827', 'ADRIA OIB: 086 974 89827', 'ADRIA OIB: 08697489827.'],
        ['08697489827', 'ADRIA OIB: 08697489827', 'ADRIA OIB: 086-974-89827.'],
        ['086-974-89827', 'ADRIA OIB: 08697489827', 'ADRIA OIB: 086\n974\t89827.'],
    ])('grounds exact party digits with supported separator formatting (%s, %s)', (oib, quote, source) => {
        const aiResult = { documentParties: [{ name: 'ADRIA', oib, quote }] };
        applyGroundingToAnalysis(aiResult, source);
        expect(aiResult.documentParties[0].grounded).toBe(true);
    });
    test('procedural events are grounded per document and missing quotes degrade', () => {
        const aiResult = {
            amounts: [],
            propertyFlow: [],
            proceduralEvents: [
                { eventType: 'decision', description: 'Odluka.', quote: 'Ovim rješenjem se odlučuje.' },
                { eventType: 'appeal', description: 'Žalba.', quote: '' },
            ],
        };
        applyGroundingToAnalysis(aiResult, 'Ovim rješenjem se odlučuje. Stranka podnosi žalbu.');
        expect(aiResult.proceduralEvents.map((event) => event.grounded)).toEqual([true, false]);
        expect(countGroundedClaims([aiResult])).toEqual({
            groundedClaims: 0,
            totalClaims: 0,
            groundedProceduralEvents: 1,
            totalProceduralEvents: 2,
        });
    });


    test('pre-migration entries without quote fields degrade gracefully', () => {
        const aiResult = { amounts: [{ description: 'Polog', amount: 1200, currency: 'EUR' }] };
        expect(() => applyGroundingToAnalysis(aiResult, SOURCE)).not.toThrow();
        expect(aiResult.amounts[0].grounded).toBe(false);
    });

    test('countGroundedClaims counts across amounts + propertyFlow', () => {
        const analyses = [
            { amounts: [{ grounded: true }, { grounded: false }], propertyFlow: [{ grounded: true }] },
            { amounts: [], propertyFlow: [] },
        ];
        expect(countGroundedClaims(analyses)).toEqual({ groundedClaims: 2, totalClaims: 3 });
    });

    test('a run with zero grounded claims does not fail', () => {
        const aiResult = { amounts: [{ description: 'X', amount: 1, quote: 'nigdje' }], propertyFlow: [] };
        expect(() => applyGroundingToAnalysis(aiResult, SOURCE)).not.toThrow();
        expect(countGroundedClaims([{ amounts: aiResult.amounts, propertyFlow: [] }])).toEqual({ groundedClaims: 0, totalClaims: 1 });
    });

    test('single paraphrased/OCR-mangled token still grounds, invented quotes do not', () => {
        // One word swapped out of six → 5/6 token overlap → grounded.
        expect(isQuoteGrounded(
            'Polog za troškove stečajnog postupka izmišljeni',
            SOURCE
        )).toBe(true);
        // Wholly invented quote shares too few tokens → ungrounded.
        expect(isQuoteGrounded('Izmišljena katastarska čestica devet tisuća devetsto', SOURCE)).toBe(false);
        // Short quotes never take the fuzzy path (too generic to verify).
        expect(isQuoteGrounded('kod banke', 'Nepovezani tekst o nečem drugom.')).toBe(false);
    });
});
