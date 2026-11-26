// court-analysis/reasoning/factLedger.js
//
// Evidence/fact ledger (spec §4.3 / §4.6): normalized row-level facts across
// 4 canonical kinds ('amount' | 'property' | 'party' | 'procedural_outcome')
// with deterministic content-hashed row IDs, full source provenance, and
// canonical party resolution.

const crypto = require('crypto');
const { normalizeText } = require('../retrieval/indexer');
const { parseAmount } = require('./flow');
const { buildCanonicalParties } = require('./partyRegistry');

function cleanString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function cleanInt(value) {
    return Number.isInteger(value) ? value : null;
}

function docIdentity(analysis) {
    const analysisId = analysis?.id || null;
    const docId = analysis?.docId || analysisId || null;
    return {
        analysisId,
        docId,
        fileName: analysis?.fileName || null,
        caseNumber: analysis?.caseNumber || null,
        entryDate: analysis?.entryDate || null,
        sourceEntryIndex: Number.isInteger(analysis?.sourceEntryIndex) ? analysis.sourceEntryIndex : null,
        sourceDocumentLinkId: analysis?.sourceDocumentLinkId || null,
        contentHash: typeof analysis?.contentHash === 'string' && analysis.contentHash ? analysis.contentHash : null
    };
}

function filingRef(doc) {
    return {
        sourceId: doc.analysisId || doc.docId || null,
        analysisId: doc.analysisId,
        docId: doc.docId || null,
        fileName: doc.fileName,
        sourceEntryIndex: doc.sourceEntryIndex,
        sourceDocumentLinkId: doc.sourceDocumentLinkId
    };
}

function computeRowId(row, ordinal = 0) {
    const docSource = row?.doc?.contentHash
        || row?.doc?.docId
        || row?.doc?.sourceDocumentLinkId
        || row?.doc?.analysisId
        || row?.doc?.fileName
        || 'unknown-doc';
    const digest = crypto
        .createHash('sha256')
        .update([docSource, ledgerRowKey(row), String(ordinal)].join('\0'))
        .digest('hex')
        .slice(0, 20);
    return `fact-${digest}`;
}

/**
 * Builds normalized ledger rows from attached analyses across all 4 kinds:
 * 'amount' | 'property' | 'party' | 'procedural_outcome'.
 */
