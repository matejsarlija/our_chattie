jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation((config) => config),
}));

const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');
const {
    createGeminiClient,
    GEMINI_ROLE_CONFIG,
    DEFAULT_GEMINI_MODEL,
} = require('../helpers/geminiConfig');

describe('createGeminiClient role factory', () => {
    beforeEach(() => {
        ChatGoogleGenerativeAI.mockClear();
    });

    test('every declared role applies its temperature and output cap', () => {
        for (const [role, expected] of Object.entries(GEMINI_ROLE_CONFIG)) {
            createGeminiClient(role);
            expect(ChatGoogleGenerativeAI).toHaveBeenLastCalledWith(
                expect.objectContaining({
                    model: DEFAULT_GEMINI_MODEL,
                    temperature: expected.temperature,
                    maxOutputTokens: expected.maxOutputTokens,
                }),
            );
        }
    });

    test('known roles resolve to the documented policies', () => {
        // Guard the euro-relevant invariants explicitly: strict-fact roles are
        // low-temperature, and JSON-returning roles keep generous output
        // headroom so dense documents never truncate mid-JSON.
        expect(GEMINI_ROLE_CONFIG.analysis.maxOutputTokens).toBeGreaterThanOrEqual(8192);
        expect(GEMINI_ROLE_CONFIG['ocr-batch'].maxOutputTokens)
            .toBeGreaterThanOrEqual(GEMINI_ROLE_CONFIG.ocr.maxOutputTokens);
        expect(GEMINI_ROLE_CONFIG.synthesis.temperature).toBeLessThanOrEqual(0.2);
        expect(GEMINI_ROLE_CONFIG.verify.temperature).toBeLessThanOrEqual(0.1);
        expect(Object.keys(GEMINI_ROLE_CONFIG).sort()).toEqual(
            ['analysis', 'ocr', 'ocr-batch', 'synthesis', 'verify', 'visualizer'],
        );
    });

    test('outputCapWarning names the role and its configured cap', () => {
        const { outputCapWarning } = require('../helpers/geminiConfig');
        const warning = outputCapWarning('analysis');
        expect(warning).toContain("'analysis'");
        expect(warning).toContain(`maxOutputTokens=${GEMINI_ROLE_CONFIG.analysis.maxOutputTokens}`);
        expect(outputCapWarning('unknown-role')).toContain('provider default');
    });
});
