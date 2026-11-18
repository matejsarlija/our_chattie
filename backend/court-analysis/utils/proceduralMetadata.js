'use strict';

const { normalizeText } = require('./normalizeText');

const CASE_REFERENCE_PATTERN = /\b([A-ZŽŠČĆĐ]{1,8}-\d+[-_/]\d{4}(?:[-_/]\d+){0,2})\b/giu;
const PROCEDURAL_TERMS = [
    ['appeal-response', /odgovor.{0,24}zalb|ocitovanje.{0,24}zalb/iu],
    ['appellate-decision', /vts\s*rh|visoki\s*trgovacki\s*sud|pz\s*[-/]/iu],
    ['correction', /ispravak|ispravlja/iu],
    ['postponement', /odgod/iu],
    ['hearing', /rocist|rasprav/iu],
    ['decision', /rjesen|presud|odluk|zakljuc/iu],
    ['motion', /prijedlog|prigovor|zahtjev/iu],
    ['appeal', /zalb/iu],
];

function normalizeFilingReference(value) {
    if (typeof value !== 'string') return null;
    const match = value.trim().match(/^([A-ZŽŠČĆĐ]{1,8})-(\d+)[/_-](\d{4})(?:[-_/](\d+))?(?:[-_/](\d+))?$/iu);
    if (!match) return null;
    const [, rawPrefix, caseNumber, year, firstSuffix, secondSuffix] = match;
    const lowerPrefix = rawPrefix.toLocaleLowerCase('hr-HR');
    const prefix = lowerPrefix.charAt(0).toLocaleUpperCase('hr-HR') + lowerPrefix.slice(1);
    // e-Oglasna attachment identifiers append a file ordinal to a St docket:
    // St-2_2013-1217-1 denotes filing St-2/2013-1217.
    if (prefix === 'St' && secondSuffix) {
        return `${prefix}-${caseNumber}/${year}-${firstSuffix}`;
    }
    const suffix = [firstSuffix, secondSuffix].filter(Boolean).join('-');
    return `${prefix}-${caseNumber}/${year}${suffix ? `-${suffix}` : ''}`;
}

function normalizedDate(value) {
    const match = String(value || '').match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
    if (!match) return null;
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function extractReferences(text) {
    const found = [];
    for (const match of String(text || '').matchAll(CASE_REFERENCE_PATTERN)) {
        const normalized = normalizeFilingReference(match[1]);
        if (normalized && !found.includes(normalized)) found.push(normalized);
    }
    return found;
}

function classifyEvent(text) {
    const normalized = normalizeText(text);
    for (const [type, pattern] of PROCEDURAL_TERMS) {
        if (pattern.test(normalized)) return type;
    }
    return /podnesak/iu.test(normalized) ? 'other' : null;
}

function extractStOwnReference(fileName) {
    const match = String(fileName || '').match(/\b(St-\d+)[/_](\d{4})[-_](\d+)(?:[-_](\d+))?\b/iu);
    if (!match) return null;
    return normalizeFilingReference(`${match[1]}/${match[2]}-${match[3]}`);
}

function explicitOutcome(text) {
    const normalized = normalizeText(text);
    if (/potvrdeno|potvrđeno|potvrdjeno|potvrđuje|potvrdjuje/iu.test(normalized)) return 'upheld';
    if (/preinaceno|preinačeno|preinacuje|preinačuje/iu.test(normalized)) return 'modified';
    if (/ukinuto|ukida|ukinuo/iu.test(normalized)) return 'overturned';
    if (/vraca.{0,30}ponovn/iu.test(normalized)) return 'remanded';
    return 'unknown';
}

function parseProceduralMetadataEntry({ title, documentNames, caseNumber, court } = {}) {
    const titleText = typeof title === 'string' ? title.trim() : '';
    const names = Array.isArray(documentNames)
        ? documentNames.filter((name) => typeof name === 'string' && name.trim())
        : typeof documentNames === 'string' ? documentNames.split(';').map((name) => name.trim()).filter(Boolean) : [];
    const context = [titleText, court, caseNumber, ...names].filter(Boolean).join(' | ');
    const result = [];
    const titleType = classifyEvent(titleText);

    if (titleType) {
        const refs = extractReferences(titleText);
        const normalizedCaseNumber = normalizeFilingReference(String(caseNumber || ''));
        const ownRef = refs.find((ref) => /^St-\d+\/\d{4}-\d+/iu.test(ref))
            || (normalizedCaseNumber?.match(/^St-\d+\/\d{4}-\d+/iu)?.[0] ?? null);
        const referenced = refs.filter((ref) => ref !== ownRef);
        result.push({
            eventType: titleType,
            instance: /vts\s*rh|visoki\s*trgovacki\s*sud/iu.test(normalizeText(context))
                ? 'VTS RH'
                : /trgovacki\s*sud|\b1\.?\s*st\.?/iu.test(normalizeText(`${court || ''} ${titleText}`))
                    ? 'first-instance' : null,
            filingReference: ownRef,
            appellateCaseNumbers: referenced.filter((ref) => !/^St-/iu.test(ref)),
            referencedFilingReferences: referenced.filter((ref) => /^St-/iu.test(ref)),
            date: normalizedDate(titleText),
            statedOutcome: explicitOutcome(context),
            finalityStated: /pravomoćn/iu.test(context) ? 'final' : 'unknown',
            description: titleText || 'Metapodaci o sudskom događaju',
            source: 'metadata',
        });
    }

    for (const name of names) {
        const ownRef = extractStOwnReference(name);
        const refs = extractReferences(name);
        const eventType = classifyEvent(name);
        const outcome = explicitOutcome(name);
        if (!ownRef) {
            if (result.length && outcome !== 'unknown') {
                result[0].statedOutcome = outcome;
            }
            if (result.length) {
                result[0].referencedFilingReferences = [...new Set([
                    ...result[0].referencedFilingReferences,
                    ...refs.filter((ref) => ref !== result[0].filingReference && /^St-/iu.test(ref)),
                ])];
                result[0].appellateCaseNumbers = [...new Set([
                    ...result[0].appellateCaseNumbers,
                    ...refs.filter((ref) => ref !== result[0].filingReference && !/^St-/iu.test(ref)),
                ])];
            }
            continue;
        }
        const referenced = refs.filter((ref) => ref !== ownRef);
        result.push({
            eventType: eventType || 'other',
            instance: /vts\s*rh|visoki\s*trgovacki\s*sud/iu.test(normalizeText(name)) ? 'VTS RH'
                : /\bpz\s*[-/]/iu.test(normalizeText(name)) ? 'second-instance'
                    : /\b[1I]\.?\s*st\.?/iu.test(normalizeText(name)) ? 'first-instance' : null,
            filingReference: ownRef,
            appellateCaseNumbers: referenced.filter((ref) => !/^St-/iu.test(ref)),
            referencedFilingReferences: referenced.filter((ref) => /^St-/iu.test(ref)),
            date: normalizedDate(name),
            statedOutcome: outcome,
            finalityStated: /pravomoćn/iu.test(name) ? 'final' : 'unknown',
            description: name,
            source: 'metadata',
        });
    }
    return result;
}

module.exports = { normalizeFilingReference, parseProceduralMetadataEntry };