function buildFactLedger(analyses, { partyRegistry = null } = {}) {
    const list = Array.isArray(analyses) ? analyses : [];
    const registry = partyRegistry || buildCanonicalParties(list);
    const rows = [];

    for (const analysis of list) {
        const doc = docIdentity(analysis);
        const docSeenCounts = new Map();
        const pushRow = (row) => {
            const baseKey = ledgerRowKey(row);
            const ordinal = docSeenCounts.get(baseKey) || 0;
            docSeenCounts.set(baseKey, ordinal + 1);
            row.id = computeRowId(row, ordinal);
            rows.push(row);
        };

        for (const raw of Array.isArray(analysis?.amounts) ? analysis.amounts : []) {
            if (!raw || typeof raw !== 'object') continue;
            const payerName = cleanString(raw.payerName);
            const payerOib = cleanString(raw.payerOib);
            const recipientName = cleanString(raw.recipientName);
            const recipientOib = cleanString(raw.recipientOib);
            const payerCanonicalPartyId = registry.resolve(payerName, payerOib);
            const recipientCanonicalPartyId = registry.resolve(recipientName, recipientOib);
            const canonicalPartyId = recipientCanonicalPartyId || payerCanonicalPartyId || null;
            pushRow({
                kind: 'amount',
                docId: doc.docId,
                doc,
                description: cleanString(raw.description),
                value: parseAmount(raw.amount ?? raw.value),
                currency: cleanString(raw.currency),
                valueEur: parseAmount(raw.amountEur ?? raw.valueEur),
                amountHrk: parseAmount(raw.amountHrk),
                date: cleanString(raw.date),
                direction: cleanString(raw.direction),
                amountRole: cleanString(raw.amountRole),
                eventType: cleanString(raw.eventType),
                valueRole: cleanString(raw.valueRole),
                quote: cleanString(raw.quote),
                crossCategoryFactId: null,
                legalEffect: cleanString(raw.legalEffect),
                references: Array.isArray(raw.references) ? raw.references.filter((r) => typeof r === 'string' && r.trim()) : [],
                relationshipBasis: cleanString(raw.relationshipBasis),
                canonicalPartyId,
                parties: {
                    payerName,
                    payerOib,
                    payerCanonicalPartyId,
                    recipientName,
                    recipientOib,
                    recipientCanonicalPartyId,
                    transferor: cleanString(raw.transferor),
                    transferorOib: cleanString(raw.transferorOib),
                    transferee: cleanString(raw.transferee),
                    transfereeOib: cleanString(raw.transfereeOib),
                },
                isplatniRed: cleanString(raw.isplatniRed),
                claimRegistryNumber: cleanString(raw.claimRegistryNumber),
                filingReference: cleanString(raw.filingReference),
                grounded: raw.grounded === true,
                sourcePages: Array.isArray(raw.sourcePages) ? [...raw.sourcePages] : [],
                sourceChunkId: raw.sourceChunkId ?? null,
                sourceStartIndex: cleanInt(raw.sourceStartIndex),
                sourceEndIndex: cleanInt(raw.sourceEndIndex),
                page: null,
                filings: [filingRef(doc)]
            });
        }

        for (const raw of Array.isArray(analysis?.propertyFlow) ? analysis.propertyFlow : []) {
            if (!raw || typeof raw !== 'object') continue;
            const transferor = cleanString(raw.transferor);
            const transferorOib = cleanString(raw.transferorOib);
            const transferee = cleanString(raw.transferee);
            const transfereeOib = cleanString(raw.transfereeOib);
            const transferorCanonicalPartyId = registry.resolve(transferor, transferorOib);
            const transfereeCanonicalPartyId = registry.resolve(transferee, transfereeOib);
            const canonicalPartyId = transfereeCanonicalPartyId || transferorCanonicalPartyId || null;
            pushRow({
                kind: 'property',
                docId: doc.docId,
                doc,
                description: cleanString(raw.description),
                value: parseAmount(raw.value ?? raw.amount),
                currency: cleanString(raw.currency),
                valueEur: parseAmount(raw.valueEur ?? raw.amountEur),
                valueHrk: parseAmount(raw.valueHrk ?? raw.amountHrk),
                date: cleanString(raw.date),
                direction: cleanString(raw.direction),
                amountRole: null,
                eventType: cleanString(raw.eventType),
                valueRole: cleanString(raw.valueRole),
                quote: cleanString(raw.quote),
                crossCategoryFactId: null,
                legalEffect: cleanString(raw.legalEffect),
                references: Array.isArray(raw.references) ? raw.references.filter((r) => typeof r === 'string' && r.trim()) : [],
                relationshipBasis: cleanString(raw.relationshipBasis),
                canonicalPartyId,
                transferorOib,
                transfereeOib,
                parties: {
                    payerName: cleanString(raw.payerName),
                    payerOib: cleanString(raw.payerOib),
                    recipientName: cleanString(raw.recipientName),
                    recipientOib: cleanString(raw.recipientOib),
                    transferor,
                    transferorOib,
                    transferorCanonicalPartyId,
                    transferee,
                    transfereeOib,
                    transfereeCanonicalPartyId,
                },
                identifier: cleanString(raw.identifier),
                assetType: cleanString(raw.assetType),
                isplatniRed: cleanString(raw.isplatniRed),
                claimRegistryNumber: cleanString(raw.claimRegistryNumber),
                filingReference: cleanString(raw.filingReference),
                supersedes: cleanString(raw.supersedes),
                grounded: raw.grounded === true,
                sourcePages: Array.isArray(raw.sourcePages) ? [...raw.sourcePages] : [],
                sourceChunkId: raw.sourceChunkId ?? null,
                sourceStartIndex: cleanInt(raw.sourceStartIndex),
                sourceEndIndex: cleanInt(raw.sourceEndIndex),
                page: null,
                filings: [filingRef(doc)]
            });
        }

        const docParties = Array.isArray(analysis?.documentParties) ? analysis.documentParties : [];
        for (const raw of docParties) {
            if (!raw || typeof raw !== 'object') continue;
            const name = cleanString(raw.name);
            const oib = cleanString(raw.oib);
            const role = cleanString(raw.role);
            if (!name && !oib) continue;
            const canonicalPartyId = registry.resolve(name, oib);
            pushRow({
                kind: 'party',
                docId: doc.docId,
                doc,
                description: [name, role ? `(${role})` : null].filter(Boolean).join(' ') || oib,
                value: null,
                currency: null,
                valueEur: null,
                date: cleanString(raw.date) || doc.entryDate || null,
                direction: null,
                amountRole: null,
                eventType: 'party_sighting',
                quote: cleanString(raw.quote),
                crossCategoryFactId: null,
                legalEffect: null,
                references: [],
                relationshipBasis: null,
                canonicalPartyId,
                parties: {
                    name,
                    oib,
                    role,
                    canonicalPartyId,
                },
                filingReference: cleanString(raw.filingReference) || doc.caseNumber || null,
                grounded: raw.grounded === true,
                sourcePages: Array.isArray(raw.sourcePages) ? [...raw.sourcePages] : [],
                sourceChunkId: raw.sourceChunkId ?? null,
                sourceStartIndex: cleanInt(raw.sourceStartIndex),
                sourceEndIndex: cleanInt(raw.sourceEndIndex),
                page: null,
                filings: [filingRef(doc)]
            });
        }

        for (const raw of Array.isArray(analysis?.proceduralEvents) ? analysis.proceduralEvents : []) {
            if (!raw || typeof raw !== 'object') continue;
            pushRow({
                kind: 'procedural_outcome',
                docId: doc.docId,
                doc,
                description: cleanString(raw.description),
                value: null,
                currency: null,
                valueEur: null,
                date: cleanString(raw.date) || doc.entryDate || null,
                direction: null,
                amountRole: null,
                eventType: cleanString(raw.eventType) || 'decision',
                outcome: cleanString(raw.outcome),
                instance: cleanString(raw.instance),
                finalityStated: cleanString(raw.finalityStated),
                targetFilingReference: cleanString(raw.targetFilingReference),
                quote: cleanString(raw.quote),
                crossCategoryFactId: null,
                legalEffect: cleanString(raw.legalEffect),
                references: Array.isArray(raw.references) ? raw.references.filter((r) => typeof r === 'string' && r.trim()) : [],
                relationshipBasis: null,
                canonicalPartyId: null,
                parties: {},
                filingReference: cleanString(raw.filingReference) || doc.caseNumber || null,
                grounded: raw.grounded === true,
                sourcePages: Array.isArray(raw.sourcePages) ? [...raw.sourcePages] : [],
                sourceChunkId: raw.sourceChunkId ?? null,
                sourceStartIndex: cleanInt(raw.sourceStartIndex),
                sourceEndIndex: cleanInt(raw.sourceEndIndex),
                page: null,
                filings: [filingRef(doc)]
            });
        }
    }

    return annotateCrossCategoryEchoes(rows);
}

