const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parsePagination(query = {}) {
  const rawLimit = Number(query.limit);
  const rawOffset = Number(query.offset);

  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const offset = Number.isFinite(rawOffset)
    ? Math.max(Math.floor(rawOffset), 0)
    : 0;

  return { limit, offset };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePagination,
};
