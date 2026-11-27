'use strict';

const {
    estimateSegmentProfile,
    buildAdaptiveSegments,
    resolveTokenBudget,
    analyzeCompletionTelemetry,
    bisectSegmentOnNewline,
} = require('../llm/tokenBudgetPolicy');

describe('TokenBudgetPolicy', () => {
    test('triggers chunking above 4000 chars, above 2 pages, or for table_dense text', () => {
        const shortProse = 'Ovo je kratki podnesak bez tablice. '.repeat(20);
        expect(shortProse.length).toBeLessThan(4000);
        expect(estimateSegmentProfile(shortProse, { pageCount: 1 })).toMatchObject({
            shouldChunk: false,
            densityClass: 'prose',
        });

        const midProse = 'Ovo je dulji sudski dokument. '.repeat(160);
        expect(midProse.length).toBeGreaterThan(4000);
        expect(estimateSegmentProfile(midProse, { pageCount: 1 })).toMatchObject({
            shouldChunk: true,
            densityClass: 'prose',
            chunkSize: 3500,
        });

        expect(estimateSegmentProfile(shortProse, { pageCount: 3 })).toMatchObject({
            shouldChunk: true,
            pageCount: 3,
        });

        const tableRows = Array.from({ length: 12 }, (_, idx) => `| ${idx + 1} | Vjerovnik ${idx + 1} | 100,00 EUR |`).join('\n');
        const profile = estimateSegmentProfile(tableRows, { pageCount: 1 });
        expect(profile).toMatchObject({
            shouldChunk: true,
            densityClass: 'table_dense',
            chunkSize: 3500,
        });
    });

    test('sizes table_dense windows on newline boundaries (~2200-2800 chars)', () => {
        const lines = Array.from({ length: 90 }, (_, idx) => `${idx + 1}. Vjerovnik d.o.o. | OIB 12345678901 | Utvrđeno 1.500,00 EUR`);
        const text = lines.join('\n');
        const segmented = buildAdaptiveSegments(text, {
            docId: 'diobeni',
            isTableDense: true,
        });
        expect(segmented.usedChunking).toBe(true);
        expect(segmented.segments.length).toBeGreaterThanOrEqual(2);
        for (const seg of segmented.segments) {
            expect(seg.text.length).toBeLessThanOrEqual(3800);
            expect(seg.densityClass).toBe('table_dense');
        }
    });

    test('separates answerTokens from reasoningHeadroom and detects reasoning starvation', () => {
        const budget = resolveTokenBudget({
            taskType: 'ExtractDoc',
            modelId: 'z-ai/glm-5.3-flash',
            isTableDense: true,
        });
        expect(budget.answerTokens).toBeGreaterThanOrEqual(8192);
        expect(budget.reasoningHeadroom).toBe(1536);
        expect(budget.maxTokens).toBe(budget.answerTokens + budget.reasoningHeadroom);
        expect(budget.reasoning).toEqual({ max_tokens: 1536, exclude: true });

        const starved = analyzeCompletionTelemetry({
            content: '{"amounts": [{"desc":',
            usage_metadata: { output_tokens: 2000 },
            response_metadata: {
                finish_reason: 'length',
                usageDetails: { reasoning_tokens: 1600 },
            },
        }, { budget });
        expect(starved).toMatchObject({
            outputTokens: 2000,
            reasoningTokens: 1600,
            reasoningRatio: 0.8,
            isTruncated: true,
            truncationCause: 'reasoning_starvation',
        });

        const capExceeded = analyzeCompletionTelemetry({
            content: '{"amounts": [{"desc":',
            usage_metadata: { output_tokens: 8192 },
            response_metadata: {
                finish_reason: 'length',
                usageDetails: { reasoning_tokens: 512 },
            },
        }, { budget });
        expect(capExceeded.truncationCause).toBe('answer_cap_exceeded');
    });

    test('bisects oversized segments on newlines down to depth<=2 and 800-char floor', () => {
        const baseText = Array.from({ length: 40 }, (_, idx) => `Redak ${idx + 1}: Vjerovnik potražuje ${100 + idx},00 EUR po računu.`).join('\n');
        const rootSeg = {
            id: 'doc:chunk-1',
            text: baseText,
            startIndex: 100,
            endIndex: 100 + baseText.length,
            pageNumbers: [1, 2],
            bisectDepth: 0,
        };

        const d1 = bisectSegmentOnNewline(rootSeg);
        expect(d1).toHaveLength(2);
        expect(d1[0].text.length).toBeGreaterThanOrEqual(800);
        expect(d1[1].text.length).toBeGreaterThanOrEqual(800);
        expect(d1[0].text + d1[1].text).toBe(baseText);
        expect(d1[0].bisectDepth).toBe(1);
        expect(d1[1].startIndex).toBe(100 + d1[0].text.length);

        // Smaller chunk below 2 * 800 floor refuses to split
        const tinySeg = { id: 'doc:tiny', text: 'x\n'.repeat(500), startIndex: 0, endIndex: 1000, bisectDepth: 0 };
        expect(bisectSegmentOnNewline(tinySeg)).toBeNull();

        // Depth > 2 refuses to split even if huge
        expect(bisectSegmentOnNewline({ ...rootSeg, bisectDepth: 2 })).toBeNull();
    });
});
