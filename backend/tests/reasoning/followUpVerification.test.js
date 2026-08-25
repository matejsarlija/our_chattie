const { needsFollowUp, collectConflictPassages, runFollowUpVerification } = require('../../court-analysis/reasoning/followUpVerification');

describe('followUpVerification — conflict-triggered re-verify (Phase 1.1)', () => {
    const pkg = () => ({
        clusterId: 'St-1/2024',
        entries: [],
        documentLinks: [],
        analyses: [],
        chunks: [
            { id: 'c-1', text: 'Rješenjem suda polog za troškove stečajnog postupka iznosi 1.200,00 EUR i uplaćen je na žiro račun.', metadata: { fileName: 'rjesenje.pdf' } },
            { id: 'c-2', text: 'Izvještaj upravitelja navodi da ukupno prijavljene tražbine dosežu 84.500,00 EUR prema popisu vjerovnika.', metadata: { fileName: 'izvjestaj.pdf' } }
        ]
    });

    const conflictedReport = () => ({
        findings: [{ id: 'f-1', text: 'Nalaz', confidence: 'high' }],
        conflicts: [
            { finding: 'Polog za troškove postupka ima različite iznose u dokumentima (1,200 vs 2,500).', reason: 'različiti iznosi', sources: ['s-a', 's-b'] }
        ],
        openQuestions: []
    });

    test('needsFollowUp is true only with conflicts', () => {
        expect(needsFollowUp(conflictedReport())).toBe(true);
        expect(needsFollowUp({ conflicts: [] })).toBe(false);
        expect(needsFollowUp({})).toBe(false);
    });

    test('collects deterministic around() passages from indexed chunks', () => {
        const first = collectConflictPassages(conflictedReport(), pkg());
        const second = collectConflictPassages(conflictedReport(), pkg());

        expect(first.length).toBe(1);
        expect(first[0].passages.length).toBeGreaterThan(0);
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
        // The passage must quote real ground-truth text containing the fact.
        expect(first[0].passages[0].passage).toContain('polog');
    });

    test('annotates conflicts without deleting them; refuted adds an openQuestion', async () => {
        const followUpLlm = jest.fn().mockResolvedValue('```json\n[{"index":1,"verdict":"refuted","reason":"Dokaz pokazuje jedan iznos."}]\n```');
        const report = conflictedReport();

        const { report: annotated, called } = await runFollowUpVerification(report, pkg(), { followUpLlm });

        expect(called).toBe(true);
        expect(annotated.conflicts[0].followUp.verdict).toBe('refuted');
        // Passthrough diet: annotation never replaces the original conflict.
        expect(annotated.conflicts[0].finding).toContain('1,200');
        expect(annotated.openQuestions.some((q) => q.includes('nije potvrđen'))).toBe(true);
    });

    test('exactly ONE model call regardless of conflict count (structural cap)', async () => {
        const manyConflicts = conflictedReport();
        for (let i = 0; i < 5; i++) {
            manyConflicts.conflicts.push({ finding: `Dodatni konflikt broj ${i} o tražbinama vjerovnika.`, reason: '' });
        }
        const followUpLlm = jest.fn().mockResolvedValue('[{"index":1,"verdict":"unclear","reason":""}]');
        await runFollowUpVerification(manyConflicts, pkg(), { followUpLlm });
        expect(followUpLlm).toHaveBeenCalledTimes(1);
    });

    test('model failure leaves the report untouched', async () => {
        const followUpLlm = jest.fn().mockRejectedValue(new Error('timeout'));
        const report = conflictedReport();
        const { report: out, called } = await runFollowUpVerification(report, pkg(), { followUpLlm });
        expect(called).toBe(true);
        expect(out).toBe(report); // same reference — zero mutation
    });

    test('unparseable output leaves the report untouched but counts the call', async () => {
        const followUpLlm = jest.fn().mockResolvedValue('nije json');
        const report = conflictedReport();
        const { report: out, called } = await runFollowUpVerification(report, pkg(), { followUpLlm });
        expect(called).toBe(true);
        expect(out).toBe(report);
        expect(out.conflicts[0].followUp).toBeUndefined();
    });

    test('no llm or no conflicts → no call, no change', async () => {
        const llm = jest.fn();
        expect((await runFollowUpVerification(conflictedReport(), pkg(), {})).called).toBe(false);
        expect((await runFollowUpVerification({ conflicts: [] }, pkg(), { followUpLlm: llm })).called).toBe(false);
        expect(llm).not.toHaveBeenCalled();
    });
});
