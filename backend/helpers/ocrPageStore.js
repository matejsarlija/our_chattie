// Disk-backed L2 behind the in-memory OCR page LRU. Pages already paid for
// survive backend restarts, so repeat analyses over unchanged documents do
// not re-spend vision quota.
//
// Layout: <root>/<version>/<sha256(fileBytes)>-p<pageNumber>.json
// Invariants: cache version includes the OCR prompt and model; cache failures
// never break an in-flight OCR run.

const fs = require('fs');
const path = require('path');

const { resolveRoleConfig } = require('../llm/openrouterConfig');
const OCR_MODEL = resolveRoleConfig('ocr').model;

// Bump when OCR prompt text or the batch marker contract changes.
const OCR_PROMPT_VERSION = 2;

function versionSegment() {
    const model = String(OCR_MODEL).replace(/[^a-zA-Z0-9._-]/g, '_');
    return `v${OCR_PROMPT_VERSION}-${model}`;
}

function resolveStoreRoot() {
    if (process.env.OCR_CACHE_DIR) {
        return path.resolve(process.env.OCR_CACHE_DIR);
    }
    return path.resolve(__dirname, '../data/ocr-cache');
}

function pageFilePath(contentHash, pageNumber) {
    return path.join(
        resolveStoreRoot(),
        versionSegment(),
        `${contentHash}-p${pageNumber}.json`,
    );
}


/**
 * Returns the cached page text, or null on miss / corruption. Mirrors the
 * memory tier exactly: any stored string (empty included) is a hit.
 */
function readOcrPageFromDisk(contentHash, pageNumber) {
    try {
        const parsed = JSON.parse(fs.readFileSync(pageFilePath(contentHash, pageNumber), 'utf8'));
        return typeof parsed?.text === 'string' ? parsed.text : null;
    } catch (err) {
        return null;
    }
}

/**
 * Persists a page result. Fire-and-forget safe: errors are logged and
 * swallowed, never propagated into the OCR flow.
 */
function writeOcrPageToDisk(contentHash, pageNumber, text) {
    if (typeof text !== 'string') return;
    try {
        const filePath = pageFilePath(contentHash, pageNumber);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify({ text }));
        fs.renameSync(tmpPath, filePath);
    } catch (err) {
        // Cache writes must never break an in-flight OCR run.
    }
}


module.exports = {
    OCR_PROMPT_VERSION,
    versionSegment,
    resolveStoreRoot,
    pageFilePath,
    readOcrPageFromDisk,
    writeOcrPageToDisk,
};
