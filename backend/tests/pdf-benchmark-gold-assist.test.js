'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { suggestGoldFacts, normalizeEvidence, buildGoldPrompt, DEFAULT_GOLD_MODEL, MAX_GOLD_PAGES } = require('../scripts/lib/gold-assist');
const { GOLD_OUTCOMES } = require('../scripts/lib/gold-editor');

function makeChat(content, overrides = {}) {
    return jest.fn().mockResolvedValue({
        response: { choices: [{ message: { content } }] },
        model: DEFAULT_GOLD_MODEL,
        provider: 'Google AI Studio',
        cost: 0.01,
        latencyMs: 200,
        error: null,
        ...overrides,
    });
}

test('gold assist sends one pinned native PDF and returns unverified facts with page evidence', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gold-assist-'));
    const filePath = path.join(directory, 'source.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4 fixture');
    const facts = {
        amounts: [{ rawValue: '1.234,56', currency: 'EUR' }],
        oibs: [{ value: '66124057408', role: 'vjerovnik' }],
        dates: ['12.03.2024.'],
        filingNumbers: ['St-2/2013'],
        decisionOutcome: 'odbija se',
        tables: [{ description: 'troškovnik', rowCount: 2 }],
    };
    const chat = makeChat(JSON.stringify({ facts, evidence: [
        { category: 'amounts', value: '1.234,56 EUR', pageNumber: 1, quote: 'tražbina 1.234,56 EUR' },
        { category: 'oibs', value: '66124057408', pageNumber: 1, quote: 'OIB 66124057408' },
    ] }));
    try {
        const result = await suggestGoldFacts({
            filePath, filename: 'source.pdf', pages: 2,
            metadata: { architecture: { input_modalities: ['text', 'image', 'file'] } },
            chat,
        });
        const request = chat.mock.calls[0][0];
        expect(request.model).toBe('google/gemini-3.7-flash');
        expect(request.plugins).toEqual([{ id: 'file-parser', pdf: { engine: 'native' } }]);
        expect(request.max_tokens).toBe(4096);
        expect(request.provider).toMatchObject({ order: ['Google AI Studio'], allow_fallbacks: false, data_collection: 'deny' });
        expect(result).toMatchObject({ model: DEFAULT_GOLD_MODEL, provider: 'Google AI Studio', cost: 0.01, facts });
        expect(result.evidence[0]).toMatchObject({ category: 'amounts', pageNumber: 1 });
        expect(result.factsComplete).toBeUndefined();
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('gold assist requires declared PDF support and refuses oversized source documents', async () => {
    const chat = makeChat('{}');
    const input = { filePath: __filename, pages: 1, chat };
    await expect(suggestGoldFacts({ ...input, metadata: { architecture: { input_modalities: ['text', 'image'] } } })).rejects.toThrow(/native PDF input/i);
    await expect(suggestGoldFacts({ ...input, pages: MAX_GOLD_PAGES + 1, metadata: { architecture: { input_modalities: ['file'] } } })).rejects.toThrow(/limited to 12 pages/i);
    expect(chat).not.toHaveBeenCalled();
});

test('gold assist rejects malformed fact rows instead of presenting them as valid suggestions', async () => {
    const chat = makeChat(JSON.stringify({ facts: { tables: [{ description: 'troškovnik', rowCount: '' }] }, evidence: [] }));
    await expect(suggestGoldFacts({
        filePath: __filename,
        pages: 1,
        metadata: { architecture: { input_modalities: ['file'] } },
        chat,
    })).rejects.toThrow(/row count is required/i);
});

test('structured fact citations render as concise labels and invalid page quotes are dropped', () => {
    expect(normalizeEvidence([
        { category: 'amounts', value: '{"rawValue":"67.320,00","currency":"EUR"}', pageNumber: 1, quote: '67.320,00 €' },
        { category: 'tables', value: { description: 'Stavke računa', rowCount: 2 }, pageNumber: 9, quote: 'two rows' },
    ], 2)).toEqual({
        evidence: [{ category: 'amounts', value: '67.320,00 EUR', pageNumber: 1, quote: '67.320,00 €' }],
        invalid: [2],
    });
});

test('suggestion guidance uses the extraction vocabulary without rewriting saved source labels', () => {
    const prompt = buildGoldPrompt(1);
    for (const outcome of GOLD_OUTCOMES) expect(prompt).toContain(outcome);
    expect(prompt).toContain('"odbija se" means rejected');
    expect(prompt).toContain('"odbacuje se" means dismissed');
    expect(prompt).toContain('preserve the source wording instead');
});