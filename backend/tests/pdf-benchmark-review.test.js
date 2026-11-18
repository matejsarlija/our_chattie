'use strict';

const { makeReviewData, buildReviewHtml, selectReviewDocs } = require('../scripts/lib/review');
const { aggregateReviews } = require('../scripts/score-review');

const rows = [
    { docId: 'd1', arm: 'local-text', model: null, repeat: 1, title: 'Case one', documentType: 'table-heavy', text: '1.234,56 EUR ć', metrics: { amounts: { recall: 1 } } },
    { docId: 'd1', arm: 'or-cloudflare', model: null, repeat: 1, title: 'Case one', documentType: 'table-heavy', text: '123,56 EUR c', metrics: { amounts: { recall: 0.5 } } },
    { docId: 'd2', arm: 'local-text', model: null, repeat: 1, title: 'Case two', documentType: 'plain', text: 'text', errors: ['read failed'], metrics: { amounts: { recall: 1 } } },
];

test('selection includes spread and failures with arm-neutral reasons', () => {
    const selected = selectReviewDocs(rows, { seed: 4 });
    expect(selected.map((doc) => doc.docId).sort()).toEqual(['d1', 'd2']);
    expect(selected.flatMap((doc) => doc.selectionReasons).join(' ')).not.toMatch(/local-text|or-cloudflare/);
});

test('review sampling finds Stage A gold-score disagreements', () => {
    const selected = selectReviewDocs([
        { docId: 'd1', arm: 'or-cloudflare', model: 'x/y', repeat: 1, documentType: 'plain', goldAccuracy: { amounts: { recall: 1 } } },
        { docId: 'd1', arm: 'or-mistral-ocr', model: 'x/y', repeat: 1, documentType: 'plain', goldAccuracy: { amounts: { recall: 0.25 } } },
    ], { sample: 0 });
    expect(selected).toHaveLength(1);
    expect(selected[0].selectionReasons).toContain('cross-method variation');
});

test('HTML is blinded while the separate key maps deterministic shuffled labels', () => {
    const selected = selectReviewDocs(rows, { seed: 4 });
    const { viewDocs, answerKey } = makeReviewData(selected, { d1: [{ pageNumber: 1, dataUri: 'data:image/jpeg;base64,AA==' }] }, 8);
    const html = buildReviewHtml(viewDocs);
    expect(html).toContain('Blinded court-analysis review');
    expect(html).toContain('they are navigation aids, not errors.');
    for (const name of ['local-text', 'or-cloudflare']) expect(html).not.toContain(name);
    expect(html).toContain('data:image/jpeg;base64,AA==');
    expect(html).toContain('Contains court-document images');
    expect(answerKey.d1).toBeDefined();
    expect(makeReviewData(selected, {}, 8).answerKey).toEqual(answerKey);
});

test('review aggregation joins blinded labels and reports metric agreement', () => {
    const answerKey = { mappings: { d1: { A: { arm: 'or-cloudflare', repeat: 1 }, B: { arm: 'local-text', repeat: 1 } } } };
    const report = { rows: [
        { docId: 'd1', arm: 'or-cloudflare', repeat: 1, documentType: 'table-heavy', metrics: { amounts: { recall: 0.5 } } },
        { docId: 'd1', arm: 'local-text', repeat: 1, documentType: 'table-heavy', metrics: { amounts: { recall: 1 } } },
    ] };
    const result = aggregateReviews({ verdicts: [
        { docId: 'd1', label: 'A', verdict: 'not usable', errorTypes: ['wrong digit'] },
        { docId: 'd1', label: 'B', verdict: 'usable', errorTypes: [] },
    ] }, answerKey, report);
    expect(result).toHaveLength(2);
    expect(result.find((cell) => cell.arm === 'local-text').agreement).toEqual({ matches: 1, compared: 1 });
    expect(result.find((cell) => cell.arm === 'or-cloudflare').errorTypes).toEqual({ 'wrong digit': 1 });
});

test('review calibration reads Stage A goldAccuracy instead of legacy metrics', () => {
    const answerKey = { mappings: { d1: { A: { arm: 'or-cloudflare', model: 'x/y', repeat: 1 } } } };
    const report = { rows: [{
        docId: 'd1', arm: 'or-cloudflare', model: 'x/y', repeat: 1, documentType: 'plain',
        goldAccuracy: { complete: true, amounts: { recall: 0.5 } },
    }] };
    const result = aggregateReviews({ verdicts: [{ docId: 'd1', label: 'A', verdict: 'not usable', errorTypes: ['wrong digit'] }] }, answerKey, report);
    expect(result[0].agreement).toEqual({ matches: 1, compared: 1 });
    expect(result[0].deterministicAgreement).toBe(1);
});

test('review rows rehydrate their answer text from the per-cell artifacts', () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { reportRowsWithText } = require('../scripts/build-review-sheet');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-review-'));
    try {
        const artifact = (name, body) => fs.writeFileSync(path.join(dir, name), JSON.stringify(body), { mode: 0o600 });
        artifact('analysis-aaaaaaaaaaaaaaaa.json', { docId: 'd1', arm: 'or-cloudflare', model: 'x/y', repeat: 1, text: 'answer one' });
        artifact('analysis-bbbbbbbbbbbbbbbb.json', { docId: 'd1', arm: 'or-mistral-ocr', model: 'x/y', repeat: 1, text: '' });
        fs.writeFileSync(path.join(dir, 'not-an-artifact.json'), '{}');
        const reportPath = path.join(dir, 'report.json');
        const report = {
            rows: [
                { docId: 'd1', arm: 'or-cloudflare', model: 'x/y', repeat: 1 },
                { docId: 'd1', arm: 'or-mistral-ocr', model: 'x/y', repeat: 1 },
                { docId: 'd1', arm: 'or-native', model: 'g/g', repeat: 1 },
                { docId: 'd1', arm: 'local-text', model: 'x/y', repeat: 1, status: 'SKIPPED' },
                { docId: 'd2', arm: 'or-cloudflare', model: 'x/y', repeat: 1, planned: true },
            ],
        };
        const rows = reportRowsWithText(reportPath, report);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ arm: 'or-cloudflare', text: 'answer one' });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
