const os = require('os');
const path = require('path');

const mockInvoke = jest.fn();
const mockWithGeminiRetry = jest.fn();

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({ invoke: mockInvoke }))
}));

jest.mock('../../helpers/geminiRetry', () => ({
    withGeminiRetry: (...args) => mockWithGeminiRetry(...args),
    withGeminiTimeout: (callable) => callable(undefined)
}));

const { resolveRerankMode, shouldAttemptRerank, buildRerankPrompt, createLlmRerank } = require('../../court-analysis/reasoning/rerankerClient');

describe('rerankerClient gating and transport (Phase 1.2)', () => {
    const originalEnv = { ...process.env };
    // Point the resolver at an empty data dir so env values win over any
    // persisted settings.json.
    const tmpDataDir = path.join(os.tmpdir(), `reranker-client-test-${process.pid}`);

    beforeAll(() => {
        process.env.ANALYSIS_DATA_DIR = tmpDataDir;
    });

    afterEach(() => {
        process.env.REASONING_RERANK = originalEnv.REASONING_RERANK;
        jest.clearAllMocks();
    });

    describe('resolveRerankMode', () => {
        test.each([
            ['', 'auto'],
            ['auto', 'auto'],
            ['force', 'force'],
            ['off', 'off'],
            ['FORCE', 'force'],
            ['nonsense', 'auto']
        ])('env %j → %j', (input, expected) => {
            if (input === '') delete process.env.REASONING_RERANK;
            else process.env.REASONING_RERANK = input;
            expect(resolveRerankMode()).toBe(expected);
        });
    });

    describe('shouldAttemptRerank', () => {
        test('off never attempts, even when forced by ambiguity', () => {
            process.env.REASONING_RERANK = 'off';
            expect(shouldAttemptRerank({ ambiguous: true })).toBe(false);
        });

        test('force attempts regardless of ambiguity', () => {
            process.env.REASONING_RERANK = 'force';
            expect(shouldAttemptRerank({ ambiguous: false })).toBe(true);
        });

        test('auto attempts only on ambiguity', () => {
            delete process.env.REASONING_RERANK;
            expect(shouldAttemptRerank({ ambiguous: false })).toBe(false);
            expect(shouldAttemptRerank({ ambiguous: true })).toBe(true);
        });
    });

    describe('createLlmRerank', () => {
        beforeEach(() => {
            mockWithGeminiRetry.mockImplementation((fn) => fn());
            mockInvoke.mockResolvedValue({ content: '[{"id":"a","score":0.9}]' });
        });

        test('returns parsed scores on success', async () => {
            const llmRerank = createLlmRerank();
            const result = await llmRerank({ candidates: [{ id: 'a', text: 'dokaz' }] });
            expect(result).toEqual([{ id: 'a', score: 0.9 }]);
            expect(mockInvoke).toHaveBeenCalledTimes(1);
        });

        test('returns null (not throw) on unparseable output so caller falls back', async () => {
            mockInvoke.mockResolvedValue({ content: 'nije json' });
            const llmRerank = createLlmRerank();
            await expect(llmRerank({ candidates: [{ id: 'a', text: 'x' }] })).resolves.toBeNull();
        });

        test('propagates transport errors for reranker fallback handling', async () => {
            mockInvoke.mockRejectedValue(new Error('network down'));
            const llmRerank = createLlmRerank();
            await expect(llmRerank({ candidates: [{ id: 'a', text: 'x' }] })).rejects.toThrow('network down');
        });
    });

    test('prompt demands strict JSON array with ids and 0-1 scores', () => {
        const prompt = buildRerankPrompt([{ id: 's-1', text: 'isječak' }]);
        expect(prompt).toContain('"score"');
        expect(prompt).toContain('[s-1]');
        expect(prompt).toContain('JSON');
    });
});
