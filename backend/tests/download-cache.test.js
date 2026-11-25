const os = require('os');
const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');

jest.mock('axios');
const axios = require('axios');

const { downloadClusterAttachments } = require('../court-analysis/acquisition/downloader');
const { DownloadCache, getDownloadCache, resolveCacheRoot, cacheKeyFor } = require('../court-analysis/acquisition/downloadCache');

describe('DownloadCache store', () => {
    let root;

    // Mirrors the production contract: commit only after the write stream
    // reports 'finish'.
    function writeAndCommit(pending, body, meta) {
        return new Promise((resolve, reject) => {
            pending.writeStream.on('finish', () => {
                try { resolve(pending.commit(meta)); } catch (err) { reject(err); }
            });
            pending.writeStream.on('error', reject);
            pending.writeStream.end(body);
        });
    }

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-cache-store-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('defaults the cache to backend/uploads/.dl-cache when DOWNLOAD_CACHE_DIR is unset', () => {
        const previousCacheDir = process.env.DOWNLOAD_CACHE_DIR;
        delete process.env.DOWNLOAD_CACHE_DIR;
        try {
            expect(resolveCacheRoot()).toBe(path.resolve(__dirname, '../uploads/.dl-cache'));
        } finally {
            if (previousCacheDir === undefined) delete process.env.DOWNLOAD_CACHE_DIR;
            else process.env.DOWNLOAD_CACHE_DIR = previousCacheDir;
        }
    });

    it('round-trips a committed download with metadata', async () => {
        const cache = new DownloadCache(root);
        await writeAndCommit(cache.beginWrite('https://example.com/doc.pdf'), 'PDFBYTES', { ext: '.pdf', originalName: 'Podnesak.pdf' });

        const hit = cache.get('https://example.com/doc.pdf');
        expect(hit).not.toBeNull();
        expect(hit.key).toBe(cacheKeyFor('https://example.com/doc.pdf'));
        expect(hit.meta.ext).toBe('.pdf');
        expect(hit.meta.originalName).toBe('Podnesak.pdf');
        expect(hit.meta.size).toBe(8);
        expect(fs.readFileSync(hit.blobPath, 'utf8')).toBe('PDFBYTES');
    });

    it('returns null for unknown URLs', () => {
        const cache = new DownloadCache(root);
        expect(cache.get('https://example.com/missing.pdf')).toBeNull();
    });

    it('self-heals when the index is corrupt', async () => {
        const cache = new DownloadCache(root);
        await writeAndCommit(cache.beginWrite('https://example.com/a.zip'), 'ZIP', { ext: '.zip', originalName: 'a.zip' });
        fs.writeFileSync(path.join(root, 'index.json'), '{not json');

        expect(cache.get('https://example.com/a.zip')).toBeNull();

        // A later successful write must rebuild a valid index.
        await writeAndCommit(cache.beginWrite('https://example.com/b.bin'), 'B', { ext: '.bin', originalName: 'b' });
        expect(Object.keys(new DownloadCache(root)._readIndex())).toHaveLength(1);
    });

    it('self-heals when the indexed blob is missing or resized', async () => {
        const cache = new DownloadCache(root);
        let blobPath = await writeAndCommit(cache.beginWrite('https://example.com/gone.pdf'), 'GONE', { ext: '.pdf', originalName: 'gone.pdf' });
        fs.unlinkSync(blobPath);
        expect(cache.get('https://example.com/gone.pdf')).toBeNull();

        blobPath = await writeAndCommit(cache.beginWrite('https://example.com/trunc.pdf'), 'TRUNCATED', { ext: '.pdf', originalName: 'trunc.pdf' });
        fs.writeFileSync(blobPath, 'TRUNC'); // size drift without index update
        expect(cache.get('https://example.com/trunc.pdf')).toBeNull();
    });

    it('abort removes the staged temp file and leaves the entry missing', async () => {
        const cache = new DownloadCache(root);
        const pending = cache.beginWrite('https://example.com/fail.pdf');
        await new Promise(resolve => pending.writeStream.end('PARTIAL', resolve));
        pending.abort();

        const leftovers = fs.readdirSync(path.join(root, 'blobs')).filter(f => f.includes('.tmp-'));
        expect(leftovers).toHaveLength(0);
        expect(cache.get('https://example.com/fail.pdf')).toBeNull();
    });

    it('rejects double commits', async () => {
        const cache = new DownloadCache(root);
        const pending = cache.beginWrite('https://example.com/twice.pdf');
        await writeAndCommit(pending, 'X', { ext: '.pdf', originalName: 'twice.pdf' });
        expect(() => pending.commit({})).toThrow(/settled/);
    });

    it('materialize creates disposable links and survives target deletion', async () => {
        const cache = new DownloadCache(root);
        const blobPath = await writeAndCommit(cache.beginWrite('https://example.com/link.pdf'), 'LINKED', { ext: '.pdf', originalName: 'link.pdf' });

        const workA = path.join(root, 'work-a.pdf');
        cache.materialize(blobPath, workA);
        expect(fs.readFileSync(workA, 'utf8')).toBe('LINKED');

        // Pipeline-style cleanup of the working copy must not evict the blob.
        fs.unlinkSync(workA);
        expect(cache.get('https://example.com/link.pdf')).not.toBeNull();

        // Re-materializing over an existing target retries via EEXIST.
        fs.writeFileSync(workA, 'stale');
        cache.materialize(blobPath, workA);
        expect(fs.readFileSync(workA, 'utf8')).toBe('LINKED');
    });
});

