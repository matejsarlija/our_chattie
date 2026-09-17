// change-detection/store.js
//
// JSON-file persistence for change detection, mirroring the localStore /
// download-cache / OCR-cache patterns:
// - Latest snapshot per query: `<base>/snapshots/<queryId>.json`.
// - Archived snapshots:        `<base>/history/<queryId>/<snapshotId>.json`
//   (content-addressed, so re-capturing an unchanged export does not duplicate
//   history entries).
// - Diff records:              `<base>/history/<queryId>/diffs.jsonl`
//   (append-only).
//
// Never-fail philosophy (spec §4.5): a store error is reported through the
// returned result objects and the log, NEVER thrown at the check path — a
// persistence problem must not turn into a bogus "everything changed" or crash
// a run.

const fs = require('fs');
const path = require('path');
const logger = require('../helpers/logger');

const DEFAULT_BASE_DIR = path.join(__dirname, '..', 'data', 'change-detection');
const SCOPE = 'change-detection-store';

function resolveBaseDir(override) {
    return override || process.env.CHANGE_DETECTION_DATA_DIR || DEFAULT_BASE_DIR;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

/** Writes atomically: stage as .tmp-* then rename over the target. */
function writeJsonAtomic(filePath, value) {
    ensureDir(path.dirname(filePath));
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePath);
}

function createChangeDetectionStore(options = {}) {
    const baseDir = resolveBaseDir(options.dataDir);

    const snapshotsDir = path.join(baseDir, 'snapshots');
    const historyDir = path.join(baseDir, 'history');

    function snapshotFile(queryId) {
        return path.join(snapshotsDir, `${queryId}.json`);
    }

    function queryHistoryDir(queryId) {
        return path.join(historyDir, queryId);
    }

    function diffsFile(queryId) {
        return path.join(queryHistoryDir(queryId), 'diffs.jsonl');
    }

    function reportFailure(operation, err) {
        logger.warn(SCOPE, `${operation} failed: ${err.message}`, { baseDir });
        return { ok: false, error: err.message };
    }

    /**
     * Loads the latest stored snapshot for a query. Returns null cleanly when
     * none exists (or when the stored file is unreadable/corrupt — treated as
     * "no prior state", which yields a baseline diff on the next check).
     */
    function getLatestSnapshot(queryId) {
        try {
            const raw = fs.readFileSync(snapshotFile(queryId), 'utf8');
            return JSON.parse(raw);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                reportFailure(`Read snapshot ${queryId}`, err);
            }
            return null;
        }
    }

    /**
     * Persists the new latest snapshot and archives it under history.
     * Archiving is idempotent: an already-archived snapshotId is left alone.
     */
    function saveSnapshot(snapshot) {
        try {
            writeJsonAtomic(snapshotFile(snapshot.id), snapshot);

            let archived = false;
            const archivePath = path.join(queryHistoryDir(snapshot.id), `${snapshot.snapshotId}.json`);
            if (!fs.existsSync(archivePath)) {
                writeJsonAtomic(archivePath, snapshot);
                archived = true;
            }
            return { ok: true, archived };
        } catch (err) {
            return reportFailure(`Save snapshot ${snapshot.id}`, err);
        }
    }

    /** Appends one diff record as a single JSONL line. */
    function appendDiff(queryId, diff) {
        try {
            ensureDir(queryHistoryDir(queryId));
            fs.appendFileSync(diffsFile(queryId), `${JSON.stringify(diff)}\n`, 'utf8');
            return { ok: true };
        } catch (err) {
            return reportFailure(`Append diff ${queryId}`, err);
        }
    }

    /**
     * Persists both halves of a check (snapshot + diff). Convenience wrapper
     * that keeps the store's failure reporting in one place.
     */
    function recordCheck(snapshot, diff) {
        const saved = saveSnapshot(snapshot);
        const appended = appendDiff(snapshot.id, diff);
        return { save: saved, append: appended, ok: saved.ok && appended.ok };
    }

    function readDiffs(queryId) {
        const diffs = [];
        let raw;
        try {
            raw = fs.readFileSync(diffsFile(queryId), 'utf8');
        } catch (err) {
            if (err.code !== 'ENOENT') {
                reportFailure(`Read diffs ${queryId}`, err);
            }
            return diffs;
        }
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
                diffs.push(JSON.parse(trimmed));
            } catch (err) {
                // A torn/corrupt line must not hide the rest of the history.
                reportFailure(`Parse diff line ${queryId}`, err);
            }
        }
        return diffs;
    }

    function listArchivedSnapshots(queryId) {
        try {
            return fs.readdirSync(queryHistoryDir(queryId))
                .filter((name) => name.endsWith('.json'))
                .sort()
                .map((name) => ({ snapshotId: name.replace(/\.json$/, '') }));
        } catch (err) {
            if (err.code !== 'ENOENT') {
                reportFailure(`List history ${queryId}`, err);
            }
            return [];
        }
    }

    /** Full audit trail for one query (REST GET history). */
    function getHistory(queryId) {
        return {
            queryId,
            snapshots: listArchivedSnapshots(queryId),
            diffs: readDiffs(queryId)
        };
    }

    return {
        baseDir,
        getLatestSnapshot,
        saveSnapshot,
        appendDiff,
        recordCheck,
        getHistory
    };
}

module.exports = {
    createChangeDetectionStore,
    resolveBaseDir,
    DEFAULT_BASE_DIR
};
