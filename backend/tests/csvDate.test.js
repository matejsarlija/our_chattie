const { parseCsvTimestamp } = require('../court-analysis/utils/csvDate');

// `parseCaseDateToTimestamp` (pipeline.js) is not exported as a standalone
// helper, and importing pipeline.js pulls the full scraper/agent stack. Its
// ISO branch is exactly `Date.parse(value)` (the Croatian line-anchored regex
// does not match ISO), and ECMAScript parses date-only ISO strings as UTC
// midnight — so asserting `Date.parse` is finite AND lands on the source
// calendar day proves the downstream parse is non-null and un-shifted.
function assertParsesToUtcDay(iso, year, month, day) {
    const ts = Date.parse(iso);
    expect(Number.isNaN(ts)).toBe(false);
    const d = new Date(ts);
    expect(d.getUTCFullYear()).toBe(year);
    expect(d.getUTCMonth()).toBe(month - 1);
    expect(d.getUTCDate()).toBe(day);
}

describe('parseCsvTimestamp', () => {
    test('parses full timestamp into date-only ISO 8601 (day/month/year correct)', () => {
        expect(parseCsvTimestamp('23.06.2026. 08:36:20')).toBe('2026-06-23');
    });

    test('parses timestamp without seconds', () => {
        expect(parseCsvTimestamp('08.06.2026. 12:53')).toBe('2026-06-08');
    });

    test('parses date-only value', () => {
        expect(parseCsvTimestamp('23.06.2026.')).toBe('2026-06-23');
    });

    test('handles two-digit year by assuming 2000s', () => {
        expect(parseCsvTimestamp('23.06.26. 08:36:20')).toBe('2026-06-23');
    });

    test('handles single-digit day and month with zero padding', () => {
        expect(parseCsvTimestamp('1.2.2026. 00:05:07')).toBe('2026-02-01');
    });

    test('returns null for empty/whitespace/missing input', () => {
        expect(parseCsvTimestamp('')).toBe(null);
        expect(parseCsvTimestamp('   ')).toBe(null);
        expect(parseCsvTimestamp(null)).toBe(null);
        expect(parseCsvTimestamp(undefined)).toBe(null);
    });

    test('returns null for malformed values (never throws)', () => {
        expect(parseCsvTimestamp('not a date')).toBe(null);
        expect(parseCsvTimestamp('23/06/2026')).toBe(null);
        expect(parseCsvTimestamp('2026-06-23')).toBe(null);
        expect(parseCsvTimestamp('32.13.2026. 99:99:99')).toBe(null);
    });

    test('rejects impossible date components', () => {
        expect(parseCsvTimestamp('31.13.2026. 08:36:20')).toBe(null); // month 13
        expect(parseCsvTimestamp('00.01.2026. 08:36:20')).toBe(null); // day 0
        expect(parseCsvTimestamp('32.01.2026. 08:36:20')).toBe(null); // day 32
    });

    test('does not shift the calendar day regardless of server timezone', () => {
        // Early-morning Croatian local time must keep the SAME calendar day.
        expect(parseCsvTimestamp('23.06.2026. 00:15:00')).toBe('2026-06-23');
        assertParsesToUtcDay(parseCsvTimestamp('23.06.2026. 00:15:00'), 2026, 6, 23);
    });

    test('downstream date parsing yields a non-null, correct-day timestamp', () => {
        assertParsesToUtcDay(parseCsvTimestamp('23.06.2026. 08:36:20'), 2026, 6, 23);
        assertParsesToUtcDay(parseCsvTimestamp('23.06.2026.'), 2026, 6, 23);
        assertParsesToUtcDay(parseCsvTimestamp('17.08.2016. 15:00:25'), 2016, 8, 17);
    });
});
