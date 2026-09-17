// court-analysis/utils/csvFieldMapping.js
//
// Maps a parsed e-Oglasna CSV export row (header-keyed object from
// `scraper/csvExportParser.js`) into the exact `caseInfo` / `documentLinks` /
// `acquisition` shapes `CourtSearchPuppeteer.mapSearchResultsToPipelineEntries`
// already emits, so the pipeline's grouping/selection/reasoning layers consume
// CSV-discovered entries unchanged. Extra structured columns ride along as
// additive `caseInfo` fields (ignored by existing consumers).

const { normalizeCaseNumber } = require('./caseNumber');
const { parseCsvTimestamp } = require('./csvDate');

const CSV_ACQUISITION_MODE = 'csv-export';

// The "P227P" page-count suffix the export appends to document filenames.
const PAGE_COUNT_SUFFIX_RE = /\s+P\d+P$/i;

// `Sudionici` participant entries can carry a labelled role/OIB block of the
// form "Name / ULOGA: <role> | OIB: <11 digits>".
const OIB_RE = /\b\d{11}\b/g;
const ROLE_RE = /ULOGA\s*:\s*([^|]+)/i;

/**
 * Strips the trailing page-count marker (e.g. " P75P") from a document token,
 * yielding the human-facing filename.
 */
function stripPageCount(token) {
    return String(token || '').replace(PAGE_COUNT_SUFFIX_RE, '').trim();
}

/**
 * Splits the `Dokumenti (datoteke)` cell into raw tokens (filenames with page
 * counts preserved) and returns the stripped first filename for display.
 */
function parseDocumentFiles(raw) {
    const files = String(raw || '')
        .split(';')
        .map((token) => token.trim())
        .filter(Boolean);
    return {
        documentFiles: files,
        firstFilename: files.length > 0 ? stripPageCount(files[0]) : ''
    };
}

function isDebtorSegment(name, oib, debtorName, debtorOib) {
    const debtOib = String(debtorOib || '').trim();
    const debtName = String(debtorName || '').trim().toLowerCase();
    const segName = String(name || '').trim().toLowerCase();

    if (debtOib && oib && oib === debtOib) {
        return true;
    }
    if (!debtName || !segName) {
        return false;
    }
    if (segName === debtName) {
        return true;
    }
    // Containment fallback for suffix variations ("KERUM d.o.o." vs "KERUM d.o.o. u stečaju").
    return segName.length > 3 && (segName.includes(debtName) || debtName.includes(segName));
}

/**
 * Reconstructs the participant list from the `Sudionici` string plus the
 * dedicated debtor columns. Returns `{ name, oib, address, role }` entries that
 * `enrichParticipants` can consume unchanged.
 */
function parseParticipants(sudionici, debtorName, debtorOib, debtorAddress) {
    const raw = String(sudionici || '').trim();
    if (!raw) {
        return [];
    }

    const debtorAddressValue = String(debtorAddress || '').trim();

    return raw
        .split(';')
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => {
            const oibMatch = segment.match(OIB_RE);
            const oib = oibMatch ? oibMatch[0] : '';

            const roleMatch = segment.match(ROLE_RE);
            const roleFromLabel = roleMatch ? roleMatch[1].trim() : '';

            let name = segment.replace(OIB_RE, '').trim();
            if (roleFromLabel) {
                // Drop the "/ ULOGA: … | OIB: …" block entirely.
                name = name.replace(/\s*\/\s*ULOGA\s*:.*$/i, '').trim();
            }

            const isDebtor = isDebtorSegment(name, oib, debtorName, debtorOib);

            return {
                name,
                oib,
                address: isDebtor ? debtorAddressValue : '',
                role: roleFromLabel || (isDebtor ? 'DUŽNIK' : 'N/A')
            };
        });
}

/**
 * Maps a single header-keyed CSV row into a pipeline entry.
 *
 * @param {object} row - Header-keyed row from `parseCsvExport`.
 * @returns {{ caseInfo: object, acquisition: object, documentLinks: Array<object> }}
 */
function mapCsvRowToEntry(row) {
    const rawCaseNumber = String(row['Oznaka spisa'] || '').trim();
    const normalizedCaseNumber = normalizeCaseNumber(rawCaseNumber) || rawCaseNumber || 'N/A';

    const documentDownloadLink = String(row['Dokumenti (link)'] || '').trim();
    const { documentFiles, firstFilename } = parseDocumentFiles(row['Dokumenti (datoteke)']);
    const documentLinkText = firstFilename || `Dokumenti za ${normalizedCaseNumber}`;

    const rawDate = String(row['Početni dan objave'] || '').trim();
    const date = parseCsvTimestamp(rawDate);

    const debtorName = String(row['Stečajni dužnik'] || '').trim();
    const debtorOib = String(row['OIB stečajnog dužnika'] || '').trim();
    const debtorAddress = String(row['Adresa stečajnog dužnika'] || '').trim();
    const rawPublicationEnd = String(row['Posljednji dan objave'] || '').trim();

    const acquisition = { mode: CSV_ACQUISITION_MODE, currentPage: 1 };

    const caseInfo = {
        title: String(row['Naslov'] || '').trim(),
        detailLink: String(row['Oglas (link)'] || '').trim(),
        caseNumber: normalizedCaseNumber,
        court: String(row['Sud'] || '').trim(),
        date: date || rawDate || 'N/A',
        datePublished: rawDate,
        documentDownloadLink,
        documentLinkText,
        participants: parseParticipants(row['Sudionici'], debtorName, debtorOib, debtorAddress),
        acquisition,
        // Additive structured fields (ignored by existing consumers).
        entryType: String(row['Vrsta objave'] || '').trim(),
        debtorName,
        debtorOib,
        debtorAddress,
        publicationEnd: rawPublicationEnd || null,
        ePredmetLink: String(row['e-Predmet (link)'] || '').trim(),
        documentFiles
    };

    return {
        caseInfo,
        acquisition,
        documentLinks: documentDownloadLink
            ? [{ url: documentDownloadLink, text: documentLinkText }]
            : []
    };
}

/**
 * Maps an array of header-keyed CSV rows into pipeline entries.
 */
function mapCsvRowsToEntries(rows) {
    if (!Array.isArray(rows)) {
        return [];
    }
    return rows.map(mapCsvRowToEntry);
}

module.exports = {
    CSV_ACQUISITION_MODE,
    stripPageCount,
    parseDocumentFiles,
    parseParticipants,
    mapCsvRowToEntry,
    mapCsvRowsToEntries
};
