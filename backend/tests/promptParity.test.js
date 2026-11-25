'use strict';

const {
    EXTRACTION_SIGNATURE_V5,
    STATIC_EXTRACTION_SYSTEM_PROMPT,
    buildAnalysisMessages,
    buildAnalysisPrompt,
    buildFieldRepairPrompt,
    buildFullRepairPrompt,
} = require('../court-analysis/extraction/prompts');
const {
    REPAIRABLE_FIELDS,
    PROCEDURAL_OUTCOMES,
    parseFieldRepairResponse,
} = require('../court-analysis/reasoning/schema/extractionSchema');

describe('EXTRACTION_SIGNATURE_V5 prompt & repair parity', () => {
    test('static system prompt removes legacy GFI check and syntax typo and separates static/dynamic messages', () => {
        expect(STATIC_EXTRACTION_SYSTEM_PROMPT).not.toContain('failed to file financial reports (GFI)');
        expect(STATIC_EXTRACTION_SYSTEM_PROMPT).not.toContain('"decisionOutcome" (a medium-sized paragraph summary in Croatian)');
        expect(STATIC_EXTRACTION_SYSTEM_PROMPT).toContain('"keyClaims"');
        expect(STATIC_EXTRACTION_SYSTEM_PROMPT).toContain('"tableRows"');
        expect(EXTRACTION_SIGNATURE_V5.version).toBe(5);
        expect(EXTRACTION_SIGNATURE_V5.promptHash).toMatch(/^[a-f0-9]{16}$/);

        const msgsA = buildAnalysisMessages('- Marko Marić', 'Tekst A');
        const msgsB = buildAnalysisMessages('- Ivana Ivić', 'Tekst B');
        expect(msgsA).toHaveLength(2);
        expect(msgsA[0].role).toBe('system');
        expect(msgsB[0].role).toBe('system');
        expect(msgsA[0].content).toBe(msgsB[0].content);
        expect(msgsA[1].role).toBe('user');
        expect(msgsA[1].content).toContain('Tekst A');
        expect(String(msgsA)).toContain(STATIC_EXTRACTION_SYSTEM_PROMPT);
        expect(String(msgsA)).toContain('Tekst A');
        expect(JSON.parse(JSON.stringify(msgsA))).toHaveLength(2);
    });

    test('decisionOutcome rules and appellate tie-breaker stay in lockstep across main, full-repair, and field-repair prompts', () => {
        expect(REPAIRABLE_FIELDS).toContain('decisionOutcome');
        const mainPrompt = buildAnalysisPrompt('Sudionik A', 'Izreka: žalba se odbija i potvrđuje prvostupanjsko rješenje.');
        const fullRepairPrompt = buildFullRepairPrompt({ sourceText: 'Izreka...' });
        const decisionRepairPrompt = buildFieldRepairPrompt({ field: 'decisionOutcome', sourceText: 'Izreka...' });

        for (const prompt of [mainPrompt, fullRepairPrompt, decisionRepairPrompt]) {
            expect(prompt).toContain('appellate clause rejects an appeal and also confirms the lower-court ruling, decisionOutcome MUST be "rejected"');
            for (const outcome of PROCEDURAL_OUTCOMES) {
                expect(prompt).toContain(outcome);
            }
        }

        expect(parseFieldRepairResponse('{"value": "rejected", "absent": false}', 'decisionOutcome')).toEqual({
            ok: true,
            absent: false,
            value: 'rejected',
        });
        expect(parseFieldRepairResponse('{"value": null, "absent": true}', 'decisionOutcome')).toEqual({
            ok: true,
            absent: true,
            value: null,
        });
        expect(parseFieldRepairResponse('{"value": "invented-status", "absent": false}', 'decisionOutcome').ok).toBe(false);
    });
});
