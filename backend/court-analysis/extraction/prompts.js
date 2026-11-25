'use strict';

const crypto = require('node:crypto');
const {
    EXTRACTION_SCHEMA_VERSION,
    REPAIRABLE_FIELDS,
    PROCEDURAL_OUTCOMES,
    VALUE_ROLE_GUIDANCE,
    DECISION_OUTCOME_RULE,
    FIELD_SPECS,
} = require('../reasoning/schema/extractionSchema');

const TABLE_ROWS_SPEC = (
    'For dense multi-row claim tables, creditor schedules ("popis tražbina", "diobeni popis", "obračun"), ' +
    'or itemized bank statements, prefer the compact "tableRows" array instead of duplicating verbose objects in "amounts" ' +
    '(never emit the same row in both "tableRows" and "amounts"): ' +
    'each row: {"rbr", "creditor", "oib" (11 digits if printed), "isplatniRed", "establishedEur" (number), ' +
    '"establishedHrk" (number), "contestedEur" (number), "paidEur" (number), "role", "quote" (verbatim source row snippet)}. ' +
    'Reserve "amounts" for prose/non-table amounts or standalone line items when "tableRows" is not used.'
);

const STATIC_EXTRACTION_SYSTEM_PROMPT = [
    'You are a legal document extraction engine for Croatian commercial, bankruptcy, and land-registry court records.',
    'Extract only facts explicitly supported by the source document text provided in the user message.',
    'Return ONLY a single valid JSON object matching this exact schema (no markdown commentary outside JSON):',
    'Keys:',
    '- "caseNumber": string or null (explicit poslovni broj of this filing).',
    '- "decisionDate": YYYY-MM-DD string or null.',
    '- "summary": concise Croatian summary of 1-3 sentences including key figures, or "" on pure table-continuation segments.',
    '- "keyClaims": array of up to 5 concise atomic Croatian factual statements (<= 160 chars each); [] on pure table-continuation segments.',
    `- "decisionOutcome": ${DECISION_OUTCOME_RULE}`,
    `- "documentParties": ${FIELD_SPECS.documentParties}`,
    `- "amounts": ${FIELD_SPECS.amounts}`,
    `- "tableRows": ${TABLE_ROWS_SPEC}`,
    `- "propertyFlow": ${FIELD_SPECS.propertyFlow} ${VALUE_ROLE_GUIDANCE}`,
    '- "citedFilingReferences": array of "poslovni broj" values explicitly cited by this document (e.g. rulings appealed or decided upon); [] when none.',
    `- "proceduralEvents": ${FIELD_SPECS.proceduralEvents}`,
].join('\n\n');

const PROMPT_NAME_V5 = 'extraction_v5';
const PROMPT_HASH_V5 = crypto
    .createHash('sha256')
    .update(`${EXTRACTION_SCHEMA_VERSION}:${STATIC_EXTRACTION_SYSTEM_PROMPT}`)
    .digest('hex')
    .slice(0, 16);

const EXTRACTION_SIGNATURE_V5 = Object.freeze({
    version: EXTRACTION_SCHEMA_VERSION,
    promptName: PROMPT_NAME_V5,
    promptHash: PROMPT_HASH_V5,
    systemPrompt: STATIC_EXTRACTION_SYSTEM_PROMPT,
    repairableFields: REPAIRABLE_FIELDS,
    proceduralOutcomes: PROCEDURAL_OUTCOMES,
    decisionOutcomeRule: DECISION_OUTCOME_RULE,
    tableRowsSpec: TABLE_ROWS_SPEC,
    valueRoleGuidance: VALUE_ROLE_GUIDANCE,
    fieldSpecs: FIELD_SPECS,
});

