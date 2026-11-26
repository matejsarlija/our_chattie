const { buildFactLedger, dedupeLedgerRows, docIdentity } = require('../../court-analysis/reasoning/ledger/factLedger');

function distributionAnalysis(id, fileName, rows, { contentHash = `hash-${id}` } = {}) {
    return {
        id,
        fileName,
        caseNumber: 'ST-2/2013',
        sourceEntryIndex: 0,
        sourceDocumentLinkId: `${id}::doc-1`,
        contentHash,
        amounts: rows,
        propertyFlow: []
    };
}

const REGISTER_ROWS = [
    {
        description: 'Tražbina vjerovnika A d.o.o., redni broj 106',
        amount: 84500,
        currency: 'EUR',
        amountRole: 'line_item',
        claimRegistryNumber: '106',
        isplatniRed: 'drugi viši isplatni red',
        quote: 'Redni broj 106 | Tražbina vjerovnika A d.o.o. | 84.500,00 EUR'
    },
    {
        description: 'Tražbina vjerovnika B d.o.o., redni broj 107',
        amount: 12000,
        currency: 'EUR',
        amountRole: 'line_item',
        claimRegistryNumber: '107',
        quote: 'Redni broj 107 | Tražbina vjerovnika B d.o.o. | 12.000,00 EUR'
    },
    {
        description: 'Ukupno prijavljene tražbine',
        amount: 96500,
        currency: 'EUR',
        amountRole: 'total',
        quote: 'Ukupno prijavljene tražbine | 96.500,00 EUR'
    }
];

describe('buildFactLedger (TL-1)', () => {
    test('distribution-table analysis becomes one row per extracted item with roles and quotes', () => {
        const rows = buildFactLedger([distributionAnalysis('a-1', 'popis.pdf', REGISTER_ROWS)]);

        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.kind)).toEqual(['amount', 'amount', 'amount']);
        expect(rows[0]).toEqual(expect.objectContaining({
            description: 'Tražbina vjerovnika A d.o.o., redni broj 106',
            value: 84500,
            currency: 'EUR',
            amountRole: 'line_item',
            claimRegistryNumber: '106',
            isplatniRed: 'drugi viši isplatni red',
            quote: expect.stringContaining('Redni broj 106'),
            page: null
        }));
        expect(rows[2].amountRole).toBe('total');
        // Document identity travels on every row.
        for (const row of rows) {
            expect(row.doc).toEqual(expect.objectContaining({
                analysisId: 'a-1',
                fileName: 'popis.pdf',
                contentHash: 'hash-a-1'
            }));
            expect(row.filings).toEqual([expect.objectContaining({ analysisId: 'a-1' })]);
        }
    });

    test('procedural event fields survive on rows that carry them', () => {
        const rows = buildFactLedger([{
            ...distributionAnalysis('a-2', 'ustup.pdf', []),
            propertyFlow: [{
                description: 'Ustup tražbine',
                assetType: 'tražbina',
                eventType: 'ustup',
                legalEffect: 'modifies',
                references: ['St-2/2013-1196-1'],
                relationshipBasis: 'explicit_text',
                transferor: 'A',
                transferee: 'B',
                quote: 'ustupam tražbinu'
            }]
        }]);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual(expect.objectContaining({
            kind: 'property',
            eventType: 'ustup',
            legalEffect: 'modifies',
            references: ['St-2/2013-1196-1'],
            relationshipBasis: 'explicit_text'
        }));
    });

    test('non-object items are skipped, never crash the ledger', () => {
        expect(buildFactLedger(null)).toEqual([]);
        expect(buildFactLedger([{ id: 'x', amounts: ['nope', null, 42], propertyFlow: null }])).toEqual([]);
    });

    test('docIdentity degrades safely on legacy analyses', () => {
        expect(docIdentity(null)).toEqual(expect.objectContaining({ contentHash: null }));
        expect(docIdentity({ id: 'a' }).sourceEntryIndex).toBeNull();
    });
    test('exact amount/property echoes share a cross-category fact id without being dropped', () => {
        const rows = buildFactLedger([{
            id: 'analysis-1',
            fileName: 'Rjesenje.pdf',
            sourceDocumentLinkId: 'link-1',
            amounts: [{
                description: 'Djelomično namirenje tražbine',
                amount: 25,
                currency: 'EUR',
                date: '2024-01-01',
                direction: 'netted',
                quote: 'Namiruje se 25 EUR po prijenosu tražbine.',
            }],
            propertyFlow: [{
                description: 'Namirenje prenesene tražbine',
                value: 25,
                currency: 'EUR',
                date: '2024-01-01',
                assetType: 'tražbina',
                eventType: 'namirenje',
                quote: 'Namiruje se 25 EUR po prijenosu tražbine.',
            }],
        }]);

        expect(rows).toHaveLength(2);
        expect(rows[0].crossCategoryFactId).toBeTruthy();
        expect(rows[0].crossCategoryFactId).toBe(rows[1].crossCategoryFactId);
    });
});

