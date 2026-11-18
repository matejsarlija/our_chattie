'use strict';

const { family, parseJudgeResponse, calibrate, summarizeTriage } = require('../scripts/judge-review');
const { hasConfirmedImageCapability } = require('../scripts/judge-review');

test('judge response is constrained to pairwise triage choices and separate model families', () => {
    expect(family('z-ai/glm-5.3-flash')).toBe('glm');
    expect(family('openai/gpt-4.1-mini')).toBe('gpt');
    expect(parseJudgeResponse('{"preferred":"A","reason":"table order"}').preferred).toBe('A');
    expect(parseJudgeResponse('{"preferred":"winner"}').preferred).toBeNull();
});

test('calibration compares human verdicts without affecting benchmark rows', () => {
    const result = calibrate({ pairs: [
        { docId: 'd1', position: 'AB', leftArm: 'local-text', rightArm: 'or-cloudflare', result: { preferred: 'A' } },
        { docId: 'd1', position: 'BA', leftArm: 'local-text', rightArm: 'or-cloudflare', result: { preferred: 'A' } },
    ] }, { verdicts: [
        { docId: 'd1', label: 'A', verdict: 'usable' },
        { docId: 'd1', label: 'B', verdict: 'not usable' },
    ] }, { mappings: { d1: { A: { arm: 'local-text' }, B: { arm: 'or-cloudflare' } } } });
    expect(result).toMatchObject({ matches: 1, compared: 1, agreement: 1 });
});

test('calibration keeps same-arm candidates from different models apart', () => {
    const result = calibrate({ pairs: [
        { docId: 'd1', position: 'AB', leftArm: 'local-raster', leftModel: 'a/one', rightArm: 'local-raster', rightModel: 'b/two', result: { preferred: 'B' } },
    ] }, { verdicts: [
        { docId: 'd1', label: 'A', verdict: 'not usable' },
        { docId: 'd1', label: 'B', verdict: 'usable' },
    ] }, { mappings: { d1: {
        A: { arm: 'local-raster', model: 'a/one' },
        B: { arm: 'local-raster', model: 'b/two' },
    } } });
    expect(result).toMatchObject({ matches: 1, compared: 1, agreement: 1 });
});

test('judge candidates rehydrate current Stage A analysis answers from per-cell artifacts', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
        const { loadJudgeRows } = require('../scripts/judge-review');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-judge-parser-'));
    const write = (name, body) => fs.writeFileSync(path.join(dir, name), JSON.stringify(body));
    try {
        write('analysis-aaaaaaaaaaaaaaaa.json', { docId: 'd1', arm: 'or-cloudflare', model: 'x/y', repeat: 1, text: 'Cloudflare answer' });
        write('analysis-bbbbbbbbbbbbbbbb.json', { docId: 'd1', arm: 'or-mistral-ocr', model: 'x/y', repeat: 1, text: 'Mistral answer' });
        write('analysis-cccccccccccccccc.json', { docId: 'd1', arm: 'or-native', model: 'g/g', repeat: 1, text: 'Native Gemini answer' });
        const report = { rows: [
            { docId: 'd1', arm: 'or-cloudflare', model: 'x/y', repeat: 1, stage: 'A' },
            { docId: 'd1', arm: 'or-mistral-ocr', model: 'x/y', repeat: 1, stage: 'A' },
            { docId: 'd1', arm: 'or-native', model: 'g/g', repeat: 1, stage: 'A' },
            { docId: 'd2', arm: 'or-cloudflare', model: 'x/y', repeat: 1, stage: 'T' },
        ] };
        expect(loadJudgeRows(path.join(dir, 'report.json'), report).map((row) => [row.arm, row.text])).toEqual([
            ['or-cloudflare', 'Cloudflare answer'],
            ['or-mistral-ocr', 'Mistral answer'],
            ['or-native', 'Native Gemini answer'],
        ]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('judge requires probed or manually confirmed image support', () => {
    expect(hasConfirmedImageCapability({ imageInput: true, sources: { imageInput: 'probe' } })).toBe(true);
    expect(hasConfirmedImageCapability({ imageInput: true, sources: { imageInput: 'manual' } })).toBe(true);
    expect(hasConfirmedImageCapability({ imageInput: true, sources: { imageInput: 'metadata-hint' } })).toBe(false);
    expect(hasConfirmedImageCapability({ imageInput: null, sources: { imageInput: 'unknown' } })).toBe(false);
});
test('triage tallies distinguish the same parser arm across different models', () => {
    expect(summarizeTriage([{ leftArm: 'or-cloudflare', leftModel: 'a/one', rightArm: 'or-cloudflare', rightModel: 'b/two', result: { preferred: 'A' } }])).toEqual({
        'or-cloudflare|a/one': { wins: 1, losses: 0, ties: 0, errors: 0 },
        'or-cloudflare|b/two': { wins: 0, losses: 1, ties: 0, errors: 0 },
    });
});