function annotateCrossCategoryEchoes(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (!['amount', 'property'].includes(row?.kind)
            || !Number.isFinite(row.value)
            || !row.currency
            || typeof row.quote !== 'string'
            || !row.quote.trim()) continue;
        const source = row.doc?.contentHash || row.doc?.sourceDocumentLinkId || row.doc?.analysisId;
        if (!source) continue;
        const key = [
            source,
            normalizeText(row.quote),
            row.value,
            row.currency,
        ].join('::');
        if (!groups.has(key)) groups.set(key, { amount: [], property: [] });
        groups.get(key)[row.kind].push(row);
    }

    const compatible = (left, right) => {
        const bothMatch = (a, b) => !a || !b || normalizeText(a) === normalizeText(b);
        return bothMatch(left.date, right.date)
            && bothMatch(left.eventType, right.eventType)
            && bothMatch(left.claimRegistryNumber, right.claimRegistryNumber)
            && bothMatch(left.filingReference, right.filingReference);
    };
    for (const [key, group] of groups) {
        if (group.amount.length !== 1 || group.property.length !== 1) continue;
        const [amount] = group.amount;
        const [property] = group.property;
        if (!compatible(amount, property)) continue;
        const id = `cross-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 24)}`;
        amount.crossCategoryFactId = id;
        property.crossCategoryFactId = id;
    }
    return rows;
}

