'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { execute } = require('../scripts/benchmark-pdf-engines');

const response = (status, data) => ({ ok: status === 200, status, text: async () => JSON.stringify(data) });
const sizeRejection = () => response(400, { error: { message: 'Failed to parse the file: The file exceeds the maximum size supported by the file parser.', code: 400, metadata: { provider_name: null } } });

// Exercise the real registry/client/recovery/cost-guard path, not a mock result
// echo: the fake provider inspects real PDF page counts and rejects multi-page uploads.
test.each([
    ['complete', 1, 0.02, 2, 1, 0.07, null],
    ['cap', 0.01, 0.02, 1, 0, 0.02, 'cost-cap'],
    ['final-cap', 0.05, 0.02, 2, 1, 0.07, 'cost-cap'],
    ['unknown', 1, null, 1, 0, 0, 'cost-unknown'],
    ['bounded-analysis-unknown', 1, 0.02, 2, 2, 0.07, 'cost-unknown'],
])('recovery %s accounts each request once and stops between subrequests', async (_name, cap, parseCost, expectedParses, expectedAnalyses, expectedCost, stopReason) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-recovery-integration-'));
    const filePath = path.join(dir, 'source.pdf');
    const pdf = await PDFDocument.create();
    pdf.addPage().drawText('First source page');
    pdf.addPage().drawText('Second source page');
    const original = Buffer.from(await pdf.save({ useObjectStreams: false }));
    fs.writeFileSync(filePath, original);
    let parsedChunks = 0;
    let analyses = 0;
    const apiKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'local-test-only';
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse(init.body);
        const file = Array.isArray(body.messages[0].content) && body.messages[0].content.find(part => part.type === 'file');
        if (file) {
            const bytes = Buffer.from(file.file.file_data.split(',')[1], 'base64');
            const incoming = await PDFDocument.load(bytes);
            if (incoming.getPageCount() > 1) return sizeRejection();
            parsedChunks += 1;
            return response(200, {
                provider: 'mock', usage: parseCost == null ? null : { cost: parseCost, prompt_tokens: 10, completion_tokens: 1 },
                choices: [{ message: { content: 'OK', annotations: [{ type: 'file', file: { content: [{ type: 'text', text: `Source page ${parsedChunks}` + (_name === 'bounded-analysis-unknown' ? 'x'.repeat(9000) : '') }] } }] }, finish_reason: 'stop' }],
            });
        }
        analyses += 1;
        if (_name === 'bounded-analysis-unknown') {
            if (analyses > 1) return response(200, { error: { message: 'Bounded analysis interrupted' } });
        } else {
            expect(body.messages[0].content).toContain('Source page 1');
            expect(body.messages[0].content).toContain('Source page 2');
        }
        return response(200, { provider: 'mock', usage: { cost: 0.03, prompt_tokens: 20, completion_tokens: 5 }, choices: [{ message: { content: '{"caseNumber":"St-2/2013","amounts":[]}' }, finish_reason: 'stop' }] });
    });
    try {
        const report = await execute({
            args: { scope: 'smoke', arms: ['or-cloudflare'], 'max-cost': cap },
            documents: [{ docId: 'source', title: 'Source', filePath, pages: 2, textLayer: true, pageBucket: '1-2' }],
            models: ['x/y'], capabilitiesByModel: { 'x/y': {} }, outputDir: dir, dryRun: false,
        });
        expect(parsedChunks).toBe(expectedParses);
        expect(analyses).toBe(expectedAnalyses);
        expect(report.actualCost).toBeCloseTo(expectedCost);
        expect(report.aborted?.reason ?? null).toBe(stopReason);
        const row = report.rows.find(item => item.arm === 'or-cloudflare');
        const completed = expectedAnalyses > 0 && _name !== 'bounded-analysis-unknown';
        expect(row.parserRecovery.status).toBe(completed ? 'completed' : 'failed');
        expect(row.parserRecovery.chunks).toHaveLength(expectedParses);
        expect(row.failedCall).toBe(!completed);
        expect(row.documentType).toContain(completed ? 'chunked-parser' : 'recovery-failed');
        expect(row.costIncomplete).toBe(['unknown', 'bounded-analysis-unknown'].includes(_name));
        if (_name === 'bounded-analysis-unknown') expect(row.analysisSegmentation.requests).toHaveLength(2);
        expect(report.summary[0].documentType).toBe(row.documentType);
        expect(report.parserMetrics[0].documentType).toBe(row.documentType);
        const artifact = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(name => name.startsWith('analysis-'))), 'utf8'));
        expect(artifact.parserRecovery).toEqual(row.parserRecovery);
        expect(fs.readFileSync(filePath)).toEqual(original);
    } finally {
        fetchMock.mockRestore();
        if (apiKey == null) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = apiKey;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test.each([
    ['auto', 'size-limit'],
    ['auto', 'unknown-cost'],
    ['off', 'size-limit'],
])('bounded page recovery (%s, %s) preserves original pages and partial spend', async (recoveryMode, failure) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-bounded-recovery-'));
    const filePath = path.join(dir, 'source.pdf');
    const pdf = await PDFDocument.create();
    for (let index = 0; index < 3; index++) pdf.addPage([200 + index, 300]).drawText(`Source page ${index + 1}`);
    const original = Buffer.from(await pdf.save());
    fs.writeFileSync(filePath, original);
    const calls = [];
    let rejectedPageCalls = 0;
    const key = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'local-test-only';
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
        const body = JSON.parse(init.body);
        const file = body.messages[0].content.find(part => part.type === 'file');
        const incoming = await PDFDocument.load(Buffer.from(file.file.file_data.split(',')[1], 'base64'));
        expect(incoming.getPageCount()).toBe(1);
        const sourcePage = incoming.getPage(0).getWidth() - 199;
        calls.push(sourcePage);
        if (sourcePage === 2) {
            rejectedPageCalls++;
            if (failure === 'unknown-cost' && rejectedPageCalls > 1) return response(200, { error: { message: 'Recovery transport interrupted' } });
            return sizeRejection();
        }
        return response(200, {
            provider: 'mock', usage: { cost: 0.01 },
            choices: [{ message: {
                content: '{"amounts":[{"amount":1,"currency":"EUR","quote":"Source page 1"}]}',
                annotations: [{ type: 'file', file: { content: [{ type: 'text', text: 'Source page 1' }] } }],
            }, finish_reason: 'stop' }],
        });
    });
    try {
        const report = await execute({
            args: { scope: 'smoke', arms: ['or-mistral-ocr'], 'parser-recovery': recoveryMode, 'max-cost': 1 },
            documents: [{ docId: 'source', title: 'Source', filePath, pages: 3, textLayer: true, tableHeavy: true }],
            models: ['x/y'], capabilitiesByModel: { 'x/y': {} }, outputDir: dir, dryRun: false,
        });
        const row = report.rows.find(item => item.arm === 'or-mistral-ocr');
        expect(calls[0]).toBe(1);
        expect(calls).not.toContain(3);
        expect(row.failedCall).toBe(true);
        expect(row.parsed).toBeNull();
        expect(row.analysisSegmentation.segments.map(segment => segment.status)).toEqual(['completed', 'failed', 'pending']);
        expect(report.actualCost).toBeCloseTo(0.01);
        expect(row.cost).toBeCloseTo(0.01);
        const unknown = failure === 'unknown-cost';
        expect(row.costIncomplete).toBe(unknown);
        expect(report.estimatedParserFee).toBeCloseTo(unknown ? 0.002 : 0);
        expect(report.aborted?.reason ?? null).toBe(unknown ? 'cost-unknown' : null);
        const recovered = row.analysisSegmentation.requests[1].parserRecovery;
        if (recoveryMode === 'auto') {
            expect(rejectedPageCalls).toBeGreaterThan(1);
            expect(recovered.sourcePages).toEqual([2]);
            expect(recovered.rewrittenBytes).toBeGreaterThan(0);
            expect(recovered.requests.filter(request => request.firstPage != null).every(request => request.firstPage === 2 && request.lastPage === 2)).toBe(true);
        } else {
            expect(rejectedPageCalls).toBe(1);
            expect(recovered).toBeNull();
        }
        expect(fs.readFileSync(filePath)).toEqual(original);
    } finally {
        fetchMock.mockRestore();
        if (key == null) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = key;
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
