const os = require('os');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const { DownloadDocumentsTool } = require('../court-analysis/agents/download-agent');

jest.mock('axios');
const axios = require('axios');

describe('downloadDocuments', () => {
    const testUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
    const testLinks = [
        { url: testUrl, text: 'Dummy PDF' }
    ];
    let cacheDir;

    beforeAll(() => {
        cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-cache-test-'));
        process.env.DOWNLOAD_CACHE_DIR = cacheDir;
    });

    beforeEach(() => {
        axios.mockImplementation(() => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end('PDFDATA'));
            return Promise.resolve({ data: stream, headers: { 'content-type': 'application/pdf' } });
        });
    });

    afterAll(() => {
        delete process.env.DOWNLOAD_CACHE_DIR;
        if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true });
        // Clean up downloaded files
        const uploadsDir = path.resolve(__dirname, '../uploads');
        if (fs.existsSync(uploadsDir)) {
            fs.readdirSync(uploadsDir)
                .map(file => path.join(uploadsDir, file))
                .filter(entry => { try { return fs.statSync(entry).isFile(); } catch { return false; } })
                .forEach(filePath => fs.unlinkSync(filePath));
        }
    });

    it('downloads files and returns file info', async () => {
        const progressUpdates = [];
        const tool = new DownloadDocumentsTool();
        const files = await tool._call({ documentLinks: testLinks, progressCallback: (progress) => progressUpdates.push(progress) });
        expect(files.length).toBe(1);
        expect(fs.existsSync(files[0].filePath)).toBe(true);
        expect(files[0].url).toBe(testUrl);
        expect(progressUpdates.some(p => p.message.includes('Downloaded'))).toBe(true);
    });

    it('reports per-link completion counters in progress callbacks', async () => {
        const progressUpdates = [];
        const tool = new DownloadDocumentsTool();
        const links = [
            { url: testUrl, text: 'First PDF' },
            { url: testUrl, text: 'Second PDF' },
        ];
        await tool._call({ documentLinks: links, progressCallback: (progress) => progressUpdates.push(progress) });
        const perLink = progressUpdates.filter((p) => Number.isFinite(p.completed));
        expect(perLink).toHaveLength(2);
        expect(perLink[0]).toEqual(expect.objectContaining({ completed: 1, total: 2 }));
        expect(perLink[1]).toEqual(expect.objectContaining({ completed: 2, total: 2 }));
    });

    it('threads explicit document provenance through to downloaded files', async () => {
        const tool = new DownloadDocumentsTool();
        const files = await tool._call({
            documentLinks: [{ url: testUrl, text: 'Dummy PDF', id: 'St-1/2024::entry-2::doc-1', entryIndex: 2 }],
        });
        expect(files).toHaveLength(1);
        expect(files[0]).toEqual(expect.objectContaining({
            url: testUrl,
            sourceDocumentLinkId: 'St-1/2024::entry-2::doc-1',
            sourceEntryIndex: 2,
        }));
    });
});
