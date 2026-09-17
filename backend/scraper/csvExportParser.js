// scraper/csvExportParser.js
//
// Parses the e-Oglasna "Izvoz podataka" CSV export into header-keyed rows,
// with defensive handling: optional UTF-8 BOM, RFC 4180 quoting (embedded
// commas/quotes/newlines), and `relax_column_count`-style tolerance for rows
// that carry more or fewer cells than the header.
//
// Any malformed body (HTML error page, truncated payload, missing columns)
// is reported as a typed failure (`schema-drift` / `empty`) so the caller can
// fall back to the Puppeteer path rather than half-parsing a broken export.

// Columns whose absence means the export schema has drifted and the result is
// not a usable discovery input. The others are additive/optional.
const REQUIRED_COLUMNS = [
    'Oznaka spisa',
    'Naslov',
    'Sud',
    'Oglas (link)',
    'Dokumenti (link)',
    'Početni dan objave',
    'OIB stečajnog dužnika',
    'Sudionici'
];

function stripBom(text) {
    if (text && text.charCodeAt(0) === 0xfeff) {
        return text.slice(1);
    }
    return text;
}

/**
 * Minimal RFC 4180 CSV parser. Returns an array of rows, each an array of raw
 * string cells. Handles quoted fields (including embedded commas, escaped
 * quotes, and embedded newlines) and both CRLF and LF line endings.
 *
 * @param {string} text
 * @returns {Array<Array<string>>}
 */
function parseCsv(text) {
    const rows = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    while (i < n) {
        const ch = text[i];

        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i += 2;
                    continue;
                }
                inQuotes = false;
                i += 1;
                continue;
            }
            field += ch;
            i += 1;
            continue;
        }

        if (ch === '"') {
            inQuotes = true;
            i += 1;
            continue;
        }

        if (ch === ',') {
            row.push(field);
            field = '';
            i += 1;
            continue;
        }

        if (ch === '\r') {
            if (text[i + 1] === '\n') i += 1;
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
            i += 1;
            continue;
        }

        if (ch === '\n') {
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
            i += 1;
            continue;
        }

        field += ch;
        i += 1;
    }

    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    return rows;
}

/**
 * Parses a raw export body into header-keyed rows, validating the schema.
 *
 * @param {string} body - Raw CSV text.
 * @returns {{ ok: true, rows: Array<object> } | { ok: false, reason: 'empty'|'schema-drift', missingColumns: string[] }}
 */
function parseCsvExport(body) {
    const text = stripBom(String(body == null ? '' : body));
    if (!text.trim()) {
        return { ok: false, reason: 'empty', missingColumns: [] };
    }

    const grid = parseCsv(text);
    if (grid.length === 0) {
        return { ok: false, reason: 'empty', missingColumns: [] };
    }

    const header = grid[0].map((cell) => (cell || '').trim());
    if (header.length === 0 || header.every((cell) => cell === '')) {
        return { ok: false, reason: 'empty', missingColumns: [] };
    }

    const headerSet = new Set(header);
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !headerSet.has(column));
    if (missingColumns.length > 0) {
        return { ok: false, reason: 'schema-drift', missingColumns };
    }

    const rows = [];
    for (let r = 1; r < grid.length; r += 1) {
        const cells = grid[r] || [];
        if (cells.every((cell) => (cell || '').trim() === '')) {
            continue;
        }
        const row = {};
        header.forEach((column, index) => {
            row[column] = index < cells.length ? cells[index] : '';
        });
        rows.push(row);
    }

    if (rows.length === 0) {
        return { ok: false, reason: 'empty', missingColumns: [] };
    }

    return { ok: true, rows };
}

module.exports = { parseCsv, parseCsvExport, REQUIRED_COLUMNS, stripBom };
