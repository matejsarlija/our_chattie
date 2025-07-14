const { DownloadDocumentsTool } = require('../court-analysis/agents/download-agent');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
jest.mock('axios');
const axios = require('axios');

describe('DownloadDocumentsTool edge/error cases', () => {
    beforeEach(() => {
        axios.mockImplementation(({ url }) => {
            if (url === 'http://invalid.url') {
                return Promise.reject(new Error('Network error'));
            }
            const stream = new PassThrough();
            process.nextTick(() => stream.end('PDFDATA'));
            return Promise.resolve({ data: stream });
        });
    });

    it('returns empty for empty input', async () => {
        const tool = new DownloadDocumentsTool();
        const result = await tool._call({ documentLinks: [] });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(0);
    });

    it('handles invalid URLs gracefully', async () => {
        const tool = new DownloadDocumentsTool();
        const files = await tool._call({ documentLinks: [{ url: 'http://invalid.url', text: 'bad' }] });
        expect(Array.isArray(files)).toBe(true);
        // Should not throw, but may not download
        expect(files[0]?.filePath).toBeUndefined();
    });

    afterAll(() => {
        // Clean up any files
        const uploadsDir = path.resolve(__dirname, '../uploads');
        if (fs.existsSync(uploadsDir)) {
            fs.readdirSync(uploadsDir).forEach(file => {
                fs.unlinkSync(path.join(uploadsDir, file));
            });
        }
    });
});
