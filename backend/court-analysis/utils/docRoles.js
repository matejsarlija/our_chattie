// court-analysis/utils/docRoles.js
//
// Document-role classification for stratified discovery (spec §6.2 / ticket
// TS-1). Pure metadata-only rules over titles/filenames — no acquisition, no
// model calls — so the stratifier can budget BEFORE downloading anything.
//
// Roles: `ledger` (registers, distribution lists, final accounts — few,
// vital, never droppable), `decision` (orders, judgments, conclusions),
// `transfer` (assignments/cessions, settlements — chain links), `filing`
// (submissions, appeals, motions, trustee reports), `admin` (powers of
// attorney, invoices, receipts — lowest priority, capped), `other` (default;
// ambiguous titles like bare `Prilog` land here and are served from the
// explicit exploratory reserve, never starved).
//
// Matching is normalized (diacritics/case) substring inclusion over the entry
// title plus all document-link texts, first matching role in the order above
// wins. A lite excerpt classifier may re-classify an ACQUIRED excerpt
// afterward (its spend counts against the exploratory reserve); that call
// lives outside this module by design — utils stay dependency-light so the
// CSV discovery path never drags the model stack into unit tests.

const { normalizeText } = require('./normalizeText');

const DOC_ROLES = ['ledger', 'decision', 'transfer', 'filing', 'admin', 'other'];

const ROLE_KEYWORDS = {
    ledger: [
        'diobeni', 'diobni popis', 'dioba',
        'zavrsni racun', 'zakljucni racun',
        'popis trazbina', 'prijavljene trazbine', 'tablica trazbina'
    ],
    decision: ['rjesenje', 'presuda', 'odluka', 'zakljucak'],
    transfer: ['ustup', 'cesija', 'namirenje', 'prijenos'],
    filing: [
        'podnesak', 'zalba', 'prijedlog', 'prigovor', 'odgovor', 'molba',
        'izvjesc', 'izvjestaj'
    ],
    admin: ['punomoc', 'racun', 'troskovnik', 'potvrda', 'iskaznica', 'izjava']
};

function entrySearchText(entry) {
    const parts = [];
    const info = entry?.caseInfo || {};
    if (typeof info.title === 'string' && info.title) parts.push(info.title);
    for (const link of Array.isArray(entry?.documentLinks) ? entry.documentLinks : []) {
        if (typeof link?.text === 'string' && link.text) parts.push(link.text);
    }
    // CSV-shape fallback: link text may live on caseInfo when documentLinks
    // were never mapped.
    if (typeof info.documentLinkText === 'string' && info.documentLinkText) parts.push(info.documentLinkText);
    return normalizeText(parts.join(' | '));
}

/**
 * Classifies one discovery entry into a document role.
 * @param {object} entry - Pipeline entry (caseInfo.title + documentLinks[].text).
 * @returns {'ledger'|'decision'|'transfer'|'filing'|'admin'|'other'}
 */
function classifyDocRole(entry) {
    const text = entrySearchText(entry);
    if (!text) return 'other';
    const title = normalizeText(String(entry?.caseInfo?.title || ''));
    for (const role of DOC_ROLES) {
        if (role === 'other') continue;
        const keywords = ROLE_KEYWORDS[role] || [];
        // A title containing nothing but "Podnesak" says no more about its
        // contents than a bare attachment label. Reserve it for the explicit
        // exploratory quota; a qualified submission ("Podnesak od …") still
        // uses the filing path below.
        if (role === 'filing' && title === 'podnesak') {
            // A generic file name such as Podnesak.pdf must not turn a bare
            // docket title into a substantive classification. Other filing
            // signals (appeal, motion, report) may still classify it below.
            if (keywords.filter((keyword) => keyword !== 'podnesak').some((keyword) => text.includes(keyword))) return role;
            continue;
        }
        if (keywords.some((keyword) => text.includes(keyword))) return role;
    }
    return 'other';
}

module.exports = {
    DOC_ROLES,
    ROLE_KEYWORDS,
    classifyDocRole
};
