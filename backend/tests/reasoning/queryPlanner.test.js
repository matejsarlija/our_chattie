const {
    buildInventory,
    buildPlannerPrompt,
    mapPlannedQueries,
    mergeRetrievalQueries,
    runQueryPlanner,
    MAX_PLANNED_QUERIES,
    MAX_TOTAL_QUERIES
} = require('../../court-analysis/reasoning/queryPlanner');

describe('queryPlanner — model-planned retrieval queries (Phase 1.3)', () => {
    const pkg = () => ({
        packageType: 'ClusterEvidencePackage',
        clusterId: 'Stč-2150/2022',
        primaryCaseNumber: 'Stč-2150/2022',
        query: { type: 'oib', value: '11223344556' },
        identity: { participantNames: ['Ducanor d.o.o.', 'Ante Anić'], participantOibs: ['11223344556'] },
        entries: [
            { date: '2022-03-18', participants: [{ name: 'Ducanor d.o.o.' }] },
            { date: '2023-02-14', participants: [] }
        ],
        analyses: [{ fileName: 'rjesenje.pdf' }, { fileName: 'izvjestaj.pdf' }],
        chunks: [{ metadata: { fileName: 'rjesenje.pdf' } }],
        moneyFlow: { currencyTotals: { EUR: 85500 } }
    });

    describe('buildInventory', () => {
        test('captures identity, files, dates, and money totals deterministically', () => {
            const inv = buildInventory(pkg());
            expect(inv).toEqual(expect.objectContaining({
                clusterId: 'Stč-2150/2022',
                queryType: 'oib',
                documentCount: 2,
                dateRange: ['2022-03-18', '2023-02-14'],
                moneyTotalsByCurrency: { EUR: 85500 }
            }));
            expect(inv.parties).toContain('Ante Anić');
            expect(inv.fileNames).toEqual(expect.arrayContaining(['rjesenje.pdf', 'izvjestaj.pdf']));
            expect(JSON.stringify(buildInventory(pkg()))).toBe(JSON.stringify(buildInventory(pkg())));
        });

        test('truncates long file lists to bound the prompt', () => {
            const many = { ...pkg(), analyses: Array.from({ length: 40 }, (_, i) => ({ fileName: `doc-${i}.pdf` })) };
            expect(buildInventory(many).fileNames.length).toBeLessThanOrEqual(15);
        });
    });

    test('prompt demands a strict JSON array of id/purpose/text objects', () => {
        const prompt = buildPlannerPrompt(buildInventory(pkg()));
        expect(prompt).toContain('"purpose"');
        expect(prompt).toContain('JSON');
    });

    describe('mapPlannedQueries', () => {
        test('maps valid entries with identity anchors and typed queryType', () => {
            const mapped = mapPlannedQueries([
                { id: 'prodaja', purpose: 'asset-disposition', text: 'prodaja imovine strojevi kupac' },
                { id: 'rokovi', purpose: 'timeline', text: 'rok prijava tražbina rok' }
            ], pkg());

            expect(mapped).toHaveLength(2);
            expect(mapped[0]).toEqual(expect.objectContaining({
                id: 'planned-prodaja',
                anchors: expect.arrayContaining(['11223344556', 'Stč-2150/2022']),
                queryType: 'oib'
            }));
        });

        test('drops invalid entries, dedupes by normalized text, caps at 6', () => {
            const raw = [
                null,
                { text: '' },
                { text: 'ab' },
                { text: 'prodaja imovine strojevi' },
                { text: 'Prodaja IMOVINE strojevi' },
                ...Array.from({ length: 8 }, (_, i) => ({ id: `x${i}`, purpose: 'p', text: `upit broj ${i} s pojmovima` }))
            ];
            const mapped = mapPlannedQueries(raw, pkg());
            expect(mapped.length).toBeLessThanOrEqual(MAX_PLANNED_QUERIES);
            expect(mapped.some((q) => q.text === 'prodaja imovine strojevi')).toBe(true);
            expect(mapped.filter((q) => q.text === 'Prodaja IMOVINE strojevi')).toHaveLength(0);
        });
    });

    describe('mergeRetrievalQueries', () => {
        const tq = (text) => ({ id: `t-${text}`, text, anchors: [], queryType: 'text' });

        test('planned first, template duplicates dropped, total capped at 8', () => {
            const planned = [tq('ciljani upit'), tq('drugi ciljani')];
            const templates = [tq('ciljani upit'), tq('datumi ročište'), tq('iznos tražbina'), tq('status postupka'), tq('dužnik vjerovnik'), tq('peti'), tq('šesti'), tq('sedmi')];

            const merged = mergeRetrievalQueries(planned, templates);
            expect(merged[0].text).toBe('ciljani upit');
            expect(merged.filter((q) => q.text === 'ciljani upit')).toHaveLength(1);
            expect(merged.length).toBeLessThanOrEqual(MAX_TOTAL_QUERIES);
        });
    });

    describe('runQueryPlanner failure contract', () => {
        test('empty corpus → no call, empty plan', async () => {
            const llm = jest.fn();
            await expect(runQueryPlanner({ analyses: [], chunks: [] }, { plannerLlm: llm })).resolves.toEqual([]);
            await expect(runQueryPlanner(null, { plannerLlm: llm })).resolves.toEqual([]);
            expect(llm).not.toHaveBeenCalled();
        });

        test('valid output maps through', async () => {
            const llm = jest.fn().mockResolvedValue('[{"id":"a","purpose":"timeline","text":"rok prijava tražbina 2022"}]');
            const planned = await runQueryPlanner(pkg(), { plannerLlm: llm });
            expect(planned).toHaveLength(1);
            expect(llm).toHaveBeenCalledTimes(1);
        });

        test('garbage JSON → empty plan, no throw', async () => {
            const llm = jest.fn().mockResolvedValue('nije json');
            await expect(runQueryPlanner(pkg(), { plannerLlm: llm })).resolves.toEqual([]);
        });

        test('transport error → empty plan, no throw', async () => {
            const llm = jest.fn().mockRejectedValue(new Error('quota'));
            await expect(runQueryPlanner(pkg(), { plannerLlm: llm })).resolves.toEqual([]);
        });
    });
});
