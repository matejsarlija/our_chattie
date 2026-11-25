const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const {
    Worker,
    isMainThread,
    parentPort,
    workerData
} = require('node:worker_threads');

const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10000;

function sanitizeEntryName(entryName) {
    const normalized = String(entryName || '').replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return null;
    const segments = normalized.split('/').filter((segment) =>
        segment !== '' && segment !== '.' && segment.trim() !== ''
    );
    if (segments.length === 0 || segments.some((segment) => segment === '..')) return null;
    return segments.join('/');
}

function jailedPath(root, relativeName) {
    const resolvedRoot = path.resolve(root);
    const targetPath = path.resolve(resolvedRoot, ...relativeName.split('/'));
    return targetPath.startsWith(`${resolvedRoot}${path.sep}`) ? targetPath : null;
}

function extractZipEntries(zip, destination, state, prefix = '', nestingLevel = 0) {
    const entries = zip.getEntries();
    if (state.entryCount + entries.length > state.maxEntries) {
        throw new Error(`Archive exceeds the ${state.maxEntries}-entry limit`);
    }
    state.entryCount += entries.length;

    for (const entry of entries) {
        const entryBytes = Number(entry.header?.size);
        if (!Number.isSafeInteger(entryBytes) || entryBytes < 0) {
            throw new Error(`Invalid uncompressed size for archive entry ${entry.entryName}`);
        }
        state.uncompressedBytes += entryBytes;
        if (state.uncompressedBytes > state.maxUncompressedBytes) {
            throw new Error(`Archive exceeds the ${state.maxUncompressedBytes}-byte uncompressed limit`);
        }

        const safeName = sanitizeEntryName(entry.entryName);
        if (safeName === null) continue;
        const entryName = prefix ? `${prefix}/${safeName}` : safeName;
        const targetPath = jailedPath(destination, entryName);
        if (!targetPath) continue;

        if (entry.isDirectory) {
            fs.mkdirSync(targetPath, { recursive: true });
            continue;
        }

        if (nestingLevel === 0 && path.extname(safeName).toLowerCase() === '.zip') {
            const nestedArchive = new AdmZip(entry.getData());
            fs.mkdirSync(targetPath, { recursive: true });
            extractZipEntries(nestedArchive, destination, state, entryName, 1);
            continue;
        }

        const content = entry.getData();
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, content);
        state.extractedFiles.push({ filePath: targetPath, entryName });
    }
}

function extractInWorker({ filePath, destination, maxUncompressedBytes, maxEntries }) {
    const state = {
        maxUncompressedBytes,
        maxEntries,
        uncompressedBytes: 0,
        entryCount: 0,
        extractedFiles: []
    };
    fs.mkdirSync(destination, { recursive: true });
    extractZipEntries(new AdmZip(filePath), destination, state);
    return { status: 'success', extractedFiles: state.extractedFiles };
}

if (!isMainThread) {
    try {
        parentPort.postMessage(extractInWorker(workerData));
    } catch (error) {
        parentPort.postMessage({ status: 'error', error_message: `Extraction failed: ${error.message}` });
    }
} else {
    async function extractArchiveFiles(input = {}) {
        const { filePath, destination } = input;
        if (!filePath || !fs.existsSync(filePath)) {
            return { status: 'error', error_message: `Archive file not found: ${filePath}` };
        }
        if (!destination) {
            return { status: 'error', error_message: 'Destination path is required.' };
        }
        const maxUncompressedBytes = Number.isSafeInteger(input.maxArchiveUncompressedBytes)
            && input.maxArchiveUncompressedBytes >= 0
            ? input.maxArchiveUncompressedBytes
            : MAX_ARCHIVE_UNCOMPRESSED_BYTES;
        const maxEntries = Number.isSafeInteger(input.maxArchiveEntries) && input.maxArchiveEntries >= 0
            ? input.maxArchiveEntries
            : MAX_ARCHIVE_ENTRIES;

        let worker;
        try {
            fs.mkdirSync(destination, { recursive: true });
            worker = new Worker(__filename, {
                workerData: { filePath, destination, maxUncompressedBytes, maxEntries }
            });
            const result = await new Promise((resolve, reject) => {
                let settled = false;
                worker.once('message', (message) => {
                    settled = true;
                    resolve(message);
                });
                worker.once('error', (error) => {
                    settled = true;
                    reject(error);
                });
                worker.once('exit', (code) => {
                    if (!settled) reject(new Error(`Archive worker exited with code ${code} before returning a result`));
                });
            });
            if (result.status !== 'success') return result;
            return {
                ...result,
                extractedFiles: result.extractedFiles.map((file) => ({
                    ...file,
                    sourceEntryIndex: input.sourceEntryIndex ?? null,
                    sourceDocumentLinkId: input.sourceDocumentLinkId ?? null,
                    entryDate: input.entryDate ?? null
                }))
            };
        } catch (error) {
            return { status: 'error', error_message: `Extraction failed: ${error.message}` };
        } finally {
            if (worker) {
                try {
                    await worker.terminate();
                } catch {
                    // The worker may already have exited after posting its result.
                }
            }
        }
    }

    module.exports = {
        extractArchiveFiles,
        sanitizeEntryName,
        MAX_ARCHIVE_UNCOMPRESSED_BYTES,
        MAX_ARCHIVE_ENTRIES
    };
}
