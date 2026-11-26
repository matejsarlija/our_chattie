'use strict';

const CORPORATE_SUFFIX_RE = /\b(d\.?\s*o\.?\s*o\.?|j\.?\s*d\.?\s*o\.?\s*o\.?|d\.?\s*d\.?|k\.?\s*d\.?|j\.?\s*t\.?\s*d\.?|u\s+ste[cč]aju|u\s+likvidaciji)\b/gi;

function cleanString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function extractValidOib(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const match = String(value).match(/\b(\d{11})\b/);
    return match ? match[1] : null;
}

function normalizePartyName(name) {
    if (typeof name !== 'string') return '';
    return name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toLowerCase()
        .replace(CORPORATE_SUFFIX_RE, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildCanonicalParties(analyses = [], entries = []) {
    const byId = new Map();
    const oibByNormalizedName = new Map();

    const recordSighting = ({ name, oib, role, docId = null }) => {
        const cleanName = cleanString(name);
        const validOib = extractValidOib(oib);
        const normName = normalizePartyName(cleanName || '');
        if (!validOib && !normName) return null;

        if (validOib && normName && !oibByNormalizedName.has(normName)) {
            oibByNormalizedName.set(normName, validOib);
        }
        const resolvedOib = validOib || (normName ? oibByNormalizedName.get(normName) || null : null);
        const canonicalPartyId = resolvedOib ? `oib:${resolvedOib}` : `name:${normName}`;

        if (!byId.has(canonicalPartyId)) {
            byId.set(canonicalPartyId, {
                canonicalPartyId,
                name: cleanName || resolvedOib,
                oib: resolvedOib,
                normalizedName: normName || null,
                roles: new Set(),
                aliases: new Set(),
                docIds: new Set(),
            });
        }
        const entry = byId.get(canonicalPartyId);
        if (cleanName) {
            entry.aliases.add(cleanName);
            if (!entry.name || (cleanName.length > entry.name.length && entry.name.length < 8)) {
                entry.name = cleanName;
            }
        }
        if (resolvedOib && !entry.oib) entry.oib = resolvedOib;
        if (normName && !entry.normalizedName) entry.normalizedName = normName;
        const cleanRole = cleanString(role);
        if (cleanRole) entry.roles.add(cleanRole.toLowerCase());
        if (docId) entry.docIds.add(docId);
        return canonicalPartyId;
    };

    // Pass 1: seed OIB->name mappings from entries and analyses so name-only sightings can link to OIBs.
    for (const entry of Array.isArray(entries) ? entries : []) {
        const participants = entry?.caseInfo?.participants || entry?.participants || [];
        for (const p of Array.isArray(participants) ? participants : []) {
            if (!p || typeof p !== 'object') continue;
            const validOib = extractValidOib(p.oib);
            const normName = normalizePartyName(p.name || '');
            if (validOib && normName && !oibByNormalizedName.has(normName)) {
                oibByNormalizedName.set(normName, validOib);
            }
        }
    }
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        const candidates = [
            ...(Array.isArray(analysis?.parties) ? analysis.parties : []),
            ...(Array.isArray(analysis?.documentParties) ? analysis.documentParties : []),
        ];
        for (const p of candidates) {
            if (!p || typeof p !== 'object') continue;
            const validOib = extractValidOib(p.oib);
            const normName = normalizePartyName(p.name || '');
            if (validOib && normName && !oibByNormalizedName.has(normName)) {
                oibByNormalizedName.set(normName, validOib);
            }
        }
        for (const amt of Array.isArray(analysis?.amounts) ? analysis.amounts : []) {
            if (!amt || typeof amt !== 'object') continue;
            const pOib = extractValidOib(amt.payerOib);
            const pNorm = normalizePartyName(amt.payerName || '');
            if (pOib && pNorm && !oibByNormalizedName.has(pNorm)) oibByNormalizedName.set(pNorm, pOib);
            const rOib = extractValidOib(amt.recipientOib);
            const rNorm = normalizePartyName(amt.recipientName || '');
            if (rOib && rNorm && !oibByNormalizedName.has(rNorm)) oibByNormalizedName.set(rNorm, rOib);
        }
        for (const prop of Array.isArray(analysis?.propertyFlow) ? analysis.propertyFlow : []) {
            if (!prop || typeof prop !== 'object') continue;
            const trOib = extractValidOib(prop.transferorOib);
            const trNorm = normalizePartyName(prop.transferor || '');
            if (trOib && trNorm && !oibByNormalizedName.has(trNorm)) oibByNormalizedName.set(trNorm, trOib);
            const teOib = extractValidOib(prop.transfereeOib);
            const teNorm = normalizePartyName(prop.transferee || '');
            if (teOib && teNorm && !oibByNormalizedName.has(teNorm)) oibByNormalizedName.set(teNorm, teOib);
        }
    }

    // Pass 2: record all canonical party sightings.
    for (const entry of Array.isArray(entries) ? entries : []) {
        const participants = entry?.caseInfo?.participants || entry?.participants || [];
        for (const p of Array.isArray(participants) ? participants : []) {
            if (p && typeof p === 'object') {
                recordSighting({ name: p.name, oib: p.oib, role: p.role });
            }
        }
    }
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        const docId = analysis?.docId || analysis?.id || null;
        for (const p of Array.isArray(analysis?.parties) ? analysis.parties : []) {
            if (p && typeof p === 'object') {
                recordSighting({ name: p.name, oib: p.oib, role: p.role, docId });
            }
        }
        for (const p of Array.isArray(analysis?.documentParties) ? analysis.documentParties : []) {
            if (p && typeof p === 'object') {
                recordSighting({ name: p.name, oib: p.oib, role: p.role, docId });
            }
        }
        for (const amt of Array.isArray(analysis?.amounts) ? analysis.amounts : []) {
            if (!amt || typeof amt !== 'object') continue;
            recordSighting({ name: amt.payerName, oib: amt.payerOib, role: 'platitelj', docId });
            recordSighting({ name: amt.recipientName, oib: amt.recipientOib, role: 'primatelj', docId });
        }
        for (const prop of Array.isArray(analysis?.propertyFlow) ? analysis.propertyFlow : []) {
            if (!prop || typeof prop !== 'object') continue;
            recordSighting({ name: prop.transferor, oib: prop.transferorOib, role: 'prenositelj', docId });
            recordSighting({ name: prop.transferee, oib: prop.transfereeOib, role: 'stjecatelj', docId });
        }
    }

    const resolve = (name, oib = null) => {
        const validOib = extractValidOib(oib);
        if (validOib) return `oib:${validOib}`;
        const normName = normalizePartyName(name || '');
        if (!normName) return null;
        const mappedOib = oibByNormalizedName.get(normName);
        return mappedOib ? `oib:${mappedOib}` : `name:${normName}`;
    };

    const parties = Array.from(byId.values())
        .map((item) => ({
            canonicalPartyId: item.canonicalPartyId,
            name: item.name,
            oib: item.oib,
            normalizedName: item.normalizedName,
            roles: Array.from(item.roles).sort(),
            aliases: Array.from(item.aliases).sort(),
            documentCount: item.docIds.size,
        }))
        .sort((a, b) => b.documentCount - a.documentCount || String(a.name).localeCompare(String(b.name), 'hr'));

    return { parties, resolve };
}

module.exports = {
    extractValidOib,
    normalizePartyName,
    buildCanonicalParties,
};
