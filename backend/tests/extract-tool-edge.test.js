const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { ExtractArchiveTool, sanitizeEntryName } = require('../court-analysis/agents/extract-tool');

describe('ExtractArchiveTool edge/error cases', () => {
    it('returns error for non-zip file', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: __filename, destination: __dirname });
        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/Extraction failed/i);
    });

    it('returns error for missing destination', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: __filename, destination: '' });
        expect(result.status).toBe('error');
        expect(result.error_message).toBe('Destination path is required.');
    });

    it('returns error for non-existent archive', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: '/tmp/does-not-exist.zip', destination: '/tmp/out' });
        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/not found/i);
    });
});

describe('sanitizeEntryName', () => {
    it('normalizes backslashes', () => {
        expect(sanitizeEntryName('sub\\dir\\file.txt')).toBe('sub/dir/file.txt');
    });

    it('rejects traversal with ..', () => {
        expect(sanitizeEntryName('../etc/passwd')).toBeNull();
        expect(sanitizeEntryName('sub/../../etc/passwd')).toBeNull();
        expect(sanitizeEntryName('a/../b')).toBeNull();
    });

    it('rejects absolute paths with drive letters', () => {
        expect(sanitizeEntryName('C:\\Windows\\System32')).toBeNull();
        expect(sanitizeEntryName('D:/data/file.txt')).toBeNull();
    });

    it('rejects empty and dot-only names', () => {
        expect(sanitizeEntryName('')).toBeNull();
        expect(sanitizeEntryName('.')).toBeNull();
        expect(sanitizeEntryName('./')).toBeNull();
        expect(sanitizeEntryName(' ')).toBeNull();
    });

    it('passes valid relative paths', () => {
        expect(sanitizeEntryName('file.txt')).toBe('file.txt');
        expect(sanitizeEntryName('sub/dir/file.txt')).toBe('sub/dir/file.txt');
    });

    it('handles null/undefined input', () => {
        expect(sanitizeEntryName(null)).toBeNull();
        expect(sanitizeEntryName(undefined)).toBeNull();
    });
});

describe('ExtractArchiveTool zip extraction', () => {
    const outDir = path.resolve(__dirname, 'extract-edge-test');
    const zipPath = path.resolve(__dirname, 'edge-test.zip');

    beforeAll(() => {
        const zip = new AdmZip();
        zip.addFile('good.txt', Buffer.from('safe content'));
        zip.addFile('deep/nested/file.txt', Buffer.from('nested content'));
        zip.addFile('another/deep/file.txt', Buffer.from('another nested'));
        fs.mkdirSync(outDir, { recursive: true });
        zip.writeZip(zipPath);
    });

    afterAll(() => {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        if (fs.existsSync(outDir)) {
            fs.rmSync(outDir, { recursive: true, force: true });
        }
    });

    it('extracts all files with correct entry names', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: zipPath, destination: outDir });
        expect(result.status).toBe('success');
        const names = result.extractedFiles.map((e) => e.entryName).sort();
        expect(names).toEqual(['another/deep/file.txt', 'deep/nested/file.txt', 'good.txt']);
    });

    it('creates intermediate directories for nested entries', async () => {
        expect(fs.existsSync(path.join(outDir, 'deep', 'nested', 'file.txt'))).toBe(true);
        expect(fs.readFileSync(path.join(outDir, 'deep', 'nested', 'file.txt'), 'utf8')).toBe('nested content');
    });

    it('each extractedFile has filePath and entryName', async () => {
        const tool = new ExtractArchiveTool();
        const result = await tool._call({ filePath: zipPath, destination: outDir });
        for (const entry of result.extractedFiles) {
            expect(typeof entry.filePath).toBe('string');
            expect(typeof entry.entryName).toBe('string');
            expect(entry.filePath).toMatch(new RegExp(entry.entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
        }
    });
});
