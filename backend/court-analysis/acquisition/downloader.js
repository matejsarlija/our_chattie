// court-analysis/acquisition/downloader.js
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const mime = require('mime-types');
const { pipeline } = require('stream/promises');
const logger = require('../../services/logger');
const { getDownloadCache } = require('./downloadCache');

const DOWNLOAD_CONCURRENCY = 5;
const MAX_DOWNLOAD_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 100;
const RETRY_MAX_DELAY_MS = 2000;
const RETRYABLE_CODES = new Set([
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ERR_NETWORK'
]);

function getAbortError(signal) {
    if (signal?.reason instanceof Error) return signal.reason;
    return Object.assign(new Error('Download aborted'), { name: 'AbortError', code: 'ERR_CANCELED' });
}

function isRetryableDownloadError(error) {
    const status = error?.response?.status;
    if (status === 429 || (status >= 500 && status <= 599)) return true;
    const code = error?.code || error?.cause?.code;
    if (RETRYABLE_CODES.has(code)) return true;
    return /socket hang up|connection reset|aborted/i.test(error?.message || '');
}

function waitBeforeRetry(attempt, signal) {
    const ceiling = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** attempt));
    const delayMs = ceiling + Math.random() * ceiling;
    return new Promise((resolve, reject) => {
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, delayMs);
        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(getAbortError(signal));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function resolveExtension(headers, fallbackLinkText) {
    const contentDisposition = headers['content-disposition'];
    if (contentDisposition) {
        const match = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/);
        if (match?.[1]) {
            let serverFilename;
            try {
                serverFilename = decodeURIComponent(match[1].replace(/"/g, ''));
            } catch {
                serverFilename = match[1].replace(/"/g, '');
            }
            const extension = path.extname(serverFilename);
            if (extension) return { extension, serverFilename };
        }
    }

    const mimeExtension = mime.extension(headers['content-type']);
    if (mimeExtension && mimeExtension !== 'bin') {
        return { extension: `.${mimeExtension}`, serverFilename: null };
    }
    return {
        extension: fallbackLinkText?.toLowerCase().includes('zip') ? '.zip' : '.bin',
        serverFilename: null
    };
}

/**
 * Downloads one URL into the persistent cache, returning a disposable working
 * copy in uploads so pipeline cleanup never removes the cache blob.
 */
async function downloadFile(url, baseFilename, fallbackLinkText, signal) {
    const uploadsDir = path.resolve(__dirname, '../../uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    if (signal?.aborted) throw getAbortError(signal);

    const cache = getDownloadCache();
    try {
        const cached = cache.get(url);
        if (cached) {
            const filePath = path.join(uploadsDir, `${baseFilename}${cached.meta.ext || '.bin'}`);
            cache.materialize(cached.blobPath, filePath);
            logger.agent.log(`[Downloader] Cache HIT ${cached.key.slice(0, 8)} -> ${path.basename(filePath)}`);
            return { filePath, fromCache: true };
        }
    } catch (error) {
        logger.agent.warn('[Downloader] Cache read failed, falling back to network:', error.message);
    }

    for (let attempt = 0; attempt < MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) throw getAbortError(signal);
        const pending = cache.beginWrite(url);
        let committed = false;
        try {
            const response = await axios({
                url,
                method: 'GET',
                responseType: 'stream',
                timeout: 60000,
                headers: {},
                signal
            });
            const headers = response.headers || {};
            const { extension, serverFilename } = resolveExtension(headers, fallbackLinkText);

            await pipeline(response.data, pending.writeStream, { signal });
            const bytes = fs.statSync(pending.tmpPath).size;
            if (bytes <= 0) {
                throw Object.assign(new Error('Downloaded document was empty'), { code: 'EMPTY_DOWNLOAD' });
            }

            const blobPath = pending.commit({
                ext: extension,
                originalName: serverFilename || `${baseFilename}${extension}`,
                contentType: headers['content-type'] || null,
                etag: headers.etag || null,
                lastModified: headers['last-modified'] || null
            });
            committed = true;
            const filePath = path.join(uploadsDir, `${baseFilename}${extension}`);
            cache.materialize(blobPath, filePath);
            logger.agent.log(`[Downloader] Successfully saved file: ${filePath}`);
            return { filePath, fromCache: false };
        } catch (error) {
            pending.abort();
            if (attempt + 1 >= MAX_DOWNLOAD_ATTEMPTS || signal?.aborted || !isRetryableDownloadError(error)) {
                throw signal?.aborted ? getAbortError(signal) : error;
            }
            const retryNumber = attempt + 1;
            logger.agent.warn(`[Downloader] Retry ${retryNumber}/${MAX_DOWNLOAD_ATTEMPTS - 1} for ${url}:`, error.message);
            await waitBeforeRetry(attempt, signal);
        } finally {
            if (!committed) pending.abort();
        }
    }

    throw new Error(`Download attempts exhausted for ${url}`);
}

async function downloadClusterAttachments({ documentLinks = [], progressCallback, signal } = {}) {
    const links = Array.isArray(documentLinks) ? documentLinks : [];
    const downloaded = new Array(links.length);
    let nextIndex = 0;
    let completed = 0;
    let cacheHits = 0;

    const emitProgress = (message, failed = false) => {
        if (!progressCallback) return;
        try {
            progressCallback({
                step: 'downloading',
                progress: 50 + Math.round((completed / links.length) * 30),
                message,
                completed,
                total: links.length,
                ...(failed ? { failed: true } : {})
            });
        } catch (error) {
            logger.agent.warn('[Downloader] Progress callback failed:', error.message);
        }
    };

    async function worker() {
        while (nextIndex < links.length && !signal?.aborted) {
            const index = nextIndex;
            nextIndex += 1;
            const link = links[index] || {};
            let progressMessage = `Failed: ${link.text || link.url}`;
            let failed = true;
            try {
                const safeName = (link.text || 'document').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 40);
                const baseFilename = `${Date.now()}_${index}_${crypto.randomUUID().slice(0, 8)}_${safeName}`;
                const { filePath, fromCache } = await downloadFile(link.url, baseFilename, link.text, signal);
                downloaded[index] = {
                    filePath,
                    url: link.url,
                    text: link.text,
                    fromCache,
                    sourceDocumentLinkId: link.id ?? link.documentLinkId ?? null,
                    sourceEntryIndex: link.entryIndex ?? link.sourceEntryIndex ?? null
                };
                if (fromCache) cacheHits += 1;
                progressMessage = `${fromCache ? 'Reused from cache' : 'Downloaded'}: ${path.basename(filePath)}`;
                failed = false;
            } catch (error) {
                logger.agent.error(`[Downloader] Failed to download ${link.text} from ${link.url}:`, error.message);
            } finally {
                completed += 1;
                emitProgress(progressMessage, failed);
            }
        }
    }

    await Promise.all(Array.from(
        { length: Math.min(DOWNLOAD_CONCURRENCY, links.length) },
        () => worker()
    ));

    if (links.length > 0) {
        logger.agent.log(`[Downloader] Download cache: ${cacheHits}/${links.length} served without network.`);
    }
    progressCallback?.({
        step: 'downloading',
        progress: links.length === 0 ? 80 : 50 + Math.round((completed / links.length) * 30),
        message: signal?.aborted ? 'Downloads cancelled.' : 'All downloads attempted.'
    });
    return downloaded.filter(Boolean);
}

module.exports = { downloadClusterAttachments };

