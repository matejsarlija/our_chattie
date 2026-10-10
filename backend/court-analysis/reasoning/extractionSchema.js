// court-analysis/reasoning/extractionSchema.js
//
// JSON schema for per-document extraction output (spec §4.2 / ticket T1-3).
// Hand-rolled deterministic validators — no new dependencies, no model calls.
//
// Contract:
// - `validateExtraction(parsed)` never throws on JSON-shaped input. It returns
//   `{ valid, value, gaps }` where `value` is the sanitized result (all fields
//   present, invalid entries dropped or nulled — never invented) and `gaps`
//   names every field that could not be salvaged (`{ field, code, detail }`).
// - Only `amounts` and `propertyFlow` are repair-worthy: they carry the money
//   and chain data the pipeline reasons over. Malformed scalars degrade to
//   null and malformed `citedFilingReferences` to [] without spending a repair
//   call — low value, bounded loss.
// - Repair always runs against the ORIGINAL source excerpt/page, never an
//   earlier model summary, and may answer `absent` (source does not state the
//   field) — which accepts as empty without a gap.

const EXTRACTION_SCHEMA_VERSION = 2;

const TOP_LEVEL_FIELDS = [
    'caseNumber',
    'decisionDate',
    'summary',
    'amounts',
    'propertyFlow',
    'citedFilingReferences'
];

const REPAIRABLE_FIELDS = ['amounts', 'propertyFlow'];

const AMOUNT_DIRECTIONS = ['potraživanje', 'obveza', 'awarded', 'rejected', 'netted'];
const CURRENCIES = ['EUR', 'HRK'];
const ASSET_TYPES = ['nekretnina', 'pokretnina', 'tražbina', 'drugo'];
const EVENT_TYPES = ['prijava', 'ustup', 'namirenje', 'drugo'];
// TL-1 ledger roles: amount function in the document (total vs row), what the
// entry's document DOES to the claim/right, and how a lifecycle link is
// evidenced. All optional; invalid-but-present values gap (they would
// misdrive TL-2 matching), absent values stay null without a gap.
const AMOUNT_ROLES = ['total', 'line_item', 'principal', 'cost', 'paid', 'fee'];
const LEGAL_EFFECTS = ['creates', 'modifies', 'supersedes', 'resolves', 'implements', 'unknown'];
const VALUE_ROLES = ['claim_balance', 'transfer_consideration', 'payment_amount', 'asset_value', 'unknown'];
const RELATIONSHIP_BASES = ['explicit_identifier', 'explicit_text', 'inferred'];
const VALUE_ROLE_GUIDANCE = 'For every non-null propertyFlow.value, include valueRole: "claim_balance" only when the source explicitly states the outstanding claim balance; "transfer_consideration" for the price paid for an assignment; "payment_amount" for a payment or recovery; "asset_value" for another asset valuation; or "unknown" when the amount’s meaning cannot be established. Never treat a payment or assignment price as a remaining claim balance.';

function asStringOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

function asFiniteNumberOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.replace(/\s/g, '').replace(',', '.'));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function asEnumOrNull(value, allowed) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return allowed.includes(trimmed) ? trimmed : null;
}

function asOibOrNull(value) {
    if (typeof value !== 'string') return null;
    const digits = value.replace(/\D/g, '');
    return digits.length === 11 ? digits : null;
}

function gap(field, code, detail) {
    return { field, code, detail: detail || null };
}

