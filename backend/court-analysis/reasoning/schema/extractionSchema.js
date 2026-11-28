// court-analysis/reasoning/schema/extractionSchema.js
//
// JSON schema for per-document extraction output (v5 / [R100-019]).
// Hand-rolled deterministic validators — no new dependencies, no model calls.

'use strict';

const EXTRACTION_SCHEMA_VERSION = 5;

const TOP_LEVEL_FIELDS = [
    'caseNumber',
    'decisionDate',
    'summary',
    'keyClaims',
    'decisionOutcome',
    'documentParties',
    'amounts',
    'tableRows',
    'propertyFlow',
    'citedFilingReferences',
    'proceduralEvents',
];

const REPAIRABLE_FIELDS = [
    'documentParties',
    'amounts',
    'propertyFlow',
    'proceduralEvents',
    'decisionOutcome',
];

const AMOUNT_DIRECTIONS = ['potraživanje', 'obveza', 'awarded', 'rejected', 'netted'];
const CURRENCIES = ['EUR', 'HRK'];
const ASSET_TYPES = ['nekretnina', 'pokretnina', 'tražbina', 'drugo'];
const EVENT_TYPES = ['prijava', 'ustup', 'namirenje', 'drugo'];
const PROCEDURAL_EVENT_TYPES = [
    'decision', 'appeal', 'appeal-response', 'appellate-decision',
    'correction', 'postponement', 'hearing', 'motion', 'other',
];
const PROCEDURAL_OUTCOMES = [
    'granted', 'dismissed', 'rejected', 'upheld', 'overturned',
    'modified', 'remanded', 'pending', 'unknown',
];
const PROCEDURAL_FINALITY = ['final', 'appealable', 'appealed', 'unknown'];
const AMOUNT_ROLES = ['total', 'line_item', 'principal', 'cost', 'paid', 'fee'];
const LEGAL_EFFECTS = ['creates', 'modifies', 'supersedes', 'resolves', 'implements', 'unknown'];
const VALUE_ROLES = ['claim_balance', 'transfer_consideration', 'payment_amount', 'asset_value', 'unknown'];
const RELATIONSHIP_BASES = ['explicit_identifier', 'explicit_text', 'inferred'];
const VALUE_ROLE_GUIDANCE = 'For every non-null propertyFlow.value, include valueRole: "claim_balance" only when the source explicitly states the outstanding claim balance; "transfer_consideration" for the price paid for an assignment; "payment_amount" for a payment or recovery; "asset_value" for another asset valuation; or "unknown" when the amount’s meaning cannot be established. Never treat a payment or assignment price as a remaining claim balance.';

const DECISION_OUTCOME_RULE = `"decisionOutcome" MUST be one of ${PROCEDURAL_OUTCOMES.map((v) => `"${v}"`).join(' | ')}, or null when this is not a court decision/ruling (for example a party submission, invoice, contract, claim table, or bank statement). For a Rješenje/Presuda, report ONLY this document's primary operative disposition in the izreka / riješio je / presudio je, NEVER outcomes of earlier rulings mentioned in obrazloženje. If the operative disposition is absent from this excerpt, return null. Map "usvaja se"/"prihvaća se" to "granted"; "odbija se" to "rejected"; "odbacuje se" to "dismissed"; "potvrđuje se" to "upheld"; "ukida se" to "overturned"; "preinačuje se" to "modified"; "vraća se na ponovni postupak" to "remanded". When an operative appellate clause rejects an appeal and also confirms the lower-court ruling, decisionOutcome MUST be "rejected" (the disposition of the appeal), not "upheld"; use "upheld" only when the ruling directly confirms a decision without explicitly rejecting or dismissing the appeal. For multiple items in the izreka, use the first substantive disposition for this top-level field and record other dispositions in proceduralEvents.`;

function asStringOrNull(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
}

/**
 * Parses numbers cleanly across plain numbers, standard decimals, and Croatian/European
 * thousands+decimal formatting (e.g. "1.200.000,00" -> 1200000, "27.682.562,91" -> 27682562.91).
 */
