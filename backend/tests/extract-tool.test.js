const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ExtractArchiveTool } = require('../court-analysis/agents/extract-tool');

describe('ExtractArchiveTool', () => {
    const testZipPath = path.resolve(__dirname, 'test-archive.zip');
    const extractDir = path.resolve(__dirname, 'extracted');

    beforeAll(() => {
        const zip = new AdmZip();
        zip.addFile('file1.txt', Buffer.from('Hello World 1'));
        zip.addFile('file2.txt', Buffer.from('Hello World 2'));
        zip.addFile('subdir/nested.txt', Buffer.from('Nested content'));
        zip.addFile('subdir/', Buffer.from(''));
        zip.writeZip(testZipPath);
        fs.mkdirSync(extractDir, { recursive: true });
    });

    afterAll(() => {
        if (fs.existsSync(testZipPath)) fs.unlinkSync(testZipPath);
        if (fs.existsSync(extractDir)) {
            fs.rmSync(extractDir, { recursive: true, force: true });
        }
    });

    it('extracts a zip archive and returns file list with correct shape', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: testZipPath, destination: extractDir });
        expect(result.status).toBe('success');
        expect(Array.isArray(result.extractedFiles)).toBe(true);
        expect(result.extractedFiles.length).toBe(3);
        for (const entry of result.extractedFiles) {
            expect(entry).toHaveProperty('filePath');
            expect(entry).toHaveProperty('entryName');
            expect(typeof entry.filePath).toBe('string');
            expect(typeof entry.entryName).toBe('string');
        }
    });

    it('creates physical files at extracted paths', async () => {
        expect(fs.existsSync(path.join(extractDir, 'file1.txt'))).toBe(true);
        expect(fs.existsSync(path.join(extractDir, 'file2.txt'))).toBe(true);
        expect(fs.existsSync(path.join(extractDir, 'subdir', 'nested.txt'))).toBe(true);
        expect(fs.readFileSync(path.join(extractDir, 'file1.txt'), 'utf8')).toBe('Hello World 1');
        expect(fs.readFileSync(path.join(extractDir, 'subdir', 'nested.txt'), 'utf8')).toBe('Nested content');
    });

    it('skips directory entries', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: testZipPath, destination: extractDir });
        const names = result.extractedFiles.map((e) => e.entryName);
        expect(names).not.toContain('subdir/');
    });

    it('returns error for non-existent file', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: 'nonexistent.zip', destination: extractDir });
        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/not found/i);
    });

    it('auto-creates destination directory', async () => {
        const newDir = path.resolve(__dirname, 'extract-new-dir');
        if (fs.existsSync(newDir)) fs.rmSync(newDir, { recursive: true, force: true });
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: testZipPath, destination: newDir });
        expect(result.status).toBe('success');
        expect(fs.existsSync(newDir)).toBe(true);
        fs.rmSync(newDir, { recursive: true, force: true });
    });
});
