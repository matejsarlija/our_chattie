const mockTrackInvoke = jest.fn();

jest.mock('../helpers/geminiUsage', () => ({
    trackGeminiInvoke: (...args) => mockTrackInvoke(...args),
    createUsageTracker: jest.fn(() => ({ snapshot: () => ({}) })),
}));

jest.mock('../helpers/geminiRetry', () => ({
    withGeminiRetry: jest.fn((fn) => fn()),
    withGeminiTimeout: jest.fn((callable) => callable(undefined)),
}));

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({})),
}));

const { VisualizerTool } = require('../court-analysis/agents/visualizer-agent');

describe('visualizer property-flow subgraph', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTrackInvoke.mockResolvedValue({ content: '```mermaid\nflowchart TD\nA["x"]\n```' });
    });

    test('accepts options.propertyFlow alongside options.moneyFlow', async () => {
        const tool = new VisualizerTool();
        const result = await tool._call('Sažetak predmeta.', {
            moneyFlow: { entries: [{ amount: 1200, currency: 'EUR', description: 'Polog' }] },
            propertyFlow: {
                entries: [
                    {
                        id: 'prop-1', description: 'Proizvodni strojevi', assetType: 'pokretnina',
                        transferor: 'Ducanor d.o.o.', transferee: 'Kupac Prostor d.o.o.',
                        value: 25000, currency: 'EUR', date: '2023-02-10',
                    },
                ],
            },
        });
        expect(result).toContain('flowchart TD');
        const prompt = mockTrackInvoke.mock.calls[0]?.[1];
        expect(prompt).toContain('Tijek imovine');
        expect(prompt).toContain('Proizvodni strojevi');
    });

    test('tražbina supersedes links render as a directional chain instruction', async () => {
        const tool = new VisualizerTool();
        await tool._call('Sažetak predmeta.', {
            propertyFlow: {
                entries: [
                    {
                        id: 'prop-1', description: 'Tražbina vjerovnika', assetType: 'tražbina',
                        eventType: 'prijava', value: 84500, currency: 'EUR',
                    },
                    {
                        id: 'prop-2', description: 'Tražbina vjerovnika', assetType: 'tražbina',
                        eventType: 'ustup', transferor: 'Vjerovnik A d.o.o.',
                        transferee: 'Kupac Tražbina d.o.o.', value: 15000, currency: 'EUR',
                        supersedes: 'prop-1',
                    },
                ],
            },
        });
        const prompt = mockTrackInvoke.mock.calls[0]?.[1];
        expect(prompt).toContain('supersedes');
        expect(prompt).toContain('directional chain');
    });

    test('no empty property subgraph instruction when propertyFlow is empty', async () => {
        const tool = new VisualizerTool();
        await tool._call('Sažetak predmeta.', {
            moneyFlow: { entries: [{ amount: 100, currency: 'EUR', description: 'Trošak' }] },
            propertyFlow: { entries: [] },
        });
        const prompt = mockTrackInvoke.mock.calls[0]?.[1];
        expect(prompt).not.toContain('STRUCTURED PROPERTY-FLOW DATA');
        expect(prompt).toContain('omit the "Tijek imovine" subgraph entirely');
    });
});
