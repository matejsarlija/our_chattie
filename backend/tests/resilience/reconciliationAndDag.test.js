'use strict';

const { reconcileFlows } = require('../../court-analysis/reasoning/ledger/reconciliation');
const { buildCaseContext } = require('../../court-analysis/reasoning/ledger/caseContextBuilder');
const { buildCitationGraph } = require('../../court-analysis/reasoning/ledger/citationGraph');

describe('Resilience: Reconciliation Calibration & Linear DAG Scaling', () => {
    test('ignores <5% rounding noise (808.98 vs 788.31 = 2.62%) while keeping 168 creditors uncollided', () => {
        const entries = [
            {
                id: 'f1',
                kind: 'amount',
                canonicalPartyId: 'party-hp',
                description: 'Trošak dostave',
                value: 808.98,
                valueEur: 808.98,
                amountEur: 808.98,
                currency: 'EUR',
                docId: 'doc-1',
                fileName: 'Diobeni popis.pdf',
            },
            {
                id: 'f2',
                kind: 'amount',
                canonicalPartyId: 'party-hp',
                description: 'Trošak dostave',
                value: 788.31,
                valueEur: 788.31,
                amountEur: 788.31,
                currency: 'EUR',
                docId: 'doc-2',
                fileName: 'Završni račun.pdf',
            },
        ];
        const rec = reconcileFlows(entries);
        expect(rec.conflicts).toHaveLength(0);

        const manyCreditors = Array.from({ length: 168 }, (_, i) => ({
            id: `cred-${i}`,
            kind: 'amount',
            canonicalPartyId: `party-${i}`,
            description: 'Tražbina II. višeg isplatnog reda',
            value: 1000 + i,
            valueEur: 1000 + i,
            amountEur: 1000 + i,
            currency: 'EUR',
            docId: `doc-${i % 10}`,
            fileName: 'Diobeni popis.pdf',
        }));
        const recMany = reconcileFlows(manyCreditors);
        expect(recMany.conflicts).toHaveLength(0);
    });

    test('500-fact root-case fixture avoids Tier-3 Cartesian explosion in caseContextBuilder and citationGraph', () => {
        const factLedger = Array.from({ length: 500 }, (_, i) => ({
            id: `fact-${i}`,
            kind: 'amount',
            caseNumber: 'St-2/2013',
            description: `Stavka ${i}`,
            value: 100 + i,
            currency: 'EUR',
            sourceId: `doc-${i % 20}`,
            docId: `doc-${i % 20}`,
            fileName: `doc-${i % 20}.pdf`,
        }));
        const pkg = {
            caseNumber: 'St-2/2013',
            analyses: Array.from({ length: 20 }, (_, i) => ({
                id: `doc-${i}`,
                docId: `doc-${i}`,
                fileName: `doc-${i}.pdf`,
                caseNumber: 'St-2/2013',
                citedFilingReferences: ['St-2/2013'],
            })),
            factLedger,
        };
        const ctx = buildCaseContext(pkg);
        expect(ctx.nodes.length).toBeLessThan(1000);
        const graph = buildCitationGraph(pkg.analyses);
        expect(graph.edges.length).toBeLessThan(100);
    });
});