function asFiniteNumberOrNull(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;

    let cleaned = value.replace(/[\s\u00A0]+/g, '').trim();
    if (!cleaned) return null;

    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');

    if (lastDot !== -1 && lastComma !== -1) {
        if (lastComma > lastDot) {
            // European/Croatian: dots are thousands, comma is decimal ("1.200.000,00")
            cleaned = cleaned.replace(/\./g, '').replace(',', '.');
        } else {
            // US/English: commas are thousands, dot is decimal ("1,200,000.00")
            cleaned = cleaned.replace(/,/g, '');
        }
    } else if (lastComma !== -1) {
        if (/^-?\d{1,3}(?:,\d{3}){2,}$/.test(cleaned)) {
            cleaned = cleaned.replace(/,/g, '');
        } else {
            cleaned = cleaned.replace(/,/g, '.');
        }
    } else if (lastDot !== -1) {
        if (/^-?\d{1,3}(?:\.\d{3}){2,}$/.test(cleaned)) {
            cleaned = cleaned.replace(/\./g, '');
        }
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
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

function validateDocumentParty(raw, index) {
    const path = `documentParties[${index}]`;
    const gaps = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'document party is not an object')] };
    }
    const oib = asOibOrNull(raw.oib);
    const quote = asStringOrNull(raw.quote);
    if (!oib) gaps.push(gap(`${path}.oib`, 'schema-mismatch', 'expected an 11-digit source OIB'));
    if (!quote) gaps.push(gap(`${path}.quote`, 'schema-mismatch', 'missing source quote'));
    if (!oib || !quote) return { value: null, gaps };
    return {
        value: {
            name: asStringOrNull(raw.name),
            oib,
            role: asStringOrNull(raw.role),
            quote,
        },
        gaps,
    };
}

function validateDocumentParties(raw) {
    const documentParties = [];
    const gaps = [];
    if (raw === undefined || raw === null) return { value: documentParties, gaps };
    if (!Array.isArray(raw)) {
        return { value: documentParties, gaps: [gap('documentParties', 'schema-mismatch', 'expected an array')] };
    }
    raw.forEach((item, index) => {
        const result = validateDocumentParty(item, index);
        gaps.push(...result.gaps);
        if (result.value) documentParties.push(result.value);
    });
    return { value: documentParties, gaps };
}

function validateStringArray(raw, path) {
    if (raw === undefined || raw === null) return { value: [], gaps: [] };
    if (!Array.isArray(raw)) return { value: [], gaps: [gap(path, 'schema-mismatch', 'expected an array')] };
    return {
        value: raw.map((item) => String(item || '').trim()).filter(Boolean),
        gaps: [],
    };
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
            quote: asStringOrNull(raw.quote),
        },
        gaps,
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
            supersedes: asStringOrNull(raw.supersedes),
        },
        gaps,
    };
}

function validateProceduralEvent(raw, index) {
    const path = `proceduralEvents[${index}]`;
    const gaps = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'procedural event is not an object')] };
    }
    const description = asStringOrNull(raw.description);
    if (!description) {
        return { value: null, gaps: [gap(path, 'schema-mismatch', 'missing description; event unusable')] };
    }
    const eventType = asEnumOrNull(raw.eventType, PROCEDURAL_EVENT_TYPES);
    const outcome = asEnumOrNull(raw.outcome, PROCEDURAL_OUTCOMES);
    const finalityStated = raw.finalityStated === undefined || raw.finalityStated === null
        ? 'unknown'
        : asEnumOrNull(raw.finalityStated, PROCEDURAL_FINALITY);
    for (const [field, value, rawValue] of [
        ['eventType', eventType, raw.eventType],
        ['outcome', outcome, raw.outcome],
        ['finalityStated', finalityStated, raw.finalityStated],
    ]) {
        if (rawValue !== undefined && rawValue !== null && value === null) {
            gaps.push(gap(`${path}.${field}`, 'schema-mismatch', `unsupported ${field}: ${String(rawValue).slice(0, 40)}`));
        } else if ((field === 'eventType' || field === 'outcome') && value === null) {
            gaps.push(gap(`${path}.${field}`, 'schema-mismatch', `missing ${field}`));
        }
    }
    return {
        value: {
            eventType,
            instance: asStringOrNull(raw.instance),
            outcome,
            finalityStated,
            date: asStringOrNull(raw.date),
            filingReference: asStringOrNull(raw.filingReference),
            targetFilingReference: asStringOrNull(raw.targetFilingReference),
            description,
            quote: asStringOrNull(raw.quote),
        },
        gaps,
    };
}

