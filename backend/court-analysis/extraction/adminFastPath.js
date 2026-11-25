'use strict';

const path = require('node:path');
const { classifyDocRole } = require('../utils/docRoles');
const { normalizeText } = require('../utils/normalizeText');

const ADMIN_FAST_PATH_MAX_CHARS = 1000;
const CURRENCY_FIGURE_RE = /\d+[.,]\d{2}/;
const CURRENCY_UNIT_RE = /\b(?:EUR|HRK|kn|kuna|eura)\b/i;
const CESSION_CUE_RE = /\b(?:ustup\w*|cesij\w*|ugovor\w*)\b/i;

const FILING_REF_RE = /\b(?:\d+\s+)?(?:Povrv|Povpr|Pžm|Pž|Pp|Pr|Ps|Pz|P|Stpn|Sts|Stv|St|Gžm|Gž|Revr|Rev|Ovrv|Ovr|Kir|Kžm|Kž|K|Sp|Su|Tt|Isp|Ik|Im|In|Ip|Is|Us|U|Žs|Ž|R1|R)[-\s]\d+\/\d{4}(?:-\d+)?\b/giu;
const NUMERIC_DATE_RE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\.?\b/;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const OIB_RE = /\b(\d{11})\b/g;

function resolveDocRole(file, explicitRole = null) {
    if (explicitRole) return explicitRole;
    const fileName = file?.text || file?.fileName || path.basename(file?.filePath || '');
    return classifyDocRole({
        caseInfo: { title: file?.entryTitle || fileName },
        documentLinks: [{ text: fileName }],
    });
}

function canUseAdminFastPath({ text, docRole = null, docClass = 'digital_text', file = null } = {}) {
    if (docClass && !['digital_text', 'txt', 'docx', 'doc'].includes(docClass)) {
        return false;
    }
    const role = resolveDocRole(file, docRole);
    if (role !== 'admin') return false;

    const raw = String(text || '').trim();
    if (raw.length === 0 || raw.length >= ADMIN_FAST_PATH_MAX_CHARS) return false;
    const withoutDates = raw.replace(/\b\d{1,2}\.\d{1,2}\.\d{4}\.?\b/g, ' ');
    if (CURRENCY_FIGURE_RE.test(withoutDates) || CURRENCY_UNIT_RE.test(withoutDates)) return false;

    const folded = normalizeText(raw);
    if (CESSION_CUE_RE.test(folded)) return false;
    return true;
}

function extractDateIso(text) {
    const iso = ISO_DATE_RE.exec(text);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const dmy = NUMERIC_DATE_RE.exec(text);
    if (dmy) {
        const day = dmy[1].padStart(2, '0');
        const month = dmy[2].padStart(2, '0');
        const year = dmy[3];
        return `${year}-${month}-${day}`;
    }
    return null;
}

function extractDocumentPartiesFromLines(text) {
    const parties = [];
    const seenOibs = new Set();
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
        const matches = [...line.matchAll(OIB_RE)];
        for (const match of matches) {
            const oib = match[1];
            if (seenOibs.has(oib)) continue;
            seenOibs.add(oib);
            const quote = line.trim();
            if (!quote) continue;
            const beforeOib = quote.slice(0, quote.indexOf(oib)).replace(/[,:;\-\s]+$/g, '').replace(/\bOIB\b[:\s]*$/i, '').trim();
            const name = beforeOib.length >= 2 && beforeOib.length <= 120 ? beforeOib : null;
            parties.push({
                name,
                oib,
                role: null,
                quote,
            });
        }
    }
    return parties;
}

function extractAdminNoticeFastPath({ text, file = null, caseInfo = null } = {}) {
    const source = String(text || '').trim();
    const filings = [...new Set((source.match(FILING_REF_RE) || []).map((ref) => ref.trim()))];
    const caseNumber = filings[0] || caseInfo?.caseNumber || null;
    const citedFilingReferences = filings.slice(1);
    const decisionDate = extractDateIso(source) || file?.entryDate || null;
    const documentParties = extractDocumentPartiesFromLines(source);
    const firstLine = source.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    const fileName = file?.text || file?.fileName || path.basename(file?.filePath || 'administrativni dokument');
    const summary = firstLine
        ? `Administrativni podnesak (${fileName}): ${firstLine.slice(0, 180)}`
        : `Administrativni podnesak (${fileName}) bez financijskih stavki.`;

    return {
        caseNumber,
        decisionDate,
        summary,
        decisionOutcome: null,
        documentParties,
        amounts: [],
        propertyFlow: [],
        citedFilingReferences,
        proceduralEvents: [],
        keyClaims: [summary.slice(0, 160)],
        parties: caseInfo?.participants || [],
        adminFastPath: true,
    };
}

module.exports = {
    ADMIN_FAST_PATH_MAX_CHARS,
    canUseAdminFastPath,
    extractAdminNoticeFastPath,
};
