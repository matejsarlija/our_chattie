// Stable grouping key for Croatian claim-registry numbers.
//
// Strip trailing sentence punctuation only when the remaining value is numeric.
// Register prefixes and any alphabetic identifiers remain distinct.
function normalizeClaimRegistryNumber(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    const stripped = trimmed.replace(/[.,;]+$/, '');
    return /^\d+$/.test(stripped) ? stripped : trimmed;
}

module.exports = { normalizeClaimRegistryNumber };
