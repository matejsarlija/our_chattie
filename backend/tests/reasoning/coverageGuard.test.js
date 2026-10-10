const {
    hasPartialDocumentCoverage,
    coverageOpenQuestion,
} = require('../../court-analysis/reasoning/coverageGuard');

describe('document coverage warnings', () => {
    test('reports successfully analyzed but partial documents as an explicit gap', () => {
        const coverage = { analyzed: 4, failed: 0, partial: 2, total: 4 };

        expect(hasPartialDocumentCoverage(coverage)).toBe(true);
        expect(coverageOpenQuestion(coverage)).toContain('2 dokumenta obrađena su djelomično');
    });

    test('keeps old saved coverage shapes free of invented partial counts', () => {
        expect(hasPartialDocumentCoverage({ analyzed: 4, failed: 0, total: 4 })).toBe(false);
        expect(coverageOpenQuestion({ analyzed: 4, failed: 0, total: 4 }))
            .not.toContain('djelomično');
    });
});