/**
 * Deterministically expands compact `tableRows[]` into canonical `amounts[]`
 * (established claim as `line_item`, plus separate `paid` entry if payout present)
 * and `documentParties[]` (when an explicit 11-digit OIB + quote exist).
 */
function expandTableRows(tableRows, { caseFilingReference = null } = {}) {
    const amounts = [];
    const documentParties = [];
    if (!Array.isArray(tableRows) || tableRows.length === 0) {
        return { amounts, documentParties };
    }

    for (const raw of tableRows) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const creditor = asStringOrNull(raw.creditor ?? raw.name ?? raw.description);
        const description = asStringOrNull(raw.description) || creditor;
        if (!description) continue;

        const oib = asOibOrNull(raw.oib ?? raw.recipientOib);
        const quote = asStringOrNull(raw.quote);
        const role = asStringOrNull(raw.role) || 'vjerovnik';
        const rbr = asStringOrNull(raw.rbr ?? raw.claimRegistryNumber);
        const isplatniRed = asStringOrNull(raw.isplatniRed);
        const filingReference = asStringOrNull(raw.filingReference) || caseFilingReference || null;
        const date = asStringOrNull(raw.date);
        const direction = asEnumOrNull(raw.direction, AMOUNT_DIRECTIONS) || 'obveza';

        if (oib && quote) {
            documentParties.push({
                name: creditor,
                oib,
                role,
                quote,
            });
        }

        const estEur = asFiniteNumberOrNull(raw.establishedEur ?? raw.amountEur);
        const estHrk = asFiniteNumberOrNull(raw.establishedHrk ?? raw.amountHrk);
        const contestedEur = asFiniteNumberOrNull(raw.contestedEur);
        const explicitCurrency = asEnumOrNull(raw.currency, CURRENCIES);
        const primaryAmount = estEur ?? asFiniteNumberOrNull(raw.amount) ?? estHrk;
        const primaryCurrency = explicitCurrency || (estEur !== null ? 'EUR' : (estHrk !== null ? 'HRK' : 'EUR'));

        if (primaryAmount !== null) {
            amounts.push({
                description,
                amount: primaryAmount,
                currency: primaryCurrency,
                date,
                direction,
                amountRole: 'line_item',
                eventType: 'prijava',
                legalEffect: null,
                references: [],
                relationshipBasis: null,
                payerName: null,
                payerOib: null,
                recipientName: creditor,
                recipientOib: oib,
                amountEur: estEur,
                amountHrk: estHrk,
                isplatniRed,
                claimRegistryNumber: rbr,
                filingReference,
                quote,
            });
        }

        if (contestedEur !== null && contestedEur > 0) {
            amounts.push({
                description: `${description} (osporeno)`,
                amount: contestedEur,
                currency: 'EUR',
                date,
                direction: 'rejected',
                amountRole: 'line_item',
                eventType: 'drugo',
                legalEffect: null,
                references: [],
                relationshipBasis: null,
                payerName: null,
                payerOib: null,
                recipientName: creditor,
                recipientOib: oib,
                amountEur: contestedEur,
                amountHrk: null,
                isplatniRed,
                claimRegistryNumber: rbr,
                filingReference,
                quote,
            });
        }

        const paidEur = asFiniteNumberOrNull(raw.paidEur ?? raw.payoutEur);
        const paidHrk = asFiniteNumberOrNull(raw.paidHrk ?? raw.payoutHrk);
        const paidAmount = paidEur ?? paidHrk;
        if (paidAmount !== null && paidAmount > 0) {
            amounts.push({
                description: `${description} (namirenje)`,
                amount: paidAmount,
                currency: paidEur !== null ? 'EUR' : 'HRK',
                date,
                direction: 'obveza',
                amountRole: 'paid',
                eventType: 'namirenje',
                legalEffect: 'implements',
                references: [],
                relationshipBasis: null,
                payerName: null,
                payerOib: null,
                recipientName: creditor,
                recipientOib: oib,
                amountEur: paidEur,
                amountHrk: paidHrk,
                isplatniRed,
                claimRegistryNumber: rbr,
                filingReference,
                quote,
            });
        }
    }

    return { amounts, documentParties };
}

