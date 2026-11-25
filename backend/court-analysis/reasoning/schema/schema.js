const SCHEMA_VERSION = '1.0.0';
const VALID_CONFIDENCE_LEVELS = ['high', 'medium', 'low'];

/**
 * Validates an Evidence object.
 * @param {object} evidence 
 * @returns {{valid: boolean, error?: string}}
 */
function validateEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object') {
        return { valid: false, error: 'Evidence must be an object.' };
    }

    if (!evidence.sourceId || typeof evidence.sourceId !== 'string') {
        return { valid: false, error: 'Evidence must have a string sourceId.' };
    }

    if (!evidence.text || typeof evidence.text !== 'string') {
        return { valid: false, error: 'Evidence must have a string text (quote).' };
    }

    return { valid: true };
}

/**
 * Validates a Claim object.
 * @param {object} claim 
 * @param {object} [options]
 * @param {boolean} [options.strictEvidence=false] - If true, requires at least one evidence item.
 * @returns {{valid: boolean, error?: string}}
 */
function validateClaim(claim, options = {}) {
    if (!claim || typeof claim !== 'object') {
        return { valid: false, error: 'Claim must be an object.' };
    }

    if (!claim.id || typeof claim.id !== 'string') {
        return { valid: false, error: 'Claim must have a string id.' };
    }

    if (!claim.text || typeof claim.text !== 'string') {
        return { valid: false, error: 'Claim must have a string text.' };
    }

    if (!claim.confidence || !VALID_CONFIDENCE_LEVELS.includes(claim.confidence)) {
        return { valid: false, error: `Claim confidence must be one of: ${VALID_CONFIDENCE_LEVELS.join(', ')}.` };
    }

    if (!Array.isArray(claim.evidence)) {
        return { valid: false, error: 'Claim evidence must be an array.' };
    }

    if (options.strictEvidence && claim.evidence.length === 0) {
        return { valid: false, error: 'Claim must have at least one piece of evidence (strict mode).' };
    }

    for (const ev of claim.evidence) {
        const evResult = validateEvidence(ev);
        if (!evResult.valid) {
            return { valid: false, error: `Invalid evidence in claim ${claim.id}: ${evResult.error}` };
        }
    }

    return { valid: true };
}

function validateFinding(finding) {
    if (!finding || typeof finding !== 'object') {
        return { valid: false, error: 'Finding must be an object.' };
    }

    if (!finding.text || typeof finding.text !== 'string') {
        return { valid: false, error: 'Finding must have a string text.' };
    }

    if (finding.confidence && !VALID_CONFIDENCE_LEVELS.includes(finding.confidence)) {
        return { valid: false, error: `Finding confidence must be one of: ${VALID_CONFIDENCE_LEVELS.join(', ')}.` };
    }

    if (finding.citations !== undefined && !Array.isArray(finding.citations)) {
        return { valid: false, error: 'Finding citations must be an array if present.' };
    }

    return { valid: true };
}

/**
 * Validates a full Report object.
 * @param {object} report 
 * @returns {{valid: boolean, error?: string}}
 */