describe('downloadClusterAttachments download memoization', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-cache-tool-'));
        process.env.DOWNLOAD_CACHE_DIR = root;
        axios.mockReset();
    });

    afterEach(() => {
        delete process.env.DOWNLOAD_CACHE_DIR;
        fs.rmSync(root, { recursive: true, force: true });
    });

    function mockPdfResponse(body = 'PDFDATA', headers = {}) {
        return () => {
            const stream = new PassThrough();
            process.nextTick(() => stream.end(body));
            return Promise.resolve({
                data: stream,
                headers: { 'content-type': 'application/pdf', ...headers },
            });
        };
    }

    it('downloads once on repeat runs and serves the rest from cache', async () => {
        axios.mockImplementation(mockPdfResponse());
        const links = [{ url: 'https://e-oglasna.pravosudje.hr/objave/dokument/abc/preuzimanje', text: 'Podnesak' }];

        const first = await downloadClusterAttachments({ documentLinks: links, progressCallback: null });
        expect(first).toHaveLength(1);
        expect(first[0].fromCache).toBe(false);
        expect(fs.readFileSync(first[0].filePath)).toEqual(Buffer.from('PDFDATA'));

        const second = await downloadClusterAttachments({ documentLinks: links, progressCallback: null });
        expect(second).toHaveLength(1);
        expect(second[0].fromCache).toBe(true);
        expect(fs.readFileSync(second[0].filePath)).toEqual(Buffer.from('PDFDATA'));
        // Exactly one network call across both runs.
        expect(axios.mock.calls).toHaveLength(1);

        // Simulating pipeline cleanup between runs must not evict the entry.
        fs.unlinkSync(first[0].filePath);
        fs.unlinkSync(second[0].filePath);
        const third = await downloadClusterAttachments({ documentLinks: links, progressCallback: null });
        expect(third[0].fromCache).toBe(true);
        expect(fs.existsSync(third[0].filePath)).toBe(true);
        expect(axios.mock.calls).toHaveLength(1);
    });

    it('preserves the Croatian server filename in cache metadata', async () => {
        axios.mockImplementation(mockPdfResponse('CRO', {
            'content-disposition': `attachment; name="Podnesak.pdf"; filename*=UTF-8''Rje%C5%A1enje_o_du%C5%BEniku.pdf`,
        }));
        const [result] = await downloadClusterAttachments({
            documentLinks: [{ url: 'https://e-oglasna.pravosudje.hr/objave/dokument/cro/preuzimanje', text: 'Dokument' }],
            progressCallback: null,
        });

        expect(result.fromCache).toBe(false);
        expect(result.filePath.endsWith('.pdf')).toBe(true);

        const cache = getDownloadCache();
        const hit = cache.get('https://e-oglasna.pravosudje.hr/objave/dokument/cro/preuzimanje');
        expect(hit.meta.originalName).toBe('Rješenje_o_dužniku.pdf');
        expect(hit.meta.contentType).toBe('application/pdf');
    });

    it('retries transient HTTP failures before committing a complete response', async () => {
        let attempts = 0;
        axios.mockImplementation(() => {
            attempts += 1;
            if (attempts < 3) {
                return Promise.reject(Object.assign(new Error('temporary response'), {
                    response: { status: attempts === 1 ? 429 : 503 }
                }));
            }
            return mockPdfResponse('RETRIED')();
        });
        const [result] = await downloadClusterAttachments({
            documentLinks: [{ url: 'https://e-oglasna.pravosudje.hr/objave/dokument/retry/preuzimanje', text: 'Retry' }]
        });

        expect(attempts).toBe(3);
        expect(fs.readFileSync(result.filePath, 'utf8')).toBe('RETRIED');
        fs.unlinkSync(result.filePath);
    });

    it('creates distinct intact working files for 30 identical cache hits', async () => {
        axios.mockImplementation(mockPdfResponse('SHARED'));
        const url = 'https://e-oglasna.pravosudje.hr/objave/dokument/shared/preuzimanje';
        const [warm] = await downloadClusterAttachments({ documentLinks: [{ url, text: 'Podnesak.pdf' }] });
        const files = await downloadClusterAttachments({
            documentLinks: Array.from({ length: 30 }, () => ({ url, text: 'Podnesak.pdf' }))
        });

        expect(files).toHaveLength(30);
        expect(new Set(files.map((file) => file.filePath)).size).toBe(30);
        expect(files.every((file) => file.fromCache)).toBe(true);
        for (const file of files) {
            expect(fs.readFileSync(file.filePath)).toEqual(Buffer.from('SHARED'));
            fs.unlinkSync(file.filePath);
        }
        fs.unlinkSync(warm.filePath);
        expect(axios.mock.calls).toHaveLength(1);
    });

    it('cleans an aborted mid-stream cache write while other links succeed', async () => {
        const failedUrl = 'https://e-oglasna.pravosudje.hr/objave/dokument/aborted/preuzimanje';
        const healthyUrl = 'https://e-oglasna.pravosudje.hr/objave/dokument/healthy/preuzimanje';
        axios.mockImplementation(({ url }) => {
            if (url === failedUrl) {
                const stream = new PassThrough();
                process.nextTick(() => {
                    stream.write('PARTIAL');
                    stream.destroy(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
                });
                return Promise.resolve({ data: stream, headers: {} });
            }
            return mockPdfResponse('GOOD')();
        });

        const files = await downloadClusterAttachments({
            documentLinks: [
                { url: failedUrl, text: 'Interrupted' },
                { url: healthyUrl, text: 'Healthy' }
            ]
        });

        expect(files).toHaveLength(1);
        expect(files[0].url).toBe(healthyUrl);
        expect(fs.readFileSync(files[0].filePath, 'utf8')).toBe('GOOD');
        expect(getDownloadCache().get(failedUrl)).toBeNull();
        expect(axios.mock.calls.filter(([request]) => request.url === failedUrl)).toHaveLength(4);
        const temporaryFiles = [
            ...fs.readdirSync(root),
            ...fs.readdirSync(path.join(root, 'blobs'))
        ].filter((name) => name.includes('.tmp-'));
        expect(temporaryFiles).toHaveLength(0);
        fs.unlinkSync(files[0].filePath);
    });
});
