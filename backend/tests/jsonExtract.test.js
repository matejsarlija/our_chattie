const { extractJsonBlock, stripCodeFences } = require('../helpers/jsonExtract');

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

    test('returns null for non-string input and unparseable text', () => {
        expect(extractJsonBlock(null)).toBeNull();
        expect(extractJsonBlock(undefined)).toBeNull();
        expect(extractJsonBlock(42)).toBeNull();
        expect(extractJsonBlock('')).toBeNull();
        expect(extractJsonBlock('This is not JSON')).toBeNull();
        expect(extractJsonBlock('{"unterminated": true')).toBeNull();
    });

    test('returns null rather than a string when only prose exists inside braces', () => {
        // A balanced {...} exists but its content is not valid JSON.
        expect(extractJsonBlock('random {not json at all} text')).toBeNull();
    });

    test('stripCodeFences removes all fence markers', () => {
        expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}');
        expect(stripCodeFences('```\nplain\n```')).toBe('plain');
    });
});
