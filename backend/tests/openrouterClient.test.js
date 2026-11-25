const { createOpenRouterClient, normalizeUsage } = require('../llm/openrouterClient');

describe('OpenRouter client', () => {
    const originalFetch = global.fetch;
    const originalApiKey = process.env.OPENROUTER_API_KEY;

    afterEach(() => {
        global.fetch = originalFetch;
        if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = originalApiKey;
    });

    test('converts a string prompt into a user message and normalizes response usage', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                id: 'completion-1',
                model: 'provider/model',
                provider: 'provider',
                choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
                usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
            }),
        });

        const client = createOpenRouterClient({ model: 'provider/model', temperature: 0, maxTokens: 100 });
        const response = await client.invoke('return JSON');

        expect(global.fetch).toHaveBeenCalledWith(
            'https://openrouter.ai/api/v1/chat/completions',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({ authorization: 'Bearer test-key' }),
                body: JSON.stringify({
                    model: 'provider/model',
                    messages: [{ role: 'user', content: 'return JSON' }],
                    temperature: 0,
                    max_tokens: 100,
                }),
            }),
        );
        expect(response).toMatchObject({
            content: '{"ok":true}',
            usage_metadata: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
            response_metadata: { model: 'provider/model', provider: 'provider', finish_reason: 'stop' },
        });
    });

    test('preserves messages arrays and returns null for absent usage', async () => {
        process.env.OPENROUTER_API_KEY = 'test-key';
        const messages = [{ role: 'user', content: [{ type: 'text', text: 'read' }] }];
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ choices: [{ message: { content: 'done' } }] }),
        });

        const response = await createOpenRouterClient({ model: 'provider/model' }).invoke(messages);
        const request = JSON.parse(global.fetch.mock.calls[0][1].body);

        expect(request.messages).toEqual(messages);
        expect(response.usage_metadata).toBeNull();
    });

    test('rejects before making a request when the API key is missing', async () => {
        delete process.env.OPENROUTER_API_KEY;
        global.fetch = jest.fn();
        await expect(createOpenRouterClient({ model: 'provider/model' }).invoke('prompt'))
            .rejects.toThrow('OPENROUTER_API_KEY is not set');
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('normalizes partial usage without inventing missing token counts', () => {
        expect(normalizeUsage({ prompt_tokens: 7 })).toEqual({
            input_tokens: 7,
            output_tokens: null,
            total_tokens: null,
        });
    });
});