function validateReport(report) {
    if (!report || typeof report !== 'object') {
        return { valid: false, error: 'Report must be an object.' };
    }

    if (report.schemaVersion !== SCHEMA_VERSION) {
        return { valid: false, error: `Report schema version mismatch. Expected ${SCHEMA_VERSION}, got ${report.schemaVersion}.` };
    }

    if (!Array.isArray(report.claims)) {
        return { valid: false, error: 'Report must have a claims array.' };
    }

    for (const claim of report.claims) {
        const claimResult = validateClaim(claim);
        if (!claimResult.valid) {
            return { valid: false, error: `Invalid claim in report: ${claimResult.error}` };
        }
    }

    if (!Array.isArray(report.findings)) {
        return { valid: false, error: 'Report must have a findings array.' };
    }

    for (const finding of report.findings) {
        const findingResult = validateFinding(finding);
        if (!findingResult.valid) {
            return { valid: false, error: `Invalid finding in report: ${findingResult.error}` };
        }
    }

    if (report.verifiedFindings !== undefined) {
        if (!Array.isArray(report.verifiedFindings)) {
            return { valid: false, error: 'Report verifiedFindings must be an array if present.' };
        }

        for (const finding of report.verifiedFindings) {
            const findingResult = validateFinding(finding);
            if (!findingResult.valid) {
                return { valid: false, error: `Invalid verified finding in report: ${findingResult.error}` };
            }
        }
    }

    if (report.openQuestions !== undefined && !Array.isArray(report.openQuestions)) {
        return { valid: false, error: 'Report openQuestions must be an array if present.' };
    }

    if (report.nextSteps !== undefined && !Array.isArray(report.nextSteps)) {
        return { valid: false, error: 'Report nextSteps must be an array if present.' };
    }

    if (report.conflicts !== undefined && !Array.isArray(report.conflicts)) {
        return { valid: false, error: 'Report conflicts must be an array if present.' };
    }

    if (report.timeline !== undefined) {
        if (!Array.isArray(report.timeline)) {
            return { valid: false, error: 'Report timeline must be an array if present.' };
        }

        for (const event of report.timeline) {
            const eventResult = validateTimelineItem(event);
            if (!eventResult.valid) {
                return { valid: false, error: `Invalid timeline event in report: ${eventResult.error}` };
            }
        }
    }

    // Optional meta check
    if (report.meta && typeof report.meta !== 'object') {
        return { valid: false, error: 'Report meta must be an object if present.' };
    }

    return { valid: true };
}

/**
 * Validates a Timeline event item in a report (citations-based shape).
 * Events produced by the synthesizer carry `{ date, description, citations }`.
 * @param {object} event
 * @returns {{valid: boolean, error?: string}}
 */
function validateTimelineItem(event) {
    if (!event || typeof event !== 'object') {
        return { valid: false, error: 'Timeline event must be an object.' };
    }

    if (!event.description || typeof event.description !== 'string') {
        return { valid: false, error: 'Timeline event must have a description string.' };
    }

    // date can be null (undated) or a string (ISO or partial)
    if (event.date !== null && typeof event.date !== 'string') {
        return { valid: false, error: 'Timeline event date must be a string or null.' };
    }

    const citations = event.citations !== undefined ? event.citations : event.evidence;
    if (citations !== undefined && !Array.isArray(citations)) {
        return { valid: false, error: 'Timeline event citations must be an array if present.' };
    }

    for (const citation of citations || []) {
        if (!citation || typeof citation !== 'object') {
            return { valid: false, error: 'Timeline event citation must be an object.' };
        }
    }

    return { valid: true };
}

/**
 * Validates an Event object for the timeline.
 * @param {object} event 
 * @returns {{valid: boolean, error?: string}}
 */
function validateEvent(event) {
    if (!event || typeof event !== 'object') {
        return { valid: false, error: 'Event must be an object.' };
    }

    if (!event.description || typeof event.description !== 'string') {
        return { valid: false, error: 'Event must have a description string.' };
    }
    
    // date can be null (undated) or a string (ISO or partial)
    if (event.date !== null && typeof event.date !== 'string') {
        return { valid: false, error: 'Event date must be a string or null.' };
    }

    if (!Array.isArray(event.evidence)) {
        return { valid: false, error: 'Event evidence must be an array.' };
    }

    for (const ev of event.evidence) {
        const evResult = validateEvidence(ev);
        if (!evResult.valid) {
            return { valid: false, error: `Invalid evidence in event: ${evResult.error}` };
        }
    }

    return { valid: true };
}

module.exports = {
    SCHEMA_VERSION,
    validateEvidence,
    validateClaim,
    validateFinding,
    validateReport,
    validateEvent,
    validateTimelineItem
};
