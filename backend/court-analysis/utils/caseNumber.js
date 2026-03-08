/**
 * Normalizes a Croatian case number string into a canonical format.
 *
 * Examples:
 * - "St-357/2013" -> "ST-357/2013"
 * - "st - 357 / 2013" -> "ST-357/2013"
 * - "Ovr-456/2024" -> "OVR-456/2024"
 *
 * @param {string} rawCaseNumber
 * @returns {string|null} Canonical uppercase key or null if invalid
 */
function normalizeCaseNumber(rawCaseNumber) {
    if (!rawCaseNumber || typeof rawCaseNumber !== 'string') {
        return null;
    }

    // 1. Basic trim and uppercase
    let normalized = rawCaseNumber.trim().toUpperCase();

    // 2. Handle empty or "N/A" explicitly
    if (!normalized || normalized === 'N/A') {
        return null;
    }

    // 3. Normalize dashes (en dash, em dash) to hyphen
    normalized = normalized.replace(/[–—]/g, '-');

    // 4. Remove spaces around hyphen and slash
    // The pattern captures optional spaces around - and / and replaces with just the symbol
    normalized = normalized.replace(/\s*([-/\\])\s*/g, '$1');

    // 5. Replace backslash with forward slash just in case
    normalized = normalized.replace(/\\/g, '/');

    // 6. Ensure consistent spacing for other characters (collapse multiple spaces)
    normalized = normalized.replace(/\s+/g, ' ');

    return normalized;
}

module.exports = {
    normalizeCaseNumber
};
