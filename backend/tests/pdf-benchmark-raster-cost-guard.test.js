'use strict';

jest.mock('pdfjs-dist/legacy/build/pdf.js', () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
        promise: Promise.resolve({
            numPages: 2,
            getPage: async (pageNumber) => pageNumber,
            destroy: async () => {},
        }),
    }),
}));

jest.mock('../court-analysis/extraction/pdfText', () => ({
    ...jest.requireActual('../court-analysis/extraction/pdfText'),
    renderPageToJpeg: async (pageNumber) => Buffer.from(`page-${pageNumber}`),
}));

jest.mock('../scripts/lib/openrouter-client', () => ({
    ...jest.requireActual('../scripts/lib/openrouter-client'),
    requestChat: jest.fn(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');
const { requestChat } = require('../scripts/lib/openrouter-client');
const { makeArmRegistry } = require('../scripts/lib/arms');

function reply(content, cost) {
    return {
        response: { choices: [{ message: { content } }] },
        ...(cost === undefined ? {} : { cost }),
        provider: 'mock-provider',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
}

async function runRaster(responses, recordRequest) {
    const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'raster-cost-')), 'fixture.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4 mock');
    requestChat.mockReset();
    for (const response of responses) requestChat.mockResolvedValueOnce(response);
    try {
        return await makeArmRegistry()['local-raster']('test/model', { filePath }, {
            requestOptions: {},
            recordRequest,
            transcriptionMaxTokens: 100,
        });
    } finally {
        fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
    }
}

test('multipage raster stops before the next request when the cost callback rejects a page', async () => {
    const accounted = [];
    const result = await runRaster([
        reply('First page OCR text', 0.60),
        reply('Second page OCR text', 0.01),
    ], (request) => {
        accounted.push(request.cost);
        return false;
    });

    expect(requestChat).toHaveBeenCalledTimes(1);
    expect(accounted).toEqual([0.60]);
    expect(result.text).toContain('First page OCR text');
    expect(result.text).not.toContain('Second page OCR text');
    expect(result.costIncomplete).toBe(true);
});

test('multipage raster stops immediately when a page has unknown cost', async () => {
    const result = await runRaster([
        reply('First page OCR text'),
        reply('Second page OCR text', 0.01),
    ], (request) => Number.isFinite(request.cost));

    expect(requestChat).toHaveBeenCalledTimes(1);
    expect(result.cost).toBeNull();
    expect(result.costIncomplete).toBe(true);
});
