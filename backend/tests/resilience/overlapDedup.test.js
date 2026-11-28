'use strict';

const { mergeAnalysisChunkResults } = require('../../court-analysis/extraction/chunkMerge');
const { buildAdaptiveSegments } = require('../../llm/tokenBudgetPolicy');

describe('Resilience: Overlap Dedup, 16384-Token Bisection & Total-Parts Mismatch', () => {
    test('deduplicates newline-shifted duplicate quote within overlap window', () => {
        const sourceText = `${'A'.repeat(3200)}Vjerovnik potražuje\n5.000.000,00 EUR${'B'.repeat(500)}`;
        const merged = mergeAnalysisChunkResults([
            {
                segment: { id: 'seg-0', startIndex: 0, endIndex: 3500, pageNumbers: [1] },
                value: {
                    caseNumber: 'St-2/2013',
                    amounts: [{
                        description: 'Prijava A',
                        amount: 5000000,
                        currency: 'EUR',
                        quote: 'Vjerovnik potražuje\n5.000.000,00 EUR',
                    }],
                },
            },
            {
                segment: { id: 'seg-1', startIndex: 3150, endIndex: 3740, pageNumbers: [2] },
                value: {
                    caseNumber: 'St-2/2013',
                    amounts: [{
                        description: 'Prijava A (ponovljeno)',
                        amount: 5000000,
                        currency: 'EUR',
                        quote: 'Vjerovnik potražuje 5.000.000,00 EUR',
                    }],
                },
            },
        ], sourceText);
        expect(merged.amounts).toHaveLength(1);
    });

    test('splits dense Kerum table text into bounded segments under 16384-token budget', () => {
        const denseTable = Array.from({ length: 180 }, (_, i) => `${i + 1}. Vjerovnik ${i + 1} d.o.o. | OIB 12345678901 | 12.345,67 EUR`).join('\n');
        const { segments } = buildAdaptiveSegments(denseTable, { isTableDense: true });
        expect(segments.length).toBeGreaterThan(1);
        for (const seg of segments) {
            expect(seg.text.length).toBeLessThanOrEqual(4200);
        }
    });
});
