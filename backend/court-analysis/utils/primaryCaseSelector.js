// court-analysis/utils/primaryCaseSelector.js
//
// Shared deterministic primary-case selector (spec §3 / ticket T0-1).
//
// Used by the CSV discovery path (bounded acquisition) and by the pipeline
// (reasoning target) AFTER debtor-OIB and document filtering, so both stages
// agree on the same normalized case key. This must never become a scraper-only
// proxy: any divergence between "what was acquired" and "what is reasoned over"
// silently reintroduces the global-tail misfire (balanced tail belonging to
// side-cases that analysis then discards).
//
// Grouping keys reuse `normalizeCaseNumber`, so register-prefix-distinct cases
// (`4 ST-2/2013` vs `ST-2/2013`) stay distinct here exactly as in `grouping.js`.
// Entries without a usable key are counted as unkeyed and can never be selected.
//
// Tie-break order (shared, fixture-tested — do not reorder without updating
// `primaryCaseSelector.test.js` and the spec):
//   1. exact normalized `case_number` query match,
//   2. most document-carrying entries,
//   3. most recent dated entry (undated groups lose),
//   4. lexical normalized case key (final deterministic fallback).

const { normalizeCaseNumber } = require('./caseNumber');
const { parseCaseDateToTimestamp } = require('./caseDate');

function entryCaseKey(entry) {
    const raw = entry?.caseNumber || entry?.caseInfo?.caseNumber || null;
    return normalizeCaseNumber(raw);
}

function entryHasDocuments(entry) {
    const link = entry?.caseInfo?.documentDownloadLink;
    if (typeof link === 'string' && link.trim()) return true;
    return Array.isArray(entry?.documentLinks) && entry.documentLinks.length > 0;
}

function entryTimestamp(entry) {
    const raw = entry?.caseInfo?.date
        || entry?.caseInfo?.datePublished
        || entry?.date
        || null;
    return parseCaseDateToTimestamp(raw);
}

function rankCandidates(candidates) {
    return [...candidates].sort((a, b) => {
        if (b.documentCount !== a.documentCount) return b.documentCount - a.documentCount;
        if (b.newestTimestamp !== a.newestTimestamp) {
            if (b.newestTimestamp === null) return -1;
            if (a.newestTimestamp === null) return 1;
            return b.newestTimestamp - a.newestTimestamp;
        }
        if (a.key < b.key) return -1;
        if (a.key > b.key) return 1;
        return 0;
    });
}

/**
 * Selects the primary case key over discovery entries.
 *
 * @param {Array<object>} entries - Filtered pipeline entries (newest-first assumed, not required).
 * @param {object|null} query - Pipeline query `{ type: 'oib' | 'case_number' | 'text', value }`.
 * @returns {{ selectedCaseKey: string|null, method: string, candidates: Array, unkeyedEntries: number }}
 *   method is one of `case-number-query | document-coverage | none`.
 */
function selectPrimaryCase(entries, query = null) {
    const list = Array.isArray(entries) ? entries : [];
    const byKey = new Map();
    let unkeyedEntries = 0;

    for (const entry of list) {
        const key = entryCaseKey(entry);
        if (!key) {
            unkeyedEntries += 1;
            continue;
        }
        if (!byKey.has(key)) {
            byKey.set(key, { key, entries: [], documentCount: 0, newestTimestamp: null });
        }
        const group = byKey.get(key);
        group.entries.push(entry);
        if (entryHasDocuments(entry)) group.documentCount += 1;
        const ts = entryTimestamp(entry);
        if (ts !== null && (group.newestTimestamp === null || ts > group.newestTimestamp)) {
            group.newestTimestamp = ts;
        }
    }

    const candidates = [...byKey.values()].map((group) => ({
        key: group.key,
        entryCount: group.entries.length,
        documentCount: group.documentCount,
        newestTimestamp: group.newestTimestamp
    }));

    if (candidates.length === 0) {
        return { selectedCaseKey: null, method: 'none', candidates: [], unkeyedEntries };
    }

    const normalizedQueryValue = query?.type === 'case_number'
        ? normalizeCaseNumber(query?.value)
        : null;
    if (normalizedQueryValue) {
        const queried = candidates.find((candidate) => candidate.key === normalizedQueryValue);
        if (queried) {
            return { selectedCaseKey: queried.key, method: 'case-number-query', candidates, unkeyedEntries };
        }
    }

    const [winner] = rankCandidates(candidates);
    return { selectedCaseKey: winner.key, method: 'document-coverage', candidates, unkeyedEntries };
}

module.exports = {
    selectPrimaryCase,
    entryCaseKey,
    entryHasDocuments,
    entryTimestamp
};
