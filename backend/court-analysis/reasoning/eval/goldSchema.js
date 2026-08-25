// backend/court-analysis/reasoning/eval/goldSchema.js
//
// Purpose: Schema + validation for gold-label files that drive the offline
//          reasoning eval harness. A gold file states what a CORRECT analysis
//          of a fixture cluster must contain: citation spans retrieval should
//          surface, amounts extraction should find, dates the timeline needs.
//
// Why a schema: gold labels are hand-written and will drift from fixture data
// as fixtures evolve. Validation at load time turns silent metric corruption
// ("gold points at text that no longer exists") into an explicit load error.
//
// Design for future RL use: files are plain JSON with no code, so the same
// labels can serve as reward references in a training loop later without any
// harness rewrite.

const SCHEMA_VERSION = 1;

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function validateAmountShape(amount, path, errors) {
    if (!amount || typeof amount !== 'object') {
        errors.push(`${path} must be an object.`);
        return;
    }
    if (typeof amount.value !== 'number' || !Number.isFinite(amount.value)) {
        errors.push(`${path}.value must be a finite number.`);
    }
    if (!isNonEmptyString(amount.currency)) {
        errors.push(`${path}.currency must be a non-empty string (e.g. "EUR").`);
    }
    if (amount.tolerancePct !== undefined && (typeof amount.tolerancePct !== 'number' || amount.tolerancePct < 0)) {
        errors.push(`${path}.tolerancePct must be a non-negative number when present.`);
    }
    if (amount.descriptionIncludes !== undefined && !isNonEmptyString(amount.descriptionIncludes)) {
        errors.push(`${path}.descriptionIncludes must be a non-empty string when present.`);
    }
}

/**
 * Validates a parsed gold-label document.
 * @param {object} gold - Parsed JSON content of a gold-labels file.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateGoldLabels(gold) {
    const errors = [];

    if (!gold || typeof gold !== 'object' || Array.isArray(gold)) {
        return { valid: false, errors: ['Gold labels must be a JSON object.'] };
    }
    if (gold.schemaVersion !== SCHEMA_VERSION) {
        errors.push(`schemaVersion must be ${SCHEMA_VERSION}.`);
    }
    if (!isNonEmptyString(gold.clusterId)) {
        errors.push('clusterId must be a non-empty string.');
    }

    // citationSpans: what retrieval must surface. textIncludes is substring-
    // matched against source text (diacritics/case-insensitive); sourceId is
    // optional pinning when the same phrase appears in multiple sources.
    if (!Array.isArray(gold.citationSpans) || gold.citationSpans.length === 0) {
        errors.push('citationSpans must be a non-empty array.');
    } else {
        gold.citationSpans.forEach((span, i) => {
            if (!span || !isNonEmptyString(span.textIncludes)) {
                errors.push(`citationSpans[${i}].textIncludes must be a non-empty string.`);
            }
            if (span.sourceId !== undefined && !isNonEmptyString(span.sourceId)) {
                errors.push(`citationSpans[${i}].sourceId must be a non-empty string when present.`);
            }
        });
    }

    // expectedAmounts may be empty (clusters can legitimately have no money).
    if (gold.expectedAmounts !== undefined) {
        if (!Array.isArray(gold.expectedAmounts)) {
            errors.push('expectedAmounts must be an array when present.');
        } else {
            gold.expectedAmounts.forEach((amount, i) => validateAmountShape(amount, `expectedAmounts[${i}]`, errors));
        }
    }

    // expectedDates: ISO strings the timeline should contain. Optional.
    if (gold.expectedDates !== undefined) {
        if (!Array.isArray(gold.expectedDates) || gold.expectedDates.some((d) => !isNonEmptyString(d))) {
            errors.push('expectedDates must be an array of non-empty strings when present.');
        }
    }

    return { valid: errors.length === 0, errors };
}

module.exports = {
    SCHEMA_VERSION,
    validateGoldLabels
};
