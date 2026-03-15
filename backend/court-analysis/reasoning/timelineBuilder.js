/**
 * Parses various date formats into a timestamp.
 * Handles:
 * - ISO: YYYY-MM-DD
 * - Croatian: D.M.YYYY, DD.MM.YYYY, with dots, slashes or dashes.
 * - Month names? (Maybe later)
 * @param {string} rawDate 
 * @returns {number|null} timestamp or null
 */
function parseDate(rawDate) {
    if (!rawDate || typeof rawDate !== 'string') return null;
    const value = rawDate.trim();
    if (!value) return null;

    // 1. Try ISO YYYY-MM-DD
    const isoMatch = value.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10);
        const day = parseInt(isoMatch[3], 10);
        const ts = Date.UTC(year, month - 1, day);
        if (!isNaN(ts)) return ts;
    }

    // 2. Try Croatian D.M.YYYY
    const croMatch = value.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\.?$/);
    if (croMatch) {
        const day = parseInt(croMatch[1], 10);
        const month = parseInt(croMatch[2], 10);
        let yearRaw = parseInt(croMatch[3], 10);
        const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw; // Handle 2-digit years
        
        const ts = Date.UTC(year, month - 1, day);
        if (!isNaN(ts)) return ts;
    }

    // 3. Fallback to Date.parse (often handles YYYY-MM-DD well)
    const fallbackTs = Date.parse(value);
    if (!isNaN(fallbackTs)) return fallbackTs;

    return null;
}

/**
 * Sorts and processes events for the timeline.
 * @param {Array<object>} events 
 * @returns {Array<object>} Sorted events
 */
function buildTimeline(events) {
    if (!Array.isArray(events)) return [];

    const processed = events.map(event => {
        const ts = parseDate(event.date);
        return {
            ...event,
            _ts: ts // Internal timestamp for sorting
        };
    });

    processed.sort((a, b) => {
        if (a._ts !== null && b._ts !== null) {
            return a._ts - b._ts;
        }
        // Place undated events at the end
        if (a._ts === null && b._ts !== null) return 1;
        if (a._ts !== null && b._ts === null) return -1;
        return 0; // Both null, keep original order (stable sort)
    });

    // Remove internal property and return
    return processed.map(({ _ts, ...rest }) => rest);
}

module.exports = {
    buildTimeline,
    parseDate // Export for testing if needed
};
