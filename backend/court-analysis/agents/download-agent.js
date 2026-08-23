// agents/download-agent.js

const { Tool } = require('@langchain/core/tools');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mime = require("mime-types");
const agentLog = require("../../helpers/agentLog");
const { getDownloadCache } = require("../../helpers/downloadCache");

// agents/download-agent.js -> inside the downloadFile function

/**
 * Downloads `url`, serving repeat requests from the persistent download cache
 * (`helpers/downloadCache.js`). Returns `{ filePath, fromCache }` where
 * `filePath` is always a disposable working copy inside uploadsDir — never a
 * cache blob — so pipeline cleanup can delete it freely.
 */
async function downloadFile(url, baseFilename, fallbackLinkText) {
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const cache = getDownloadCache();

    // e-Oglasna attachment URLs are stable GUID links serving immutable
    // published documents, so a cached copy is reused verbatim.
    let cached = null;
    try {
        cached = cache.get(url);
    } catch (err) {
        agentLog.warn('[Downloader] Cache read failed, falling back to network:', err.message);
    }
    if (cached) {
        const extension = cached.meta.ext || '.bin';
        const filePath = path.join(uploadsDir, `${baseFilename}${extension}`);
        cache.materialize(cached.blobPath, filePath);
        agentLog.log(`[Downloader] Cache HIT ${cached.key.slice(0, 8)} -> ${path.basename(filePath)}`);
        return { filePath, fromCache: true };
    }

    // Cache miss: stream straight into a cache staging file, then commit.
    const pending = cache.beginWrite(url);
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            timeout: 60000,
            // Conditional validators are stored when present, but e-Oglasna
            // serves neither ETag nor Last-Modified, so reuse is unconditional.
            headers: {},
        });

        const headers = response.headers || {};
        let serverFilename = null;
        let extension = '';

        // --- Start Debug Logging ---
        agentLog.log('[Downloader] Response Headers:', {
            'content-type': headers['content-type'],
            'content-disposition': headers['content-disposition'],
        });
        // --- End Debug Logging ---

        // 1. BEST CASE: Use the filename from the Content-Disposition header.
        // This is the most reliable source.
        const contentDisposition = headers['content-disposition'];
        if (contentDisposition) {
            // This regex looks for filename="some.pdf" or filename*=UTF-8''some.pdf
            const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/);
            if (filenameMatch && filenameMatch[1]) {
                try {
                    // Decode the filename if it's URL-encoded
                    serverFilename = decodeURIComponent(filenameMatch[1].replace(/"/g, ''));
                } catch (err) {
                    // Malformed percent-encoding must not fail an otherwise
                    // valid download; fall back to the raw value.
                    serverFilename = filenameMatch[1].replace(/"/g, '');
                }
                const serverExt = path.extname(serverFilename);
                if (serverExt) {
                    extension = serverExt;
                    agentLog.log(`[Downloader] Found extension '${extension}' from Content-Disposition.`);
                }
            }
        }

        // 2. GOOD FALLBACK: If no extension from Content-Disposition, try Content-Type.
        if (!extension) {
            const contentType = headers['content-type'];
            const mimeExt = mime.extension(contentType);
            if (mimeExt && mimeExt !== 'bin') { // Ignore generic 'bin' from octet-stream
                extension = `.${mimeExt}`;
                agentLog.log(`[Downloader] Found extension '${extension}' from Content-Type: ${contentType}.`);
            }
        }

        // 3. LAST RESORT: If STILL no extension, use our link text fallback.
        if (!extension) {
            agentLog.log('[Downloader] No specific extension found in headers. Using link text fallback.');
            if (fallbackLinkText && fallbackLinkText.toLowerCase().includes('zip')) {
                extension = '.zip';
            } else {
                // This is our ultimate fallback. A file MUST have an extension.
                extension = '.bin'; // a generic binary file
            }
            agentLog.log(`[Downloader] Using fallback extension: '${extension}'`);
        }

        const finalFilename = `${baseFilename}${extension}`;
        const filePath = path.join(uploadsDir, finalFilename);

        await new Promise((resolve, reject) => {
            const fail = (err) => reject(err);
            response.data.pipe(pending.writeStream);
            pending.writeStream.on('finish', resolve);
            pending.writeStream.on('error', fail);
            response.data.on('error', fail);
        });

        const blobPath = pending.commit({
            ext: extension,
            originalName: serverFilename || path.basename(filePath),
            contentType: headers['content-type'] || null,
            etag: headers.etag || null,
            lastModified: headers['last-modified'] || null,
        });
        cache.materialize(blobPath, filePath);

        agentLog.log(`[Downloader] Successfully saved file: ${filePath}`);
        return { filePath, fromCache: false };
    } catch (err) {
        pending.abort();
        throw err;
    }
}


class DownloadDocumentsTool extends Tool {
    constructor() {
        super();
        this.name = 'download_documents';
        this.description = 'Download documents from URLs and return file paths.';
    }

    async _call(input) {
        const { documentLinks, progressCallback } = input;
        const downloaded = [];
        let completed = 0;
        let cacheHits = 0;

        for (const link of documentLinks) {
            try {
                const safeName = (link.text || 'document').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
                const baseFilename = `${Date.now()}_${safeName}`;
                const { filePath, fromCache } = await downloadFile(link.url, baseFilename, link.text);
                downloaded.push({ filePath, url: link.url, text: link.text, fromCache });
                if (fromCache) cacheHits++;
                completed++;
                const currentProgress = 50 + Math.round((completed / documentLinks.length) * 30);
                const message = fromCache
                    ? `Reused from cache: ${path.basename(filePath)}`
                    : `Downloaded: ${path.basename(filePath)}`;
                progressCallback && progressCallback({ step: 'downloading', progress: currentProgress, message });
            } catch (err) {
                agentLog.error(`[Downloader] Failed to download ${link.text} from ${link.url}:`, err.message);
                completed++;
                const currentProgress = 50 + Math.round((completed / documentLinks.length) * 30);
                progressCallback && progressCallback({ step: 'downloading', progress: currentProgress, message: `Failed: ${link.text}` });
            }
        }

        if (documentLinks.length > 0) {
            agentLog.log(`[Downloader] Download cache: ${cacheHits}/${documentLinks.length} served without network.`);
        }
        progressCallback && progressCallback({ step: 'downloading', progress: 80, message: 'All downloads attempted.' });
        return downloaded;
    }
}

module.exports = { DownloadDocumentsTool };
