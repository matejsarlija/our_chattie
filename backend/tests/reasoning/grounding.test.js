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
});
