const OIB_REGEX = /^\d{11}$/;
const CASE_NUMBER_REGEX = /^[A-Za-zČĆŽŠĐčćžšđ]{1,6}\s*-\s*\d+\s*\/\s*\d{2,4}$/;

function classifyQueryType(rawValue) {
  const value = String(rawValue || '').trim();
  if (OIB_REGEX.test(value)) return 'oib';
  if (CASE_NUMBER_REGEX.test(value)) return 'case_number';
  return 'text';
}

module.exports = {
  classifyQueryType,
  OIB_REGEX,
  CASE_NUMBER_REGEX,
};
