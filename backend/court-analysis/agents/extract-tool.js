const { Tool } = require('@langchain/core/tools');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

/**
 * Normalizes a ZIP entry name into a safe relative path, or returns `null` when
 * the entry must be skipped (path traversal, absolute paths, drive letters).
 * Backslashes are normalized to forward slashes; `.`/empty segments are dropped.
 * @param {string} entryName
 * @returns {string|null}
 */
function sanitizeEntryName(entryName) {
    const normalized = String(entryName || '').replace(/\\/g, '/');
    const segments = normalized
        .split('/')
        .filter((segment) => segment !== '' && segment !== '.' && segment.trim() !== '');
    if (segments.length === 0) return null;
    if (segments.some((segment) => segment === '..')) return null;
    if (segments.some((segment) => /^[a-zA-Z]:$/.test(segment))) return null;
    return segments.join('/');
}

class ExtractArchiveTool extends Tool {
    constructor() {
        super();
        this.name = 'extract_archive';
        this.description = 'Extracts ZIP archives to a destination folder.';
    }
    /**
     * @param {{filePath: string, destination: string}} input
     * @returns {Promise<{status: string, extractedFiles?: Array<{filePath: string, entryName: string}>, error_message?: string}>}
     */
    async _call(input) {
        const { filePath, destination } = input;
        try {
            if (!fs.existsSync(filePath)) {
                return { status: 'error', error_message: `Archive file not found: ${filePath}` };
            }
            if (!destination) {
                return { status: 'error', error_message: 'Destination path is required.' };
            }
            if (!fs.existsSync(destination)) {
                fs.mkdirSync(destination, { recursive: true });
            }
            const zip = new AdmZip(filePath);
            const extractedFiles = [];
            for (const entry of zip.getEntries()) {
                if (entry.isDirectory) continue;
                const safeName = sanitizeEntryName(entry.entryName);
                if (safeName === null) continue;
                const targetPath = path.join(destination, safeName);
                fs.mkdirSync(path.dirname(targetPath), { recursive: true });
                const content = entry.getData();
                if (!content) continue;
                fs.writeFileSync(targetPath, content);
                extractedFiles.push({ filePath: targetPath, entryName: safeName });
            }
            return { status: 'success', extractedFiles };
        } catch (err) {
            return { status: 'error', error_message: `Extraction failed: ${err.message}` };
        }
    }
}

module.exports = { ExtractArchiveTool, sanitizeEntryName };
