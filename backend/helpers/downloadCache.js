// helpers/downloadCache.js
//
// Persistent, URL-keyed memoization for downloaded court documents.
//
// Layout:
//   <root>/index.json     # { "<sha256(url)>": { url, ext, originalName, size, fetchedAt, ... } }
//   <root>/blobs/<key>    # raw response bytes
//
// Design invariants (do not regress):
// - Returned working files are HARDLINKS into the run's uploads dir; the cache
//   blob itself is never handed to callers, so pipeline `cleanupFiles` can
//   delete the working copy freely without evicting the cache entry.
// - All writes are staged to a `.tmp-*` file and atomically renamed, so a crash
//   or concurrent run can never leave a truncated blob behind an index entry.
// - Cache failures must never fail a download: callers wrap lookups in
//   try/catch and fall through to the network path.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

class DownloadCache {
    constructor(rootDir) {
        this.rootDir = rootDir;
        this.blobsDir = path.join(rootDir, 'blobs');
        this.indexPath = path.join(rootDir, 'index.json');
    }

    _ensureDirs() {
        fs.mkdirSync(this.blobsDir, { recursive: true });
    }

    blobPathFor(key) {
        return path.join(this.blobsDir, key);
    }

    _readIndex() {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            return {};
        }
    }

    _writeIndex(index) {
        this._ensureDirs();
        const tmpPath = `${this.indexPath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2));
        fs.renameSync(tmpPath, this.indexPath);
    }

    /**
     * Returns `{ key, blobPath, meta }` for a previously committed download,
     * or null on miss / self-healable corruption (missing or resized blob,
     * unreadable index).
     */
    get(url) {
        const key = sha256Hex(url);
        const meta = this._readIndex()[key];
        if (!meta) return null;

        const blobPath = this.blobPathFor(key);
        try {
            const stat = fs.statSync(blobPath);
            if (!stat.isFile()) return null;
            if (typeof meta.size === 'number' && stat.size !== meta.size) return null;
        } catch (err) {
            return null;
        }

        return { key, blobPath, meta };
    }

    /**
     * Stages a fresh download. Pipe the response into `writeStream`, await its
     * 'finish', then `commit(meta)`; on any failure call `abort()`.
     */
    beginWrite(url) {
        this._ensureDirs();
        const key = sha256Hex(url);
        const tmpPath = `${this.blobPathFor(key)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const writeStream = fs.createWriteStream(tmpPath);
        // Errors are surfaced to callers via their own listeners / promise
        // rejection; without this no-op the stream's late 'error' events
        // (e.g. ENOENT after abort removed the staged file) would crash the
        // process as unhandled.
        writeStream.on('error', () => {});
        let settled = false;

        return {
            key,
            writeStream,
            tmpPath,
            commit: (meta = {}) => {
                if (settled) throw new Error('DownloadCache write already settled');
                settled = true;

                const blobPath = this.blobPathFor(key);
                const size = fs.statSync(tmpPath).size;
                fs.renameSync(tmpPath, blobPath);

                const index = this._readIndex();
                index[key] = {
                    url,
                    size,
                    fetchedAt: new Date().toISOString(),
                    ...meta,
                };
                this._writeIndex(index);
                return blobPath;
            },
            abort: () => {
                if (settled) return;
                settled = true;
                try {
                    fs.unlinkSync(tmpPath);
                } catch (err) {
                    // Best effort: a missing tmp file is exactly what we want.
                }
                writeStream.destroy();
            },
        };
    }

    /**
     * Exposes a cache blob at `targetPath` as a disposable hardlink (copy as
     * fallback for filesystems where linking is unavailable). Never deletes or
     * mutates the blob itself.
     */
    materialize(blobPath, targetPath) {
        try {
            fs.linkSync(blobPath, targetPath);
        } catch (err) {
            if (err.code === 'EEXIST') {
                fs.unlinkSync(targetPath);
                fs.linkSync(blobPath, targetPath);
            } else {
                fs.copyFileSync(blobPath, targetPath);
            }
        }
        return targetPath;
    }
}

function resolveCacheRoot() {
    if (process.env.DOWNLOAD_CACHE_DIR) {
        return path.resolve(process.env.DOWNLOAD_CACHE_DIR);
    }
    return path.resolve(__dirname, '../uploads/.dl-cache');
}

let activeInstance = null;
let activeRoot = null;

function getDownloadCache() {
    const root = resolveCacheRoot();
    if (!activeInstance || activeRoot !== root) {
        activeRoot = root;
        activeInstance = new DownloadCache(root);
    }
    return activeInstance;
}

module.exports = {
    DownloadCache,
    getDownloadCache,
    cacheKeyFor: sha256Hex,
};
