const HTML_TAG_REGEX = /<[^>]*>/g;
const RESIDUAL_ANGLE_BRACKETS_REGEX = /[<>]/g;

function sanitizeMarkdown(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(HTML_TAG_REGEX, '')
    .replace(RESIDUAL_ANGLE_BRACKETS_REGEX, '')
    .trim();
}

module.exports = {
  sanitizeMarkdown,
};
