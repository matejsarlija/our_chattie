'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readParserOutput } = require('../bench/corpus');

const runId = '2026-11-06T09-18-45-676Z-f030de05';
const sample = { docId: '1:Podnesak.pdf', arm: 'or-cloudflare', model: 'z-ai/glm-5.3-flash', repeat: 2 };

test('parser output retrieval returns both parts of the same saved response and its combined cost', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-parser-output-'));
    const runDir = path.join(dataRoot, runId);
    fs.mkdirSync(runDir);
    const hash = crypto.createHash('sha256').update(`${sample.docId}:${sample.arm}:${sample.model}:${sample.repeat}`).digest('hex').slice(0, 16);
    const untrusted = '<img src=x onerror=alert(1)> parser text';
    fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ rows: [{ ...sample, provider: 'mock', cost: 0.0123, estimatedParserFee: 0, costIncomplete: false }] }));
    fs.writeFileSync(path.join(runDir, `analysis-${hash}.json`), JSON.stringify({ ...sample, parserText: untrusted, text: '{"caseNumber":"St-2/2013"}', provider: 'mock', cost: 0.0123 }));
    try {
        expect(readParserOutput(runId, sample, dataRoot)).toEqual({
            parserText: untrusted,
            analysisText: '{"caseNumber":"St-2/2013"}',
            provider: 'mock',
            cost: 0.0123,
            estimatedParserFee: 0,
            costIncomplete: false,
            analysisSegmentation: null,
        });
    } finally {
        fs.rmSync(dataRoot, { recursive: true, force: true });
    }
});

test('parser output retrieval only serves completed parser cells authorized by the run report', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-parser-output-'));
    try {
        expect(() => readParserOutput('../outside', sample, dataRoot)).toThrow(/run ID/i);
        expect(() => readParserOutput(runId, { ...sample, arm: 'or-native' }, dataRoot)).toThrow(/parser arm/i);
        expect(() => readParserOutput(runId, sample, dataRoot)).toThrow(/report not found/i);

        const runDir = path.join(dataRoot, runId);
        fs.mkdirSync(runDir);
        fs.writeFileSync(path.join(runDir, 'report.json'), JSON.stringify({ rows: [{ ...sample, status: 'SKIPPED' }] }));
        expect(() => readParserOutput(runId, sample, dataRoot)).toThrow(/completed parser output/i);
    } finally {
        fs.rmSync(dataRoot, { recursive: true, force: true });
    }
});
