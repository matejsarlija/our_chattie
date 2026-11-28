const { extractJsonBlock, extractJsonArray, extractJsonArrayAtKey, stripCodeFences, modelContentToText } = require('../llm/jsonExtract');

describe('extractJsonBlock', () => {
    const object = { caseNumber: 'St-2/2013', summary: 'Otvoren stečaj.' };

    test('parses clean JSON directly', () => {
        expect(extractJsonBlock(JSON.stringify(object))).toEqual(object);
    });

    test('parses fenced JSON with language tag and stray whitespace', () => {
        const fenced = '```json\n' + JSON.stringify(object, null, 2) + '\n```';
        expect(extractJsonBlock(fenced)).toEqual(object);
    });

    test('recovers JSON wrapped in prose before and after the block', () => {
        const chatty = 'Here is the requested JSON:\n```json\n'
            + JSON.stringify(object) + '\n```\nLet me know if you need anything else!';
        expect(extractJsonBlock(chatty)).toEqual(object);
    });

    test('recovers unfenced JSON embedded in prose via balanced scan', () => {
        const prose = 'The result {"a": 1, "b": {"c": "two }} quotes"}} was extracted.';
        expect(extractJsonBlock(prose)).toEqual({ a: 1, b: { c: 'two }} quotes' } });
    });

    test('is string-aware: brackets inside string literals do not break balance', () => {
        const tricky = '{"text": "iznos je 100 {EUR} \\" i [niz]", "ok": true} trailing';
        expect(extractJsonBlock(tricky)).toEqual({ text: 'iznos je 100 {EUR} " i [niz]', ok: true });
    });

    test('extracts arrays for verifier-style responses', () => {
        const array = [{ index: 1, status: 'supported' }];
        expect(extractJsonBlock('```json\n' + JSON.stringify(array) + '\n```')).toEqual(array);
    });

    test('returns null for non-text input and unparseable text', () => {
        expect(extractJsonBlock(null)).toBeNull();
        expect(extractJsonBlock(undefined)).toBeNull();
        expect(extractJsonBlock(42)).toBeNull();
        expect(extractJsonBlock('')).toBeNull();
        expect(extractJsonBlock('This is not JSON')).toBeNull();
        expect(extractJsonBlock('{"unterminated": true')).toBeNull();
        expect(extractJsonBlock([])).toBeNull();
        expect(extractJsonBlock([{ type: 'image_url' }])).toBeNull();
    });

    test('extracts JSON from a LangChain content-block array', () => {
        expect(extractJsonBlock([
            { type: 'text', text: '```json\n' + JSON.stringify(object) + '\n```' },
        ])).toEqual(object);
    });

    test('prefers a complete trailing answer over a truncated leading part', () => {
        expect(extractJsonBlock([
            { type: 'text', text: '```json\n{"caseNumber": "St-2/2013", "summ' },
            { type: 'text', text: JSON.stringify(object) },
        ])).toEqual(object);
    });

    test('concatenates a JSON object split across content parts', () => {
        const split = JSON.stringify(object, null, 2);
        const midpoint = Math.floor(split.length / 2);
        expect(extractJsonBlock([
            { type: 'text', text: split.slice(0, midpoint) },
            { type: 'text', text: split.slice(midpoint) },
        ])).toEqual(object);
    });

    test('preserves the outer ranking array split between complete rows', () => {
        const items = [{ index: 0, score: 90 }, { index: 1, score: 70 }];
        const blocks = [
            { type: 'text', text: `[${JSON.stringify(items[0])},` },
            { type: 'text', text: `${JSON.stringify(items[1])}]` },
        ];
        expect(extractJsonBlock(blocks)).toEqual(items);
        expect(extractJsonArray(blocks)).toEqual({ items, truncated: false });
    });

    test('prefers a complete joined response over a standalone inner row block', () => {
        const items = [{ index: 0, score: 90 }, { index: 1, score: 70 }];
        const blocks = [
            { type: 'text', text: '```json\n[' },
            { type: 'text', text: JSON.stringify(items[0]) },
            { type: 'image_url', image_url: 'ignored' },
            { type: 'text', text: `,${JSON.stringify(items[1])}]\n\`\`\`` },
        ];
        expect(extractJsonBlock(blocks)).toEqual(items);
        expect(extractJsonArray(blocks)).toEqual({ items, truncated: false });
    });

    test('keeps the last independent answer when blocks cannot form one response', () => {
        const first = [{ index: 0, score: 10 }];
        const last = [{ index: 0, score: 90 }];
        for (const blocks of [
            [JSON.stringify(first), JSON.stringify(last)],
            [`Earlier answer:\n${JSON.stringify(first)}`, `Final answer:\n${JSON.stringify(last)}`],
            ['[{"index":0,"sco', JSON.stringify(last)],
        ]) {
            expect(extractJsonBlock(blocks)).toEqual(last);
            expect(extractJsonArray(blocks)).toEqual({ items: last, truncated: false });
        }
    });

    test('returns null rather than a string when only prose exists inside braces', () => {
        // A balanced {...} exists but its content is not valid JSON.
        expect(extractJsonBlock('random {not json at all} text')).toBeNull();
    });

    test('stripCodeFences removes all fence markers', () => {
        expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
        expect(stripCodeFences('```\nplain\n```')).toBe('plain');
    });

    test('returns the outer array, not its first element, when prose precedes it', () => {
        const array = [{ index: 1, status: 'supported' }, { index: 2, status: 'unsupported' }];
        const chatty = `Here are the verdicts you asked for:\n${JSON.stringify(array)}\nDone.`;
        expect(extractJsonBlock(chatty)).toEqual(array);
        expect(extractJsonArray(chatty)).toEqual({ items: array, truncated: false });
    });
});

