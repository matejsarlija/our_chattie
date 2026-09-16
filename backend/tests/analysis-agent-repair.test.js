const fs = require('fs');
const os = require('os');
const path = require('path');

const mockGeminiInvoke = jest.fn();

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        invoke: mockGeminiInvoke,
    })),
}));

jest.mock('../helpers/geminiRetry', () => ({
    withGeminiRetry: (fn) => fn(),
    withGeminiTimeout: (fn) => fn(),
}));

jest.mock('../helpers/geminiUsage', () => ({
    trackGeminiInvoke: (_gemini, prompt, _opts) => mockGeminiInvoke(prompt),
}));

const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');

const GOOD_AMOUNT = {
    description: 'Tražbina vjerovnika',
    amount: 15000,
    currency: 'EUR',
    direction: 'obveza',
    quote: 'Tražbina vjerovnika iznosi 15.000 EUR.'
};

function goodDoc(amounts = [GOOD_AMOUNT]) {
    return JSON.stringify({
        caseNumber: 'ST-2/2013',
        decisionDate: '2024-01-10',
        summary: 'Sažetak dokumenta.',
        amounts,
        propertyFlow: [],
        citedFilingReferences: []
    });
}

describe('AnalyzeDocumentsTool field repair (T1-3)', () => {
    let tmpDir;
    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-'));
        mockGeminiInvoke.mockReset();
    });
    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    function txtFile(name, content) {
        const filePath = path.join(tmpDir, name);
        fs.writeFileSync(filePath, content);
        return { filePath, text: name };
    }

    function run(files) {
        const tool = new AnalyzeDocumentsTool();
        return tool._call({ files, caseInfo: { participants: [] }, progressCallback: jest.fn() });
    }

    test('valid documents cost exactly one call and carry no gaps', async () => {
        mockGeminiInvoke.mockResolvedValue({ content: goodDoc() });
        const result = await run([txtFile('a.txt', 'Tekst dokumenta o tražbini.')]);

        expect(mockGeminiInvoke).toHaveBeenCalledTimes(1);
        const item = result.individualAnalyses[0];
        expect(item.aiResult).toBeTruthy();
        expect(item.aiResult.amounts).toHaveLength(1);
        expect(item.aiResult._extractionGaps).toBeUndefined();
        expect(result.coverage).toEqual(expect.objectContaining({ analyzed: 1, failed: 0 }));
    });

    test('malformed amounts array is repaired from the source excerpt, valid fields preserved', async () => {
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('FIELD REPAIR')) {
                expect(String(prompt)).toContain('Tekst dokumenta o tražbini');
                return Promise.resolve({ content: JSON.stringify({ value: [GOOD_AMOUNT], absent: false }) });
            }
            return Promise.resolve({
                content: JSON.stringify({
                    caseNumber: 'ST-2/2013',
                    decisionDate: '2024-01-10',
                    summary: 'Sačuvani sažetak.',
                    amounts: 'not-an-array',
                    propertyFlow: []
                })
            });
        });
        const result = await run([txtFile('b.txt', 'Tekst dokumenta o tražbini.')]);

        expect(mockGeminiInvoke).toHaveBeenCalledTimes(2);
        const item = result.individualAnalyses[0];
        expect(item.aiResult).toBeTruthy();
        expect(item.aiResult.summary).toBe('Sačuvani sažetak.');
        expect(item.aiResult.amounts).toHaveLength(1);
        expect(item.aiResult.amounts[0]).toEqual(expect.objectContaining({ description: 'Tražbina vjerovnika' }));
        expect(item.aiResult._extractionGaps).toBeUndefined();
    });

    test('unparseable main completion is salvaged by one full repair', async () => {
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('EXTRACTION REPAIR')) {
                return Promise.resolve({ content: goodDoc() });
            }
            return Promise.resolve({ content: 'ovo nije json {{{' });
        });
        const result = await run([txtFile('c.txt', 'Tekst dokumenta.')]);

        expect(mockGeminiInvoke).toHaveBeenCalledTimes(2);
        const item = result.individualAnalyses[0];
        expect(item.aiResult).toBeTruthy();
        expect(item.aiResult.summary).toBe('Sažetak dokumenta.');
        expect(result.coverage).toEqual(expect.objectContaining({ analyzed: 1, failed: 0 }));
    });

    test('repair answering absent accepts empty without gaps', async () => {
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('FIELD REPAIR')) {
                return Promise.resolve({ content: JSON.stringify({ value: null, absent: true }) });
            }
            return Promise.resolve({
                content: JSON.stringify({ summary: 'Bez iznosa.', amounts: { broken: true }, propertyFlow: [] })
            });
        });
        const result = await run([txtFile('d.txt', 'Tekst bez iznosa.')]);

        const item = result.individualAnalyses[0];
        expect(item.aiResult).toBeTruthy();
        expect(item.aiResult.amounts).toEqual([]);
        expect(item.aiResult._extractionGaps).toBeUndefined();
    });

    test('unrepairable output keeps partial fields, records gaps, and stays analyzed', async () => {
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('REPAIR')) {
                return Promise.resolve({ content: 'still garbage {{{' });
            }
            return Promise.resolve({
                content: JSON.stringify({ summary: 'Djelomični sažetak.', amounts: 'broken', propertyFlow: [] })
            });
        });
        const result = await run([txtFile('e.txt', 'Tekst.')]);

        const item = result.individualAnalyses[0];
        expect(item.aiResult).toBeTruthy();
        expect(item.aiResult.summary).toBe('Djelomični sažetak.');
        expect(item.aiResult.amounts).toEqual([]);
        expect(item.aiResult._extractionGaps).toEqual([
            expect.objectContaining({ field: 'amounts', code: 'schema-mismatch' })
        ]);
    });

    test('total garbage in main and repair fails the file as malformed-json without harming siblings', async () => {
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('REPAIR')) {
                return Promise.resolve({ content: 'still garbage {{{' });
            }
            if (String(prompt).includes('Dobar tekst')) {
                return Promise.resolve({ content: goodDoc() });
            }
            return Promise.resolve({ content: 'ovo nije json {{{' });
        });
        const result = await run([txtFile('f.txt', 'Loš tekst.'), txtFile('g.txt', 'Dobar tekst o tražbini.')]);

        expect(result.individualAnalyses[0].aiResult).toBeNull();
        expect(result.individualAnalyses[1].aiResult).toBeTruthy();
        expect(result.coverage).toEqual(expect.objectContaining({ analyzed: 1, failed: 1 }));
        expect(result.coverage.failedFiles).toEqual([
            expect.objectContaining({ fileName: 'f.txt', code: 'malformed-json' })
        ]);
    });

    test('contentHash identifies exact source bytes, not normalized extracted text', async () => {
        const crypto = require('crypto');
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('REPAIR')) {
                return Promise.resolve({ content: 'still garbage {{{' });
            }
            return Promise.resolve({ content: goodDoc() });
        });
        const tool = new AnalyzeDocumentsTool();
        const expected = crypto.createHash('sha256').update('Tekst  dokumenta.').digest('hex');
        const result = await tool._call({
            files: [txtFile('x.txt', 'Tekst  dokumenta.'), txtFile('y.txt', 'Tekst dokumenta.')],
            caseInfo: { participants: [] },
            progressCallback: jest.fn()
        });

        // Similar extracted text is not byte identity and must not dedupe.
        expect(result.individualAnalyses[0].contentHash).toBe(expected);
        expect(result.individualAnalyses[1].contentHash).not.toBe(expected);
    });

    test('empty JSON is repaired rather than counted as a successful extraction', async () => {
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('EXTRACTION REPAIR')) return Promise.resolve({ content: goodDoc() });
            return Promise.resolve({ content: '{}' });
        });
        const result = await run([txtFile('empty.txt', 'Tekst dokumenta.')]);
        expect(mockGeminiInvoke).toHaveBeenCalledTimes(2);
        expect(result.individualAnalyses[0].aiResult.summary).toBe('Sažetak dokumenta.');
    });

    test('schema-mismatch failures classify with causal chains', async () => {
        // Parseable root with no usable content: repair runs, fails, file dies
        // as schema-mismatch (not malformed-json).
        mockGeminiInvoke.mockImplementation((prompt) => {
            if (String(prompt).includes('REPAIR')) {
                return Promise.resolve({ content: 'still garbage {{{' });
            }
            return Promise.resolve({ content: JSON.stringify({ amounts: 'broken', propertyFlow: 42 }) });
        });
        const result = await run([txtFile('h.txt', 'Tekst.')]);

        expect(mockGeminiInvoke).toHaveBeenCalledTimes(2);
        expect(result.individualAnalyses[0].aiResult).toBeNull();
        expect(result.coverage.failedFiles).toEqual([
            expect.objectContaining({ fileName: 'h.txt', code: 'schema-mismatch' })
        ]);
        expect(result.coverage.failedFiles[0].causalChain.length).toBeGreaterThan(0);
    });
});
