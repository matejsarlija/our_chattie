const HTML_TAG_REGEX = /<[^>]*>/g;

function sanitizeMarkdown(input) {
  if (!input || typeof input !== 'string') return '';
  return input.replace(HTML_TAG_REGEX, '').trim();
}

module.exports = {
  sanitizeMarkdown,
};