describe('extractJsonArray', () => {
    test('accepts a bare array, a fenced array, and a single-key wrapper', () => {
        const items = [{ index: 1, status: 'supported' }];
        expect(extractJsonArray(JSON.stringify(items))).toEqual({ items, truncated: false });
        expect(extractJsonArray('```json\n' + JSON.stringify(items) + '\n```')).toEqual({ items, truncated: false });
        expect(extractJsonArray(JSON.stringify({ results: items }))).toEqual({ items, truncated: false });
    });

    test('keeps the complete leading items of a truncated array', () => {
        const truncated = '[{"index":1,"status":"supported"},{"index":2,"status":"contradicted"},{"index":3,"sta';
        expect(extractJsonArray(truncated)).toEqual({
            items: [
                { index: 1, status: 'supported' },
                { index: 2, status: 'contradicted' },
            ],
            truncated: true,
        });
    });

    test('skips prose brackets before the real array when salvaging', () => {
        const text = 'Bilješka [napomena] prije popisa:\n[{"index":1,"status":"supported"},{"index":2,"sta';
        expect(extractJsonArray(text)).toEqual({
            items: [{ index: 1, status: 'supported' }],
            truncated: true,
        });
    });

    test('returns null when no complete element survives', () => {
        expect(extractJsonArray('[{"index":1,')).toBeNull();
        expect(extractJsonArray('not json at all')).toBeNull();
        expect(extractJsonArray(null)).toBeNull();
    });

    test('recovers a named array from an object cut off before its closing braces', () => {
        const truncated = '```json\n{"statements": [{"text":"Prva tvrdnja.","factIds":["f1"]},'
            + '{"text":"Druga tvrdnja.","factIds":["f2"]}';
        expect(extractJsonBlock(truncated)).toBeNull();
        expect(extractJsonArrayAtKey(truncated, 'statements')).toEqual({
            items: [
                { text: 'Prva tvrdnja.', factIds: ['f1'] },
                { text: 'Druga tvrdnja.', factIds: ['f2'] },
            ],
            truncated: true,
        });
        expect(extractJsonArrayAtKey(truncated, 'missing')).toBeNull();
    });
});

describe('modelContentToText', () => {
    test('passes strings through unchanged', () => {
        expect(modelContentToText('{"ok":true}')).toBe('{"ok":true}');
    });

    test('joins text blocks and ignores non-text blocks', () => {
        expect(modelContentToText([
            { type: 'text', text: '{"a":' },
            { type: 'image_url', image_url: 'data:image/jpeg;base64,xxx' },
            { type: 'text', text: '1}' },
        ])).toBe('{"a":1}');
    });

    test('accepts a single content block and returns empty for unusable input', () => {
        expect(modelContentToText({ type: 'text', text: 'hello' })).toBe('hello');
        expect(modelContentToText(null)).toBe('');
        expect(modelContentToText(42)).toBe('');
        expect(modelContentToText([{ type: 'image_url' }])).toBe('');
    });
});
