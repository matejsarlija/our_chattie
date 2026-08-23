const fs = require('fs');
const os = require('os');
const path = require('path');

describe('ocrPageStore', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-page-store-'));
        process.env.OCR_CACHE_DIR = root;
    });

    afterEach(() => {
        delete process.env.OCR_CACHE_DIR;
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('round-trips page text', () => {
        const store = require('../helpers/ocrPageStore');
        store.writeOcrPageToDisk('abc123', 2, 'page two body');

        expect(store.readOcrPageFromDisk('abc123', 2)).toBe('page two body');
        expect(store.readOcrPageFromDisk('abc123', 1)).toBeNull();
        expect(store.readOcrPageFromDisk('other-doc', 2)).toBeNull();
    });

    it('mirrors memory-tier semantics by caching empty strings as hits', () => {
        const store = require('../helpers/ocrPageStore');
        store.writeOcrPageToDisk('abc123', 1, '');

        expect(store.readOcrPageFromDisk('abc123', 1)).toBe('');
    });

    it('refuses non-string payloads', () => {
        const store = require('../helpers/ocrPageStore');
        store.writeOcrPageToDisk('abc123', 1, null);
        store.writeOcrPageToDisk('abc123', 1, undefined);
        store.writeOcrPageToDisk('abc123', 1, { text: 'nope' });

        expect(fs.readdirSync(root)).toHaveLength(0);
    });

    it('treats corrupt or mistyped files as misses', () => {
        const store = require('../helpers/ocrPageStore');
        store.writeOcrPageToDisk('abc123', 1, 'good text');
        const pageFile = store.pageFilePath('abc123', 1);
        fs.writeFileSync(pageFile, '{corrupt');
        expect(store.readOcrPageFromDisk('abc123', 1)).toBeNull();

        fs.writeFileSync(pageFile, JSON.stringify({ text: 42 }));
        expect(store.readOcrPageFromDisk('abc123', 1)).toBeNull();
    });

    it('namespaces entries by prompt-version and model so upgrades invalidate cleanly', () => {
        let store;
        try {
            process.env.GEMINI_MODEL = 'gemini-test-swap';
            jest.resetModules();
            store = require('../helpers/ocrPageStore');
            store.writeOcrPageToDisk('abc123', 1, 'old model text');
            expect(store.versionSegment()).toContain('gemini-test-swap');
        } finally {
            delete process.env.GEMINI_MODEL;
            jest.resetModules();
            store = require('../helpers/ocrPageStore');
        }

        // Default-model reader must not see the other model's pages...
        expect(store.versionSegment()).not.toContain('gemini-test-swap');
        expect(store.readOcrPageFromDisk('abc123', 1)).toBeNull();
        // ...and the old entry must still be on disk under its own namespace.
        expect(fs.existsSync(path.join(root, store.versionSegment(), '..', 'v1-gemini-test-swap', 'abc123-p1.json'))).toBe(true);
    });
});