function validateAmount(raw, index) {
    const path = `amounts[${index}]`;
    const gaps = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'amount entry is not an object')] };
    }
    const description = asStringOrNull(raw.description);
    if (!description) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'missing description; entry unusable for grouping')] };
    }
    const currency = asEnumOrNull(raw.currency, CURRENCIES);
    if (raw.currency !== undefined && raw.currency !== null && currency === null) {
        gaps.push(gap(`${path}.currency`, 'schema-mismatch', `unsupported currency: ${String(raw.currency).slice(0, 24)}`));
    }
    const direction = asEnumOrNull(raw.direction, AMOUNT_DIRECTIONS);
    if (raw.direction !== undefined && raw.direction !== null && direction === null) {
        gaps.push(gap(`${path}.direction`, 'schema-mismatch', `unsupported direction: ${String(raw.direction).slice(0, 24)}`));
    }
    const amountRole = asEnumOrNull(raw.amountRole, AMOUNT_ROLES);
    if (raw.amountRole !== undefined && raw.amountRole !== null && amountRole === null) {
        gaps.push(gap(`${path}.amountRole`, 'schema-mismatch', `unsupported amount role: ${String(raw.amountRole).slice(0, 24)}`));
    }
    const eventType = asEnumOrNull(raw.eventType, EVENT_TYPES);
    if (raw.eventType !== undefined && raw.eventType !== null && eventType === null) {
        gaps.push(gap(`${path}.eventType`, 'schema-mismatch', `unsupported event type: ${String(raw.eventType).slice(0, 24)}`));
    }
    const legalEffect = asEnumOrNull(raw.legalEffect, LEGAL_EFFECTS);
    if (raw.legalEffect !== undefined && raw.legalEffect !== null && legalEffect === null) {
        gaps.push(gap(`${path}.legalEffect`, 'schema-mismatch', `unsupported legal effect: ${String(raw.legalEffect).slice(0, 24)}`));
    }
    const relationshipBasis = asEnumOrNull(raw.relationshipBasis, RELATIONSHIP_BASES);
    if (raw.relationshipBasis !== undefined && raw.relationshipBasis !== null && relationshipBasis === null) {
        gaps.push(gap(`${path}.relationshipBasis`, 'schema-mismatch', `unsupported relationship basis: ${String(raw.relationshipBasis).slice(0, 24)}`));
    }
    const { value: references, gaps: refGaps } = validateStringArray(raw.references, `${path}.references`);
    gaps.push(...refGaps);
    return {
        value: {
            description,
            amount: asFiniteNumberOrNull(raw.amount),
            currency,
            date: asStringOrNull(raw.date),
            direction,
            amountRole,
            eventType,
            legalEffect,
            references,
            relationshipBasis,
            payerName: asStringOrNull(raw.payerName),
            payerOib: asOibOrNull(raw.payerOib),
            recipientName: asStringOrNull(raw.recipientName),
            recipientOib: asOibOrNull(raw.recipientOib),
            amountEur: asFiniteNumberOrNull(raw.amountEur),
            amountHrk: asFiniteNumberOrNull(raw.amountHrk),
            isplatniRed: asStringOrNull(raw.isplatniRed),
            claimRegistryNumber: asStringOrNull(raw.claimRegistryNumber),
            filingReference: asStringOrNull(raw.filingReference),
            quote: asStringOrNull(raw.quote)
        },
        gaps
    };
}

function validatePropertyItem(raw, index) {
    const path = `propertyFlow[${index}]`;
    const gaps = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'property entry is not an object')] };
    }
    const description = asStringOrNull(raw.description);
    if (!description) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'missing description; entry unusable for grouping')] };
    }
    const currency = asEnumOrNull(raw.currency, CURRENCIES);
    if (raw.currency !== undefined && raw.currency !== null && currency === null) {
        gaps.push(gap(`${path}.currency`, 'schema-mismatch', `unsupported currency: ${String(raw.currency).slice(0, 24)}`));
    }
    const assetType = asEnumOrNull(raw.assetType, ASSET_TYPES);
    if (raw.assetType !== undefined && raw.assetType !== null && assetType === null) {
        gaps.push(gap(`${path}.assetType`, 'schema-mismatch', `unsupported asset type: ${String(raw.assetType).slice(0, 24)}`));
    }
    const eventType = asEnumOrNull(raw.eventType, EVENT_TYPES);
    if (raw.eventType !== undefined && raw.eventType !== null && eventType === null) {
        gaps.push(gap(`${path}.eventType`, 'schema-mismatch', `unsupported event type: ${String(raw.eventType).slice(0, 24)}`));
    }
    const valueRole = asEnumOrNull(raw.valueRole, VALUE_ROLES);
    if (raw.valueRole !== undefined && raw.valueRole !== null && valueRole === null) {
        gaps.push(gap(`${path}.valueRole`, 'schema-mismatch', `unsupported value role: ${String(raw.valueRole).slice(0, 32)}`));
    }
    const legalEffect = asEnumOrNull(raw.legalEffect, LEGAL_EFFECTS);
    if (raw.legalEffect !== undefined && raw.legalEffect !== null && legalEffect === null) {
        gaps.push(gap(`${path}.legalEffect`, 'schema-mismatch', `unsupported legal effect: ${String(raw.legalEffect).slice(0, 24)}`));
    }
    const relationshipBasis = asEnumOrNull(raw.relationshipBasis, RELATIONSHIP_BASES);
    if (raw.relationshipBasis !== undefined && raw.relationshipBasis !== null && relationshipBasis === null) {
        gaps.push(gap(`${path}.relationshipBasis`, 'schema-mismatch', `unsupported relationship basis: ${String(raw.relationshipBasis).slice(0, 24)}`));
    }
    const { value: references, gaps: refGaps } = validateStringArray(raw.references, `${path}.references`);
    gaps.push(...refGaps);
    return {
        value: {
            description,
            identifier: asStringOrNull(raw.identifier),
            // Absent remains the safe default; invalid is explicitly gapped
            // above so the whole field can be repaired from source text.
            assetType: assetType || 'drugo',
            transferor: asStringOrNull(raw.transferor),
            transferee: asStringOrNull(raw.transferee),
            value: asFiniteNumberOrNull(raw.value),
            currency,
            date: asStringOrNull(raw.date),
            quote: asStringOrNull(raw.quote),
            eventType,
            valueRole,
            legalEffect,
            references,
            relationshipBasis,
            isplatniRed: asStringOrNull(raw.isplatniRed),
            claimRegistryNumber: asStringOrNull(raw.claimRegistryNumber),
            filingReference: asStringOrNull(raw.filingReference),
            supersedes: asStringOrNull(raw.supersedes)
        },
        gaps
    };
}