describe('dedupeLedgerRows (TL-1)', () => {
    test('byte-identical re-attachments collapse with merged filing provenance', () => {
        const rowA = buildFactLedger([distributionAnalysis('a-1', 'rjesenje.pdf', [REGISTER_ROWS[0]], { contentHash: 'same-bytes' })])[0];
        const rowB = buildFactLedger([{
            ...distributionAnalysis('a-9', 'rjesenje-kopija.pdf', [REGISTER_ROWS[0]], { contentHash: 'same-bytes' }),
            sourceEntryIndex: 7
        }])[0];
        const merged = dedupeLedgerRows([rowA, rowB]);

        expect(merged).toHaveLength(1);
        expect(merged[0].filings).toHaveLength(2);
        expect(merged[0].filings).toEqual(expect.arrayContaining([
            expect.objectContaining({ analysisId: 'a-1' }),
            expect.objectContaining({ analysisId: 'a-9', sourceEntryIndex: 7 })
        ]));
        expect(merged[0].description).toContain('redni broj 106');
    });

    test('rows without a content hash never merge, even when otherwise identical', () => {
        const rowA = buildFactLedger([{ ...distributionAnalysis('a-1', 'x.pdf', [REGISTER_ROWS[0]]), contentHash: null }])[0];
        const rowB = buildFactLedger([{ ...distributionAnalysis('a-2', 'y.pdf', [REGISTER_ROWS[0]]), contentHash: null }])[0];
        expect(dedupeLedgerRows([rowA, rowB])).toHaveLength(2);
    });

    test('same bytes but different fact content stay separate', () => {
        const rowA = buildFactLedger([distributionAnalysis('a-1', 'x.pdf', [REGISTER_ROWS[0]], { contentHash: 'same-bytes' })])[0];
        const rowB = buildFactLedger([distributionAnalysis('a-2', 'y.pdf', [REGISTER_ROWS[1]], { contentHash: 'same-bytes' })])[0];
        expect(dedupeLedgerRows([rowA, rowB])).toHaveLength(2);
    });

    test('supports 4 canonical kinds with deterministic row.id, full provenance, and canonicalPartyId', () => {
        const rows = buildFactLedger([{
            id: 'a-4kind',
            docId: 'doc-hash-4kind',
            fileName: 'rjesenje.pdf',
            caseNumber: 'ST-2/2013',
            sourceEntryIndex: 4,
            sourceDocumentLinkId: 'link-4',
            contentHash: 'hash-4kind',
            amounts: [{
                description: 'Tražbina',
                amount: 1000,
                amountHrk: 7534.5,
                currency: 'EUR',
                recipientName: 'B2 KAPITAL d.o.o.',
                recipientOib: '49803335555',
                quote: '1.000,00 EUR',
                sourcePages: [2],
                sourceChunkId: 'rjesenje.pdf:prose-1',
                sourceStartIndex: 100,
                sourceEndIndex: 112,
                grounded: true,
            }],
            propertyFlow: [{
                description: 'Ustup',
                value: 1000,
                valueHrk: 7534.5,
                currency: 'EUR',
                transferor: 'Prvi d.o.o.',
                transferorOib: '11111111111',
                transferee: 'B2 KAPITAL d.o.o.',
                transfereeOib: '49803335555',
                quote: 'ustup',
                sourcePages: [3],
            }],
            documentParties: [{
                name: 'B2 Kapital',
                role: 'vjerovnik',
                quote: 'B2 Kapital',
                sourcePages: [1],
            }],
            proceduralEvents: [{
                eventType: 'appellate-decision',
                outcome: 'upheld',
                instance: 'VTS RH',
                quote: 'Potvrđuje se rješenje.',
                sourcePages: [4],
            }],
        }]);

        expect(rows.map((r) => r.kind)).toEqual(['amount', 'property', 'party', 'procedural_outcome']);
        for (const row of rows) {
            expect(row.id).toMatch(/^fact-[a-f0-9]{20}$/);
            expect(row.docId).toBe('doc-hash-4kind');
            expect(row.sourcePages.length).toBeGreaterThan(0);
        }
        expect(rows[0]).toMatchObject({
            amountHrk: 7534.5,
            sourceChunkId: 'rjesenje.pdf:prose-1',
            sourceStartIndex: 100,
            sourceEndIndex: 112,
            canonicalPartyId: 'oib:49803335555',
        });
        expect(rows[1]).toMatchObject({
            valueHrk: 7534.5,
            transferorOib: '11111111111',
            transfereeOib: '49803335555',
            canonicalPartyId: 'oib:49803335555',
        });
        expect(rows[2].canonicalPartyId).toBe('oib:49803335555');
        expect(rows[3]).toMatchObject({
            eventType: 'appellate-decision',
            outcome: 'upheld',
            instance: 'VTS RH',
        });
    });
});
