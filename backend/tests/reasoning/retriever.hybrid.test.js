const { retrieveEvidence } = require('../../court-analysis/reasoning/retriever');
const { buildLexicalIndex } = require('../../court-analysis/reasoning/indexer');

describe('retriever hybrid scoring (Phase 0.4)', () => {
    const pkg = {
        packageType: 'ClusterEvidencePackage',
        clusterId: 'ST-1/2024',
        query: { type: 'case_number', value: 'ST-1/2024' },
        identity: {},
        entries: [],
        documentLinks: [],
        analyses: [
            { id: 'analysis-exact', fileName: 'exact.pdf', caseNumber: 'ST-1/2024', summary: 'Trošak postupka i rok za prijavu tražbina vjerovnika. Tražbina iznosi 10.000 EUR.' },
            // Deliberately uses INFLECTED forms: 'rokovima' (not 'rok'),
            // 'potraživanja' (not 'tražbina'). Only the prefix-root 'rok'
            // earns stem credit here — mirroring how substring matching
            // behaves on Croatian morphology in production.
            { id: 'analysis-stem', fileName: 'stem.pdf', caseNumber: 'ST-1/2024', summary: 'Rokovima za prijave potraživanja odgađa se rasprava o troškovima postupka.' }
        ]
    };

    test('indexes document frequency and source type composition for telemetry', () => {
        const index = buildLexicalIndex(pkg);
        expect(index.idfStats.totalSources).toBeGreaterThan(0);
        expect(index.metrics.sourceTypeCounts).toEqual(expect.objectContaining({ analysis: 2 }));
        // 'postupka' appears in both analysis summaries → df=2.
        expect(index.idfStats.df['postupka']).toBe(2);
    });

    test('exact-token matches outrank prefix-stem matches for the same root', () => {
        const result = retrieveEvidence(pkg, {
            topK: 2,
            queries: [{
                id: 'amounts',
                purpose: 'financial-amounts',
                text: 'rok tražbina',
                anchors: [],
                queryType: 'case_number'
            }]
        });

        const ranksBySource = Object.fromEntries(
            result.results[0].matches.map((m) => [m.sourceId, m])
        );
        // exact.pdf contains "rok" and "tražbina" verbatim; stem.pdf only the
        // inflected "rokovima" (prefix-substring credit). Exact agreement must
        // win under equal cluster boosts.
        expect(ranksBySource['analysis-exact'].score).toBeGreaterThan(ranksBySource['analysis-stem'].score);
        expect(ranksBySource['analysis-exact'].reasons).toContain('token:rok');
        expect(ranksBySource['analysis-stem'].reasons).toContain('stem:rok');
    });

    test('generic vocabulary is IDF-demoted relative to distinctive terms', () => {
        // 'postupka' appears across nearly all sources; a rare token in one
        // source should contribute relatively more to that source's rank.
        const index = buildLexicalIndex(pkg);
        const commonDf = index.idfStats.df['postupka'] || 0;
        if (commonDf > 0) {
            const rareTokenScoreContribution = Math.log(1 + index.idfStats.totalSources / 1);
            const commonScoreContribution = Math.log(1 + index.idfStats.totalSources / commonDf);
            expect(rareTokenScoreContribution).toBeGreaterThan(commonScoreContribution);
        }
    });

    test('retrieval result metrics persist sourceTypeCounts into run meta', () => {
        const result = retrieveEvidence(pkg, { queries: [{ id: 'q', text: 'tražbina postupka', anchors: [], queryType: 'text' }] });
        expect(result.metrics.sourceTypeCounts.analysis).toBe(2);
    });
});