function validateKeyClaims(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((item) => asStringOrNull(item))
        .filter(Boolean)
        .map((s) => (s.length > 240 ? s.slice(0, 240) : s))
        .slice(0, 8);
}

function validateExtraction(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { valid: false, value: null, gaps: [gap('$', 'malformed-json', 'root is not a JSON object')] };
    }
    const gaps = [];
    const { value: explicitParties, gaps: partyGaps } = validateDocumentParties(parsed.documentParties);
    gaps.push(...partyGaps);

    const amounts = [];
    if (parsed.amounts === undefined || parsed.amounts === null) {
        // absent -> empty, no gap
    } else if (!Array.isArray(parsed.amounts)) {
        gaps.push(gap('amounts', 'schema-mismatch', 'expected an array'));
    } else {
        parsed.amounts.forEach((raw, index) => {
            const { value, gaps: itemGaps } = validateAmount(raw, index);
            gaps.push(...itemGaps);
            if (value) amounts.push(value);
        });
    }

    const expanded = expandTableRows(parsed.tableRows, {
        caseFilingReference: asStringOrNull(parsed.caseNumber),
    });
    const documentParties = [...explicitParties];
    const seenPartyOibs = new Set(documentParties.map((p) => p.oib));
    for (const tp of expanded.documentParties) {
        if (!seenPartyOibs.has(tp.oib)) {
            seenPartyOibs.add(tp.oib);
            documentParties.push(tp);
        }
    }
    const existingAmountKeys = new Set(
        amounts.map((a) => `${a.claimRegistryNumber || ''}|${a.recipientOib || ''}|${a.amount}|${a.amountRole || ''}`),
    );
    for (const ta of expanded.amounts) {
        const key = `${ta.claimRegistryNumber || ''}|${ta.recipientOib || ''}|${ta.amount}|${ta.amountRole || ''}`;
        if (!existingAmountKeys.has(key)) {
            existingAmountKeys.add(key);
            amounts.push(ta);
        }
    }

    const propertyFlow = [];
    if (parsed.propertyFlow === undefined || parsed.propertyFlow === null) {
        // absent -> empty, no gap
    } else if (!Array.isArray(parsed.propertyFlow)) {
        gaps.push(gap('propertyFlow', 'schema-mismatch', 'expected an array'));
    } else {
        parsed.propertyFlow.forEach((raw, index) => {
            const { value, gaps: itemGaps } = validatePropertyItem(raw, index);
            gaps.push(...itemGaps);
            if (value) propertyFlow.push(value);
        });
    }

    const proceduralEvents = [];
    if (parsed.proceduralEvents === undefined || parsed.proceduralEvents === null) {
        // absent -> empty, no gap
    } else if (!Array.isArray(parsed.proceduralEvents)) {
        gaps.push(gap('proceduralEvents', 'schema-mismatch', 'expected an array'));
    } else {
        parsed.proceduralEvents.forEach((raw, index) => {
            const { value, gaps: itemGaps } = validateProceduralEvent(raw, index);
            gaps.push(...itemGaps);
            if (value) proceduralEvents.push(value);
        });
    }

    const normalizedOutcome = asEnumOrNull(parsed.decisionOutcome, PROCEDURAL_OUTCOMES);
    if (parsed.decisionOutcome !== undefined
        && parsed.decisionOutcome !== null
        && String(parsed.decisionOutcome).trim() !== ''
        && normalizedOutcome === null) {
        gaps.push(gap('decisionOutcome', 'invalid-enum', `unsupported decision outcome: ${String(parsed.decisionOutcome).slice(0, 24)}`));
    }

    const { value: citedFilingReferences, gaps: refGaps } = validateStringArray(parsed.citedFilingReferences, 'citedFilingReferences');
    gaps.push(...refGaps);

    const keyClaims = validateKeyClaims(parsed.keyClaims);
    const summary = asStringOrNull(parsed.summary) || (keyClaims.length > 0 ? keyClaims.join(' ') : null);

    return {
        valid: gaps.length === 0,
        value: {
            caseNumber: asStringOrNull(parsed.caseNumber),
            decisionDate: asStringOrNull(parsed.decisionDate),
            summary,
            ...(keyClaims.length > 0 ? { keyClaims } : {}),
            decisionOutcome: normalizedOutcome,
            documentParties,
            amounts,
            propertyFlow,
            citedFilingReferences,
            proceduralEvents,
        },
        gaps,
    };
}

