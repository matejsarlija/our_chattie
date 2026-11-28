'use strict';

const schema = require('../court-analysis/reasoning/schema/extractionSchema');
const prompts = require('../court-analysis/extraction/prompts');
const goldEditor = require('../scripts/lib/gold-editor');

describe('Prompt-Schema-Repair-Scorer Lockstep Guard', () => {
    test('EXTRACTION_SIGNATURE_V5 stays version-locked with extractionSchema', () => {
        expect(prompts.EXTRACTION_SIGNATURE_V5.version).toBe(schema.EXTRACTION_SCHEMA_VERSION);
        expect(prompts.EXTRACTION_SIGNATURE_V5.repairableFields).toEqual(schema.REPAIRABLE_FIELDS);
        expect(schema.REPAIRABLE_FIELDS).toContain('decisionOutcome');
    });

    test('buildAnalysisMessages, buildFieldRepairPrompt, and buildFullRepairPrompt include shared rules and omit external GFI lookup', () => {
        const messages = prompts.buildAnalysisMessages('Diobeni popis.pdf', 'Tekst dokumenta');
        const userText = messages.map((m) => m.content).join('\n');
        expect(userText).toContain('decisionOutcome');
        expect(userText).toContain('tableRows');
        expect(userText).not.toMatch(/GFI|Sudski registar/i);

        const fieldRepair = schema.buildFieldRepairPrompt({ field: 'decisionOutcome', sourceText: 'Odbija se žalba.' });
        expect(fieldRepair).toContain('upheld');
        expect(fieldRepair).toContain('rejected');

        const fullRepair = schema.buildFullRepairPrompt('{"broken":', 'Odbija se žalba i potvrđuje rješenje.');
        expect(fullRepair).toContain('rejects an appeal');
        expect(fullRepair).toContain('rejected');
    });

    test('asFiniteNumberOrNull parses Croatian thousands-formatted numbers cleanly', () => {
        expect(schema.asFiniteNumberOrNull('1.200.000,00')).toBe(1200000);
        expect(schema.asFiniteNumberOrNull('808,98')).toBe(808.98);
        expect(schema.asFiniteNumberOrNull('136.077.942,31')).toBe(136077942.31);
    });

    test('hasReceivableAssignmentCue matches Croatian assignment phrasing', () => {
        expect(schema.hasReceivableAssignmentCue('Ugovor o ustupu tražbine i potraživanje')).toBe(true);
    });

    test('gold-editor outcomes remain aligned with PROCEDURAL_OUTCOMES', () => {
        for (const outcome of goldEditor.GOLD_OUTCOMES) {
            expect(schema.PROCEDURAL_OUTCOMES).toContain(outcome);
        }
    });
});