function validateStringArray(raw, path) {
    if (raw === undefined || raw === null) return { value: [], gaps: [] };
    if (!Array.isArray(raw)) return { value: [], gaps: [gap(path, 'schema-mismatch', 'expected an array')] };
    return {
        value: raw.map((item) => String(item || '').trim()).filter(Boolean),
        gaps: []
    };
}

/**
 * Validates + sanitizes one extraction output object.
 * @param {*} parsed - JSON-parsed model output (or null when unparseable).
 * @returns {{ valid: boolean, value: object|null, gaps: Array }}
 *   `value` is null only when nothing salvageable exists (null input or a
 *   non-object root). Otherwise every field is present and safe for
 *   downstream consumers, with all damage recorded in `gaps`.
 */
function validateExtraction(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, value: null, gaps: [gap('$', 'malformed-json', 'root is not a JSON object')] };
    }
    const gaps = [];
    const amounts = [];
    if (parsed.amounts === undefined || parsed.amounts === null) {
        // absent → empty, no gap (document may genuinely state no amounts)
    } else if (!Array.isArray(parsed.amounts)) {
        gaps.push(gap('amounts', 'schema-mismatch', 'expected an array'));
    } else {
        parsed.amounts.forEach((raw, index) => {
            const { value, gaps: itemGaps } = validateAmount(raw, index);
            gaps.push(...itemGaps);
            if (value) amounts.push(value);
        });
    }
    const propertyFlow = [];
    if (parsed.propertyFlow === undefined || parsed.propertyFlow === null) {
        // absent → empty, no gap
    } else if (!Array.isArray(parsed.propertyFlow)) {
        gaps.push(gap('propertyFlow', 'schema-mismatch', 'expected an array'));
    } else {
        parsed.propertyFlow.forEach((raw, index) => {
            const { value, gaps: itemGaps } = validatePropertyItem(raw, index);
            gaps.push(...itemGaps);
            if (value) propertyFlow.push(value);
        });
    }
    const { value: citedFilingReferences, gaps: refGaps } = validateStringArray(parsed.citedFilingReferences, 'citedFilingReferences');
    gaps.push(...refGaps);

    return {
        valid: gaps.length === 0,
        value: {
            caseNumber: asStringOrNull(parsed.caseNumber),
            decisionDate: asStringOrNull(parsed.decisionDate),
            summary: asStringOrNull(parsed.summary),
            amounts,
            propertyFlow,
            citedFilingReferences
        },
        gaps
    };
}

/**
 * Parses one field-repair response. Protocol: `{"value": <field value>,
 * "absent": true|false}`. `absent: true` accepts as empty (source does not
 * state the field) with no gap. Anything else is re-validated with the same
 * validators — a repair may return `unknown`/`not present` for a scalar, but
 * it must not invent a missing fact.
 */
function parseFieldRepairResponse(content, field) {
    const { extractJsonBlock } = require('../../helpers/jsonExtract');
    const parsed = extractJsonBlock(typeof content === 'string' ? content : '');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: 'repair response is not a JSON object' };
    }
    if (parsed.absent === true) {
        return { ok: true, absent: true, value: field === 'amounts' || field === 'propertyFlow' ? [] : null };
    }
    if (field === 'amounts' || field === 'propertyFlow') {
        if (!Array.isArray(parsed.value)) {
            return { ok: false, reason: 'repair value is not an array' };
        }
        const validate = field === 'amounts' ? validateAmount : validatePropertyItem;
        const values = [];
        const gaps = [];
        parsed.value.forEach((raw, index) => {
            const { value, gaps: itemGaps } = validate(raw, index);
            gaps.push(...itemGaps);
            if (value) values.push(value);
        });
        if (gaps.length > 0) return { ok: false, reason: 'repaired field still fails validation', gaps };
        return { ok: true, absent: false, value: values };
    }
    return { ok: false, reason: `field ${field} is not repairable` };
}