function buildDynamicUserContent(knownParties, segmentText, { segmentIndex = 0, totalSegments = 1 } = {}) {
    const contextHeader = `Known case participants (context only — never copy OIBs into documentParties unless explicitly printed in the document text):\n${knownParties || 'None supplied.'}`;
    const segLabel = totalSegments > 1 ? ` (Segment ${segmentIndex + 1}/${totalSegments})` : '';
    return `${contextHeader}\n\nProvide ONLY the json object and nothing else. Text${segLabel}:\n\n${String(segmentText || '')}`;
}

function buildAnalysisMessages(knownParties, segmentText, options = {}) {
    const messages = [
        { role: 'system', content: STATIC_EXTRACTION_SYSTEM_PROMPT },
        { role: 'user', content: buildDynamicUserContent(knownParties, segmentText, options) },
    ];
    // Preserve full prompt visibility when Jest mock implementations stringify `prompt`
    Object.defineProperty(messages, 'toString', {
        enumerable: false,
        value: () => `${messages[0].content}\n\n${messages[1].content}`,
    });
    return messages;
}

function buildAnalysisPrompt(knownParties, segmentText, options = {}) {
    return `${STATIC_EXTRACTION_SYSTEM_PROMPT}\n\n${buildDynamicUserContent(knownParties, segmentText, options)}`;
}

function buildFieldRepairPrompt({ field, sourceText }) {
    const spec = FIELD_SPECS[field];
    if (!spec) throw new Error(`Field ${field} is not repairable`);
    const excerpt = String(sourceText || '');
    const extraGuidance = field === 'propertyFlow' ? ` ${VALUE_ROLE_GUIDANCE}` : '';
    return (
        `FIELD REPAIR (v${EXTRACTION_SCHEMA_VERSION}). A previous extraction of the court document below produced an unusable "${field}" value. ` +
        `Re-extract ONLY that field from the source text below.\n\n` +
        `Return ONLY a JSON object of the form {"value": <the re-extracted ${field} value per this spec>, "absent": true|false}. ` +
        `Set "absent" to true (with "value" null, or [] for arrays) when the source text does not state this field at all — never invent a missing fact. ` +
        `"value" must follow this spec: ${spec}${extraGuidance}\n\n` +
        `Provide ONLY the json object and nothing else. Text:\n\n${excerpt}`
    );
}

function buildFullRepairPrompt({ sourceText }) {
    const excerpt = String(sourceText || '');
    return (
        `EXTRACTION REPAIR (v${EXTRACTION_SCHEMA_VERSION}). A previous extraction of the court document produced no usable JSON. ` +
        `Extract key information from the source text below as a JSON object with keys: "caseNumber", "decisionDate", ` +
        `"summary" (1-3 concise sentences in Croatian), "keyClaims" (array of <= 5 short Croatian statements), ` +
        `${DECISION_OUTCOME_RULE}, ` +
        `${FIELD_SPECS.documentParties} (as "documentParties"; [] when none), ` +
        `${FIELD_SPECS.amounts} (as "amounts"; [] when none), ` +
        `${TABLE_ROWS_SPEC} (as "tableRows"; omit when none), ` +
        `${FIELD_SPECS.propertyFlow} (as "propertyFlow"; [] when none), ` +
        `${FIELD_SPECS.proceduralEvents} (as "proceduralEvents"; [] when none). ${VALUE_ROLE_GUIDANCE} ` +
        `Also extract "citedFilingReferences" (array of "poslovni broj" values explicitly referenced; [] when none).\n\n` +
        `Provide ONLY the json object and nothing else. Text:\n\n${excerpt}`
    );
}

module.exports = {
    PROMPT_NAME_V5,
    PROMPT_HASH_V5,
    STATIC_EXTRACTION_SYSTEM_PROMPT,
    DECISION_OUTCOME_RULE,
    TABLE_ROWS_SPEC,
    EXTRACTION_SIGNATURE_V5,
    buildAnalysisMessages,
    buildAnalysisPrompt,
    buildFieldRepairPrompt,
    buildFullRepairPrompt,
};
