const { handleDocumentEdit } = require('../chatAgent');

// Mocking ChatGoogleGenerativeAI
jest.mock('@langchain/google-genai', () => {
    return {
        ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => {
            return {
                stream: jest.fn().mockImplementation(async function* () {
                    yield { content: 'Uređeni ' };
                    yield { content: 'pravni ' };
                    yield { content: 'tekst.' };
                })
            };
        })
    };
});

describe('handleDocumentEdit', () => {
    it('should call the AI model and return a stream', async () => {
        const payload = {
            content: 'Ovo je test.',
            instruction: 'Učini formalnijim.',
            context: { legalContext: true }
        };

        const result = await handleDocumentEdit(payload);
        expect(result).toHaveProperty('stream');

        const chunks = [];
        for await (const chunk of result.stream) {
            chunks.push(chunk.content);
        }

        expect(chunks.join('')).toBe('Uređeni pravni tekst.');
    });
});
