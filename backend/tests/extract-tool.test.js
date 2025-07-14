const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ExtractArchiveTool } = require('../court-analysis/agents/extract-tool');

describe('ExtractArchiveTool', () => {
    const testZipPath = path.resolve(__dirname, 'test-archive.zip');
    const extractDir = path.resolve(__dirname, 'extracted');

    beforeAll(() => {
        // Create a test zip file
        const zip = new AdmZip();
        zip.addFile('file1.txt', Buffer.from('Hello World 1'));
        zip.addFile('file2.txt', Buffer.from('Hello World 2'));
        zip.writeZip(testZipPath);
        if (!fs.existsSync(extractDir)) fs.mkdirSync(extractDir);
    });

    afterAll(() => {
        if (fs.existsSync(testZipPath)) fs.unlinkSync(testZipPath);
        if (fs.existsSync(extractDir)) {
            fs.readdirSync(extractDir).forEach(f => fs.unlinkSync(path.join(extractDir, f)));
            fs.rmdirSync(extractDir);
        }
    });

    it('extracts a zip archive and returns file list', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: testZipPath, destination: extractDir });
        expect(result.status).toBe('success');
        expect(Array.isArray(result.extractedFiles)).toBe(true);
        expect(result.extractedFiles.length).toBe(2);
        expect(fs.existsSync(path.join(extractDir, 'file1.txt'))).toBe(true);
        expect(fs.existsSync(path.join(extractDir, 'file2.txt'))).toBe(true);
    });

    it('returns error for non-existent file', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: 'nonexistent.zip', destination: extractDir });
        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/not found/i);
    });
});
