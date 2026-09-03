// court-analysis/utils/csvDate.js
//
// Parses the e-Oglasna CSV export timestamp format ("dd.mm.yyyy. HH:mm:ss")
// into a date-only ISO 8601 string. The export uses Croatian local wall time
// with no zone designator, so emitting the calendar date alone is the only
// timezone-safe representation: downstream `parseCaseDateToTimestamp` parses
// date-only ISO as UTC midnight, immune to server-timezone day-shifting that a
// naive `HH:mm:ss` suffix would introduce for early-morning timestamps.

/**
 * Converts an e-Oglasna export timestamp into a date-only ISO 8601 string.
 *
 * Accepts `dd.mm.yyyy.` (date-only) and `dd.mm.yyyy. HH:mm[:ss]`. The year may
 * be two or four digits. The time component is validated syntactically but
 * discarded — the pipeline's date-span/recency scoring operates at day
 * granularity, and preserving wall-clock time would make the parsed day depend
 * on the server's timezone.
 *
 * @param {string} value - Raw "Početni dan objave" cell.
 * @returns {string|null} Date-only ISO 8601 string (e.g. "2026-06-23") or null.
 */
function parseCsvTimestamp(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const raw = value.trim();
    if (!raw) {
        return null;
    }

    const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
    if (!match) {
        return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) {
        year += 2000;
    }

    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;

    const pad = (n) => String(n).padStart(2, '0');
    return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

module.exports = { parseCsvTimestamp };