const FIELD_SPECS = {
    amounts: 'an "amounts" array with ONE item per table row — if the document contains an itemized table, register, or list (popis tražbina, diobeni popis, troškovnik, obračun), extract one item per row and never merge rows into a single summary amount; each item: {"description" (Croatian, required), "amount" (number), "currency" ("EUR"|"HRK"), "date", "direction" ("potraživanje"|"obveza"|"awarded"|"rejected"|"netted"), "amountRole" (one of "total"|"line_item"|"principal"|"cost"|"paid"|"fee" — the figure\'s function in the document: "total" for stated sums, "line_item" for table/register rows; omit when unclear), "eventType" ("prijava"|"ustup"|"namirenje"|"drugo", when the amount records a lifecycle event), "legalEffect" (one of "creates"|"modifies"|"supersedes"|"resolves"|"implements"|"unknown" — what this entry\'s document does to the claim/right; omit when unclear), "references" (array of registry/filing identifiers this entry explicitly cites besides its own filingReference; [] when none), "relationshipBasis" (one of "explicit_identifier"|"explicit_text"|"inferred" — how a "supersedes" link is evidenced; omit without supersedes), "payerName", "payerOib" (11 digits), "recipientName", "recipientOib", "amountEur"/"amountHrk" (only when the source states BOTH, verbatim), "isplatniRed", "claimRegistryNumber" ("redni broj"), "filingReference" ("poslovni broj"), "quote" (verbatim 1-2 sentences from the source text below, word-for-word, never paraphrased)}',
    propertyFlow: 'a "propertyFlow" array with ONE item per table row under the same row rule as amounts; also extract an operative receivable assignment/cession stated in prose ("Ugovor o ustupu", "cesija", assignment/transfer of a "tražbina") as at least one assetType "tražbina", eventType "ustup" entry — it is never absent merely because it has no table; each item: {"description" (Croatian, required), "identifier", "assetType" ("nekretnina"|"pokretnina"|"tražbina"|"drugo"), "transferor", "transferee", "value" (number), "currency" ("EUR"|"HRK"), "date", "quote" (verbatim as above), "legalEffect" and "references" and "relationshipBasis" (same meanings as for amounts); for "tražbina" also "eventType" ("prijava"|"ustup"|"namirenje"|"drugo"), "isplatniRed", "claimRegistryNumber", "filingReference", "supersedes" (short textual reference to the earlier lifecycle entry as cited in the source text)}'
};

/**
 * Builds the targeted single-field repair prompt against the ORIGINAL source
 * excerpt — never an earlier model summary.
 */
function buildFieldRepairPrompt({ field, sourceText }) {
    const spec = FIELD_SPECS[field];
    if (!spec) throw new Error(`Field ${field} is not repairable`);
    const excerpt = String(sourceText || '');
    return `FIELD REPAIR. A previous extraction of the court document below produced an unusable "${field}" value. Re-extract ONLY that field from the source text below.\n\nReturn ONLY a JSON object of the form {"value": <the re-extracted ${field} value per this spec>, "absent": true|false}. Set "absent" to true (with "value" null, or [] for arrays) when the source text does not state this field at all — never invent a missing fact. "value" must follow this spec: ${spec}${field === 'propertyFlow' ? ` ${VALUE_ROLE_GUIDANCE}` : ''}\n\nProvide ONLY the json object and nothing else. Text:\n\n${excerpt}`;
}

/**
 * Builds the full-extraction repair prompt used when the main completion was
 * entirely unparseable. Same schema, same source excerpt, tighter instruction.
 */
function buildFullRepairPrompt({ sourceText }) {
    const excerpt = String(sourceText || '');
    return `EXTRACTION REPAIR. A previous extraction of this court document produced no usable JSON. Extract key information from the source text below as a JSON object with keys: "caseNumber", "decisionDate", "summary" (one medium paragraph, Croatian), ${FIELD_SPECS.amounts} (as "amounts"; [] when none), ${FIELD_SPECS.propertyFlow} (as "propertyFlow"; [] when none). ${VALUE_ROLE_GUIDANCE} Also extract "citedFilingReferences" (array of "poslovni broj" values explicitly referenced; [] when none).\n\nProvide ONLY the json object and nothing else. Text:\n\n${excerpt}`;
}

module.exports = {
    EXTRACTION_SCHEMA_VERSION,
    TOP_LEVEL_FIELDS,
    REPAIRABLE_FIELDS,
    AMOUNT_DIRECTIONS,
    AMOUNT_ROLES,
    LEGAL_EFFECTS,
    RELATIONSHIP_BASES,
    CURRENCIES,
    ASSET_TYPES,
    VALUE_ROLES,
    EVENT_TYPES,
    FIELD_SPECS,
    validateExtraction,
    validateAmount,
    validatePropertyItem,
    parseFieldRepairResponse,
    buildFieldRepairPrompt,
    buildFullRepairPrompt
};