function ledgerRowKey(row) {
    const p = row?.parties || {};
    const parts = [
        row.kind || '',
        normalizeText(row.description || ''),
        String(row.value ?? ''),
        row.currency || '',
        normalizeText(row.date || ''),
        normalizeText(row.direction || ''),
        normalizeText(row.amountRole || ''),
        normalizeText(row.valueRole || ''),
        normalizeText(row.eventType || ''),
        normalizeText(row.legalEffect || ''),
        normalizeText(row.quote || ''),
        normalizeText(row.claimRegistryNumber || ''),
        normalizeText(row.filingReference || ''),
        normalizeText(row.assetType || ''),
        normalizeText(row.identifier || ''),
        normalizeText(row.isplatniRed || ''),
        normalizeText(row.supersedes || ''),
        normalizeText(row.outcome || ''),
        normalizeText(row.instance || ''),
        normalizeText(row.targetFilingReference || ''),
        normalizeText(row.canonicalPartyId || ''),
        normalizeText(p.payerName || ''),
        normalizeText(p.payerOib || ''),
        normalizeText(p.recipientName || ''),
        normalizeText(p.recipientOib || ''),
        normalizeText(p.transferor || ''),
        normalizeText(p.transferorOib || ''),
        normalizeText(p.transferee || ''),
        normalizeText(p.transfereeOib || ''),
        normalizeText(p.name || ''),
        normalizeText(p.oib || ''),
        normalizeText(p.role || ''),
    ];
    return parts.join('::');
}

function rowContentKey(row) {
    return row?.doc?.contentHash || null;
}

/**
 * Collapses byte-identical attachment duplicates: rows whose document bytes
 * hash equally AND whose normalized fact content matches become one row with
 * merged `filings` (every filing that attached the document is retained).
 * Rows without a content hash never merge — without bytes, identity cannot
 * be proven and merging would risk conflating distinct filings.
 */
function dedupeLedgerRows(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const byKey = new Map();
    const output = [];
    for (const row of list) {
        const contentKey = rowContentKey(row);
        if (!contentKey) {
            output.push({
                ...row,
                id: row.id || computeRowId(row, output.length),
                filings: Array.isArray(row.filings) ? [...row.filings] : [],
            });
            continue;
        }
        const key = `${contentKey}::${ledgerRowKey(row)}`;
        if (!byKey.has(key)) {
            const kept = {
                ...row,
                id: row.id || computeRowId(row, output.length),
                filings: [],
            };
            byKey.set(key, kept);
            output.push(kept);
        }
        const kept = byKey.get(key);
        for (const filing of Array.isArray(row.filings) ? row.filings : [filingRef(row.doc)]) {
            if (!filing || kept.filings.some((f) =>
                f.sourceId === filing.sourceId
                && f.analysisId === filing.analysisId
                && f.sourceEntryIndex === filing.sourceEntryIndex
                && f.sourceDocumentLinkId === filing.sourceDocumentLinkId
            )) continue;
            kept.filings.push({ ...filing });
        }
    }
    return output;
}

module.exports = {
    buildFactLedger,
    dedupeLedgerRows,
    ledgerRowKey,
    docIdentity
};