function hasUsableExtraction(value) {
    if (!value || typeof value !== 'object') return false;
    return Boolean(
        value.summary
        || value.caseNumber
        || value.decisionDate
        || value.decisionOutcome
        || (Array.isArray(value.keyClaims) && value.keyClaims.length > 0)
        || (Array.isArray(value.documentParties) && value.documentParties.length > 0)
        || (Array.isArray(value.amounts) && value.amounts.length > 0)
        || (Array.isArray(value.propertyFlow) && value.propertyFlow.length > 0)
        || (Array.isArray(value.citedFilingReferences) && value.citedFilingReferences.length > 0)
        || (Array.isArray(value.proceduralEvents) && value.proceduralEvents.length > 0),
    );
}

function hasReceivableAssignmentCue(sourceText) {
    const normalized = String(sourceText || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const assignment = /\b(?:ugovor(?:om|a|u|e)?\s+o\s+(?:ustupu|prijenosu)|ustup(?:a|u|om|anje|ljena|ljen|iti)?|cesij(?:a|om|e|u)?|cesion(?:ar)?)\b/.test(normalized);
    const receivable = /\b(?:trazbin|potrazivan)/.test(normalized);
    return assignment && receivable;
}

function parseFieldRepairResponse(content, field) {
    const { extractJsonBlock } = require('../../../llm/jsonExtract');
    const parsed = extractJsonBlock(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, reason: 'repair response is not a JSON object' };
    }
    if (parsed.absent === true) {
        return {
            ok: true,
            absent: true,
            value: ['documentParties', 'amounts', 'propertyFlow', 'proceduralEvents'].includes(field) ? [] : null,
        };
    }
    if (field === 'decisionOutcome') {
        if (parsed.value === null) {
            return { ok: true, absent: false, value: null };
        }
        const outcome = asEnumOrNull(parsed.value, PROCEDURAL_OUTCOMES);
        if (!outcome) {
            return { ok: false, reason: 'repaired decisionOutcome is not a valid procedural outcome' };
        }
        return { ok: true, absent: false, value: outcome };
    }
    if (['documentParties', 'amounts', 'propertyFlow', 'proceduralEvents'].includes(field)) {
        if (!Array.isArray(parsed.value)) {
            return { ok: false, reason: 'repair value is not an array' };
        }
        const validate = field === 'documentParties'
            ? validateDocumentParty
            : field === 'amounts'
                ? validateAmount
                : field === 'propertyFlow' ? validatePropertyItem : validateProceduralEvent;
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
    documentParties: 'a "documentParties" array of source-explicit party identities. Include only an OIB explicitly printed as a party tax identifier in this document, not OIBs inferred from supplied participant/registry context. One item per distinct OIB: {"name" (string or null if the source does not identify it), "oib" (exactly 11 digits), "role" (string or null; only if explicitly stated, otherwise null), "quote" (verbatim source text containing the OIB and enough nearby context to support the association)}. Do not guess roles or join an OIB to a name unless the quoted source makes the association clear; [] when none.',
    amounts: 'an "amounts" array with ONE item per table row — if the document contains an itemized table, register, invoice ("račun"), cost schedule ("troškovnik"), claim specification ("specifikacija"), bank account statement ("izvod"), or list (popis tražbina, diobeni popis, obračun), extract one item per row and never merge rows into a summary. Every individual data row/transaction in any markdown or plain-text table, invoice, cost schedule, specification, or statement MUST use amountRole "line_item" (never invent "other"); ONLY summary/footer rows explicitly labeled "UKUPNO", "SVEGA", or "SALDO" use "total". For a distribution row containing both an established claim ("utvrđena tražbina" HRK/EUR) and payout ("iznos namirenja"/"za isplatu"), emit separate facts: established claim as "line_item" with amountEur/amountHrk only for that claim\'s dual-currency values, and payout separately as "paid", never mixing payout into amountEur; each item: {"description" (Croatian, required), "amount" (number), "currency" ("EUR"|"HRK"), "date", "direction" ("potraživanje"|"obveza"|"awarded"|"rejected"|"netted"), "amountRole" (one of "total"|"line_item"|"principal"|"cost"|"paid"|"fee"), "eventType" ("prijava"|"ustup"|"namirenje"|"drugo", when the amount records a lifecycle event), "legalEffect" (one of "creates"|"modifies"|"supersedes"|"resolves"|"implements"|"unknown" — what this entry\'s document does to the claim/right; omit when unclear), "references" (array of registry/filing identifiers this entry explicitly cites besides its own filingReference; [] when none), "relationshipBasis" (one of "explicit_identifier"|"explicit_text"|"inferred" — how a "supersedes" link is evidenced; omit without supersedes), "payerName", "payerOib" (11 digits), "recipientName", "recipientOib", "amountEur"/"amountHrk" (only when the source states BOTH, verbatim), "isplatniRed", "claimRegistryNumber" ("redni broj"), "filingReference" ("poslovni broj"), "quote" (verbatim 1-2 sentences from the source text below, word-for-word, never paraphrased)}',
    propertyFlow: 'a "propertyFlow" array with ONE item per table row under the same row rule as amounts; also extract an operative receivable assignment/cession stated in prose ("Ugovor o ustupu", "cesija", assignment/transfer of a "tražbina") as at least one assetType "tražbina", eventType "ustup" entry — it is never absent merely because it has no table; each item: {"description" (Croatian, required), "identifier", "assetType" ("nekretnina"|"pokretnina"|"tražbina"|"drugo"), "transferor", "transferee", "value" (number), "currency" ("EUR"|"HRK"), "date", "quote" (verbatim as above), "legalEffect" and "references" and "relationshipBasis" (same meanings as for amounts); for "tražbina" also "eventType" ("prijava"|"ustup"|"namirenje"|"drugo"), "isplatniRed", "claimRegistryNumber", "filingReference", "supersedes" (short textual reference to the earlier lifecycle entry as cited in the source text)}',
    proceduralEvents: 'a "proceduralEvents" array with one explicit court-procedure event per item: {"eventType" ("decision"|"appeal"|"appeal-response"|"appellate-decision"|"correction"|"postponement"|"hearing"|"motion"|"other"), "instance" (court name or "first-instance"|"second-instance" when stated), "outcome" ("granted"|"dismissed"|"rejected"|"upheld"|"overturned"|"modified"|"remanded"|"pending"|"unknown"), "finalityStated" ("final"|"appealable"|"appealed"|"unknown"; assert final/appealable/appealed only when the source explicitly states this legal status, otherwise "unknown"), "date", "filingReference" (this document\'s own poslovni broj, only when explicit), "targetFilingReference" (the earlier filing this decision, appeal, response, or correction concerns, only when explicit), "description" (brief Croatian procedural action, required), and "quote" (verbatim source text supporting this event). Do not infer event, outcome, or finality from case posture or descriptions; [] when none.',
    decisionOutcome: DECISION_OUTCOME_RULE,
};

function buildFieldRepairPrompt({ field, sourceText }) {
    return require('../../extraction/prompts').buildFieldRepairPrompt({ field, sourceText });
}

function buildFullRepairPrompt({ sourceText }) {
    return require('../../extraction/prompts').buildFullRepairPrompt({ sourceText });
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
    PROCEDURAL_EVENT_TYPES,
    PROCEDURAL_OUTCOMES,
    PROCEDURAL_FINALITY,
    VALUE_ROLE_GUIDANCE,
    DECISION_OUTCOME_RULE,
    FIELD_SPECS,
    asFiniteNumberOrNull,
    expandTableRows,
    hasUsableExtraction,
    hasReceivableAssignmentCue,
    validateProceduralEvent,
    validateExtraction,
    validateAmount,
    validatePropertyItem,
    parseFieldRepairResponse,
    buildFieldRepairPrompt,
    buildFullRepairPrompt,
};
