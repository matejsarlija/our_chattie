const { OPENROUTER_ROLE_CONFIG, outputCapWarning } = require('../llm/openrouterConfig');

describe('OpenRouter role configuration contract', () => {
    test('declared roles carry the local factory settings', () => {
        expect(Object.keys(OPENROUTER_ROLE_CONFIG).sort()).toEqual([
            'analysis', 'claimJudge', 'ocr', 'ocr-batch', 'planner', 'repair',
            'rerank', 'significance', 'synthesis', 'verify',
        ]);
        for (const config of Object.values(OPENROUTER_ROLE_CONFIG)) {
            expect(config.model).toEqual(expect.any(String));
            expect(config.temperature).toEqual(expect.any(Number));
            expect(config.maxOutputTokens).toEqual(expect.any(Number));
        }
    });

    test('analysis and synthesis caps preserve headroom for dense outputs', () => {
        expect(OPENROUTER_ROLE_CONFIG.analysis.maxOutputTokens).toBeGreaterThanOrEqual(8192);
        expect(OPENROUTER_ROLE_CONFIG.synthesis.maxOutputTokens).toBeGreaterThanOrEqual(16384);
        expect(OPENROUTER_ROLE_CONFIG['ocr-batch'].maxOutputTokens)
            .toBeGreaterThanOrEqual(OPENROUTER_ROLE_CONFIG.ocr.maxOutputTokens);
        expect(OPENROUTER_ROLE_CONFIG.synthesis.temperature).toBeLessThanOrEqual(0.2);
        expect(OPENROUTER_ROLE_CONFIG.verify.temperature).toBeLessThanOrEqual(0.1);
        expect(OPENROUTER_ROLE_CONFIG.repair.model).toBe(OPENROUTER_ROLE_CONFIG.rerank.model);
        expect(OPENROUTER_ROLE_CONFIG.repair.temperature).toBe(0);
        for (const role of ['claimJudge', 'significance']) {
            expect(OPENROUTER_ROLE_CONFIG[role].model).toBe(OPENROUTER_ROLE_CONFIG.rerank.model);
            expect(OPENROUTER_ROLE_CONFIG[role].temperature).toBe(0);
        }
    });

    test('output cap warning identifies the configured role and unknown-role fallback', () => {
        expect(outputCapWarning('analysis')).toContain("'analysis'");
        expect(outputCapWarning('analysis')).toContain(
            `maxTokens=${OPENROUTER_ROLE_CONFIG.analysis.maxOutputTokens}`,
        );
        expect(outputCapWarning('unknown-role')).toContain('provider default');
    });
});
