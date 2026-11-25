const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { extractArchiveFiles, sanitizeEntryName } = require('../court-analysis/acquisition/archiveExtractor');

describe('extractArchiveFiles edge/error cases', () => {
    it('returns error for non-zip file', async () => {
        const result = await extractArchiveFiles({ filePath: __filename, destination: __dirname });
        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/Extraction failed/i);
    });

    it('returns error for missing destination', async () => {
        const result = await extractArchiveFiles({ filePath: __filename, destination: '' });
        expect(result.status).toBe('error');
        expect(result.error_message).toBe('Destination path is required.');
    });

    it('returns error for non-existent archive', async () => {
        const result = await extractArchiveFiles({ filePath: '/tmp/does-not-exist.zip', destination: '/tmp/out' });
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
        expect(sanitizeEntryName('/etc/passwd')).toBeNull();
        expect(sanitizeEntryName('\\\\server\\share\\file.txt')).toBeNull();
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

describe('extractArchiveFiles zip extraction', () => {
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
        const result = await extractArchiveFiles({ filePath: zipPath, destination: outDir });
        expect(result.status).toBe('success');
        const names = result.extractedFiles.map((e) => e.entryName).sort();
        expect(names).toEqual(['another/deep/file.txt', 'deep/nested/file.txt', 'good.txt']);
    });

    it('creates intermediate directories for nested entries', async () => {
        expect(fs.existsSync(path.join(outDir, 'deep', 'nested', 'file.txt'))).toBe(true);
        expect(fs.readFileSync(path.join(outDir, 'deep', 'nested', 'file.txt'), 'utf8')).toBe('nested content');
    });

    it('each extractedFile has filePath and entryName', async () => {
        const result = await extractArchiveFiles({ filePath: zipPath, destination: outDir });
        for (const entry of result.extractedFiles) {
            expect(typeof entry.filePath).toBe('string');
            expect(typeof entry.entryName).toBe('string');
            expect(entry.filePath).toMatch(new RegExp(entry.entryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'));
        }
    });
});

describe('archive extraction isolation and safety', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-hardening-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('extracts 20 same-named documents into distinct paths with parent metadata', async () => {
        const extracted = [];
        for (let index = 0; index < 20; index += 1) {
            const archivePath = path.join(root, `archive-${index}.zip`);
            const destination = path.join(root, 'uploads', 'extracted', `archive-${index}`);
            const payload = Buffer.from(`document-${index}`);
            const zip = new AdmZip();
            zip.addFile('Podnesak.pdf', payload);
            zip.writeZip(archivePath);

            const result = await extractArchiveFiles({
                filePath: archivePath,
                destination,
                sourceEntryIndex: index,
                sourceDocumentLinkId: `case::entry-${index}::doc-1`,
                entryDate: `2025-01-${String(index + 1).padStart(2, '0')}`
            });

            expect(result.status).toBe('success');
            expect(result.extractedFiles).toHaveLength(1);
            const [file] = result.extractedFiles;
            expect(fs.readFileSync(file.filePath)).toEqual(payload);
            expect(file).toEqual(expect.objectContaining({
                sourceEntryIndex: index,
                sourceDocumentLinkId: `case::entry-${index}::doc-1`,
                entryDate: `2025-01-${String(index + 1).padStart(2, '0')}`
            }));
            extracted.push(file.filePath);
        }

        expect(new Set(extracted).size).toBe(20);
    });

    it('jails zip-slip and absolute paths while extracting safe entries', async () => {
        const archivePath = path.join(root, 'zip-slip.zip');
        const destination = path.join(root, 'safe-output');
        const zip = new AdmZip();
        zip.addFile('escape.txt', Buffer.from('outside'));
        zip.getEntry('escape.txt').entryName = '../escape.txt';
        zip.addFile('absolute.txt', Buffer.from('outside'));
        zip.getEntry('absolute.txt').entryName = '/absolute.txt';
        zip.addFile('safe.txt', Buffer.from('inside'));
        zip.writeZip(archivePath);

        const result = await extractArchiveFiles({ filePath: archivePath, destination });

        expect(result.status).toBe('success');
        expect(result.extractedFiles.map((file) => file.entryName)).toEqual(['safe.txt']);
        expect(fs.readFileSync(path.join(destination, 'safe.txt'), 'utf8')).toBe('inside');
        expect(fs.existsSync(path.join(root, 'escape.txt'))).toBe(false);
        expect(fs.existsSync(path.join(root, 'absolute.txt'))).toBe(false);
    });

    it('rejects archives over the uncompressed-byte limit before writing entries', async () => {
        const archivePath = path.join(root, 'large.zip');
        const destination = path.join(root, 'large-output');
        const zip = new AdmZip();
        zip.addFile('large.txt', Buffer.alloc(1024, 'x'));
        zip.writeZip(archivePath);

        const result = await extractArchiveFiles({
            filePath: archivePath,
            destination,
            maxArchiveUncompressedBytes: 100
        });

        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/uncompressed limit/i);
        expect(fs.existsSync(path.join(destination, 'large.txt'))).toBe(false);
    });

    it('rejects archives over the entry-count limit', async () => {
        const archivePath = path.join(root, 'entries.zip');
        const zip = new AdmZip();
        zip.addFile('one.txt', Buffer.from('1'));
        zip.addFile('two.txt', Buffer.from('2'));
        zip.writeZip(archivePath);

        const result = await extractArchiveFiles({
            filePath: archivePath,
            destination: path.join(root, 'entries-output'),
            maxArchiveEntries: 1
        });

        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/entry limit/i);
    });

    it('extracts one nested ZIP level without recursively expanding deeper ZIPs', async () => {
        const deepest = new AdmZip();
        deepest.addFile('leaf.txt', Buffer.from('deep'));
        const nested = new AdmZip();
        nested.addFile('inner.pdf', Buffer.from('nested'));
        nested.addFile('deeper.zip', deepest.toBuffer());
        const outer = new AdmZip();
        outer.addFile('documents.zip', nested.toBuffer());
        outer.addFile('outer.txt', Buffer.from('outer'));
        const archivePath = path.join(root, 'nested.zip');
        const destination = path.join(root, 'nested-output');
        outer.writeZip(archivePath);

        const result = await extractArchiveFiles({ filePath: archivePath, destination });
        const entries = result.extractedFiles.map((file) => file.entryName);

        expect(result.status).toBe('success');
        expect(entries).toEqual(expect.arrayContaining([
            'documents.zip/inner.pdf',
            'documents.zip/deeper.zip',
            'outer.txt'
        ]));
        expect(entries).not.toContain('documents.zip/deeper.zip/leaf.txt');
        expect(fs.readFileSync(path.join(destination, 'documents.zip', 'inner.pdf'), 'utf8')).toBe('nested');
    });

    it('returns per-archive errors for corrupt ZIP data', async () => {
        const archivePath = path.join(root, 'corrupt.zip');
        fs.writeFileSync(archivePath, 'not a zip archive');

        const result = await extractArchiveFiles({
            filePath: archivePath,
            destination: path.join(root, 'corrupt-output')
        });

        expect(result.status).toBe('error');
        expect(result.error_message).toMatch(/extraction failed/i);
    });
});
