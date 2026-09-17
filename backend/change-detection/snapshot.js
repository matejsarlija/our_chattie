// change-detection/snapshot.js
//
// Reduces parsed e-Oglasna CSV export rows (header-keyed objects from
// `scraper/csvExportParser.parseCsvExport`) into a `ChangeSnapshot`: a complete
// map of every publication for a query, keyed by the stable `Oglas (link)`
// GUID URL. Snapshots are the unit of comparison for change detection — see
// eoglasna_export_change_detection_spec.md §5.1/§7.
//
// Identity rules:
// - `id` (the queryId) is a stable sha1 over `type` + NORMALIZED `value`, so
//   differently formatted but equivalent queries ("66124057408" vs
//   "6612 4057 408", "St-2/2013" vs "st-2 / 2013") collapse to one identity and
//   history stays replayable.
// - `snapshotId` is a stable sha1 over the snapshot CONTENT (entries +
//   debtorOibs + rowCount, canonicalized). Two captures of an unchanged export
//   produce the same snapshotId, so archived history dedupes naturally and
//   `diff.fromSnapshotId`/`toSnapshotId` references stay meaningful.

const crypto = require('crypto');
const { normalizeCaseNumber } = require('../court-analysis/utils/caseNumber');
const { parseDocumentFiles } = require('../court-analysis/utils/csvFieldMapping');

function sha1Hex(text) {
    return crypto.createHash('sha1').update(text, 'utf8').digest('hex');
}

/**
 * Normalizes a query value so equivalent spellings share one queryId.
 * - oib: digits only ("6612 4057-408" === "66124057408").
 * - case_number / text: trimmed, lowercased, internal whitespace collapsed.
 */
function normalizeQueryValue(type, value) {
    const raw = String(value == null ? '' : value).trim();
    if (String(type).toLowerCase() === 'oib') {
        return raw.replace(/\D+/g, '');
    }
    return raw.toLowerCase().replace(/\s+/g, ' ');
}

/** Stable queryId: sha1("<type>:<normalizedValue>"). */
function queryIdFor(query) {
    const type = String((query && query.type) || '').trim().toLowerCase();
    const value = normalizeQueryValue(type, query && query.value);
    return sha1Hex(`${type}:${value}`);
}

/** Canonical JSON with sorted object keys (arrays keep their order). */
function canonicalize(value) {
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = canonicalize(value[key]);
        }
        return out;
    }
    return value;
}

/**
 * Stable content hash for a snapshot. Excludes capture-time metadata
 * (`capturedAt`, `sourceUrl`) so re-capturing an unchanged export yields the
 * same snapshotId (idempotent history).
 */
function snapshotIdFor(snapshot) {
    return sha1Hex(JSON.stringify(canonicalize({
        rowCount: snapshot.rowCount,
        debtorOibs: [...snapshot.debtorOibs].sort(),
        entries: snapshot.entries
    })));
}

function reduceEntry(row) {
    return {
        caseNumber: normalizeCaseNumber(String(row['Oznaka spisa'] || '').trim())
            || String(row['Oznaka spisa'] || '').trim(),
        title: String(row['Naslov'] || '').trim(),
        date: String(row['Početni dan objave'] || '').trim(),
        // Empty cell === still published; stored as null so diffs treat '' and
        // missing identically.
        publicationEnd: String(row['Posljednji dan objave'] || '').trim() || null,
        // Raw tokens WITH page-count suffixes ("Podnesak.pdf P75P") — a
        // page-count change is itself a modification signal.
        documentFiles: parseDocumentFiles(row['Dokumenti (datoteke)']).documentFiles,
        debtorOib: String(row['OIB stečajnog dužnika'] || '').trim()
    };
}

/**
 * Reduces parsed CSV rows into a persisted-shape ChangeSnapshot.
 *
 * @param {Array<object>} rows - Header-keyed rows from `parseCsvExport`.
 * @param {{ type: string, value: string }} query
 * @param {{ sourceUrl: string, capturedAt?: string }} meta
 * @returns {{ id: string, snapshotId: string, query: object, capturedAt: string,
 *             sourceUrl: string, rowCount: number, debtorOibs: string[], entries: object }}
 */
function buildSnapshot(rows, query, meta) {
    const source = Array.isArray(rows) ? rows : [];
    const options = meta && typeof meta === 'object' ? meta : {};

    const entries = {};
    const debtorOibSet = new Set();

    for (const row of source) {
        const guid = String(row['Oglas (link)'] || '').trim();
        const entry = reduceEntry(row);
        if (entry.debtorOib) {
            debtorOibSet.add(entry.debtorOib);
        }
        if (!guid) {
            // A row without its stable GUID cannot be diffed; it still counts
            // toward rowCount so completeness checks stay honest.
            continue;
        }
        entries[guid] = entry;
    }

    const snapshot = {
        id: queryIdFor(query),
        query: {
            type: String((query && query.type) || '').trim().toLowerCase(),
            value: String((query && query.value) || '').trim()
        },
        capturedAt: options.capturedAt || new Date().toISOString(),
        sourceUrl: String(options.sourceUrl || ''),
        rowCount: source.length,
        debtorOibs: [...debtorOibSet].sort(),
        entries
    };
    snapshot.snapshotId = snapshotIdFor(snapshot);

    return snapshot;
}

module.exports = {
    buildSnapshot,
    queryIdFor,
    snapshotIdFor,
    normalizeQueryValue,
    reduceEntry
};
