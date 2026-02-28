function deriveEntryDisplayId(detailLink) {
  if (!detailLink) return null;

  const extractFromPath = (path) => {
    const cleanPath = String(path || '').split('?')[0];
    const parts = cleanPath.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : null;
  };

  try {
    const url = new URL(String(detailLink));
    return extractFromPath(url.pathname);
  } catch {
    return extractFromPath(detailLink);
  }
}

module.exports = {
  deriveEntryDisplayId,
};
