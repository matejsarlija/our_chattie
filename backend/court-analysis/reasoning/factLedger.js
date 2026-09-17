// court-analysis/reasoning/factLedger.js
//
// Evidence/fact ledger (spec §4.3 / ticket TL-1): normalized row-level facts
// with document identity, feeding money/property flows and reconciliation
// (TL-2) instead of prose claims.
//
// A ledger row carries everything the fact needs to be audited without
// re-reading the document: the normalized fact fields, a verbatim quote, and
// a `doc` identity block (analysis id, file name, case, source entry/link,
// content hash). Per-fact `page` is an explicit null: extraction input is
// joined text without a page map (chunker receives pages-joined text), so no
// honest page number exists today — recording one would be fabrication. A
// page-map precondition belongs to a future extraction-input ticket.
//
// Byte-identical attachments (the same filing re-attached across objave)
// collapse to one row with merged `filings` provenance. Only byte-identical
// content shares a row (whitespace-normalized hash); near-duplicates stay
// separate per the TD-1 no-go and TX-3 research-only constraint.

const { normalizeText } = require('./indexer');
const { parseAmount } = require('./flow');

function cleanString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function docIdentity(analysis) {
    return {
        analysisId: analysis?.id || null,
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
        analysisId: doc.analysisId,
        fileName: doc.fileName,
        sourceEntryIndex: doc.sourceEntryIndex,
        sourceDocumentLinkId: doc.sourceDocumentLinkId
    };
}

/**
 * Builds normalized ledger rows from attached analyses. Row-level fidelity:
 * one extracted item becomes one row — rows are never merged here (merging
 * same-attachment duplicates is `dedupeLedgerRows`' job, with provenance).
 */
function buildFactLedger(analyses) {
    const rows = [];
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        const doc = docIdentity(analysis);
        for (const raw of Array.isArray(analysis?.amounts) ? analysis.amounts : []) {
            if (!raw || typeof raw !== 'object') continue;
            rows.push({
                kind: 'amount',
                description: cleanString(raw.description),
                // Preserve legacy extractor numeric strings (Croatian table
                // cells commonly use `1.200.000,00`) before flows consume the
                // ledger. Dropping them would make the migration lossy.
                value: parseAmount(raw.amount ?? raw.value),
                currency: cleanString(raw.currency),
                valueEur: parseAmount(raw.amountEur ?? raw.valueEur),
                date: cleanString(raw.date),
                direction: cleanString(raw.direction),
                amountRole: cleanString(raw.amountRole),
                eventType: cleanString(raw.eventType),
                legalEffect: cleanString(raw.legalEffect),
                references: Array.isArray(raw.references) ? raw.references.filter((r) => typeof r === 'string' && r.trim()) : [],
                relationshipBasis: cleanString(raw.relationshipBasis),
                parties: {
                    payerName: cleanString(raw.payerName),
                    payerOib: cleanString(raw.payerOib),
                    recipientName: cleanString(raw.recipientName),
                    recipientOib: cleanString(raw.recipientOib),
                    transferor: cleanString(raw.transferor),
                    transferee: cleanString(raw.transferee)
                },
                isplatniRed: cleanString(raw.isplatniRed),
                claimRegistryNumber: cleanString(raw.claimRegistryNumber),
                filingReference: cleanString(raw.filingReference),
                quote: typeof raw.quote === 'string' ? raw.quote : null,
                grounded: raw.grounded === true,
                page: null,
                doc,
                filings: [filingRef(doc)]
            });
        }
        for (const raw of Array.isArray(analysis?.propertyFlow) ? analysis.propertyFlow : []) {
            if (!raw || typeof raw !== 'object') continue;
            rows.push({
                kind: 'property',
                description: cleanString(raw.description),
                value: parseAmount(raw.value ?? raw.amount),
                currency: cleanString(raw.currency),
                valueEur: parseAmount(raw.valueEur ?? raw.amountEur),
                date: cleanString(raw.date),
                direction: cleanString(raw.direction),
                amountRole: null,
                eventType: cleanString(raw.eventType),
                legalEffect: cleanString(raw.legalEffect),
                references: Array.isArray(raw.references) ? raw.references.filter((r) => typeof r === 'string' && r.trim()) : [],
                relationshipBasis: cleanString(raw.relationshipBasis),
                parties: {
                    payerName: cleanString(raw.payerName),
                    payerOib: cleanString(raw.payerOib),
                    recipientName: cleanString(raw.recipientName),
                    recipientOib: cleanString(raw.recipientOib),
                    transferor: cleanString(raw.transferor),
                    transferee: cleanString(raw.transferee)
                },
                identifier: cleanString(raw.identifier),
                assetType: cleanString(raw.assetType),
                isplatniRed: cleanString(raw.isplatniRed),
                claimRegistryNumber: cleanString(raw.claimRegistryNumber),
                filingReference: cleanString(raw.filingReference),
                supersedes: cleanString(raw.supersedes),
                quote: typeof raw.quote === 'string' ? raw.quote : null,
                grounded: raw.grounded === true,
                page: null,
                doc,
                filings: [filingRef(doc)]
            });
        }
    }
    return rows;
}

function ledgerRowKey(row) {
    const parts = [
        row.kind || '',
        normalizeText(row.description || ''),
        String(row.value ?? ''),
        row.currency || '',
        normalizeText(row.claimRegistryNumber || ''),
        normalizeText(row.filingReference || '')
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
            output.push({ ...row, filings: Array.isArray(row.filings) ? [...row.filings] : [] });
            continue;
        }
        const key = `${contentKey}::${ledgerRowKey(row)}`;
        if (!byKey.has(key)) {
            const kept = { ...row, filings: [] };
            byKey.set(key, kept);
            output.push(kept);
        }
        const kept = byKey.get(key);
        for (const filing of Array.isArray(row.filings) ? row.filings : [filingRef(row.doc)]) {
            if (!filing || kept.filings.some((f) =>
                f.analysisId === filing.analysisId && f.sourceEntryIndex === filing.sourceEntryIndex
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
