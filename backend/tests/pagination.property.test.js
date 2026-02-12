const fc = require('fast-check');
const { parsePagination, MAX_LIMIT } = require('../helpers/pagination');
const { sanitizeMarkdown } = require('../helpers/sanitize');

describe('parsePagination (property-based)', () => {
  test('clamps limit and offset to expected ranges', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.double(), fc.string()),
        fc.oneof(fc.integer(), fc.double(), fc.string()),
        (limit, offset) => {
          const { limit: parsedLimit, offset: parsedOffset } = parsePagination({
            limit,
            offset,
          });

          expect(parsedLimit).toBeGreaterThanOrEqual(1);
          expect(parsedLimit).toBeLessThanOrEqual(MAX_LIMIT);
          expect(parsedOffset).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe('sanitizeMarkdown (property-based)', () => {
  test('removes angle-bracket HTML tags', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const sanitized = sanitizeMarkdown(`<p>${input}</p>`);
        expect(sanitized.includes('<')).toBe(false);
        expect(sanitized.includes('>')).toBe(false);
      }),
    );
  });
});
