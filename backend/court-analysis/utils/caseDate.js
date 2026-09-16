// court-analysis/utils/caseDate.js
//
// Single home for court-entry date parsing. Moved verbatim out of
// `pipeline.js` so discovery (primary-case selection) and the pipeline share
// one parsing rule instead of drifting apart.
//
// Accepts Croatian `d.m.yyyy.` wall dates and ISO 8601; anything else falls
// through to `Date.parse`. Returns a UTC-millisecond timestamp or null.

function parseCaseDateToTimestamp(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return null;
    const value = rawDate.trim();
    if (!value || value.toUpperCase() === 'N/A') return null;

    const croatianDateMatch = value.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\.?$/);
    if (croatianDateMatch) {
        const day = Number.parseInt(croatianDateMatch[1], 10);
        const month = Number.parseInt(croatianDateMatch[2], 10);
        const yearRaw = Number.parseInt(croatianDateMatch[3], 10);
        const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
        const ts = Date.UTC(year, month - 1, day);
        const parsed = new Date(ts);

        if (
            parsed.getUTCFullYear() === year &&
            parsed.getUTCMonth() === month - 1 &&
            parsed.getUTCDate() === day
        ) {
            return ts;
        }
        return null;
    }

    const fallbackTs = Date.parse(value);
    return Number.isNaN(fallbackTs) ? null : fallbackTs;
}

module.exports = {
    parseCaseDateToTimestamp
};
