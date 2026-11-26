'use strict';

const { buildFallbackReport } = require('../../court-analysis/reasoning/synthesis/fallbackReportBuilder');
const { validateReport } = require('../../court-analysis/reasoning/schema/schema');

describe('fallbackReportBuilder', () => {
    test('builds a $0 deterministic Croatian report valid against schema.js', () => {
        const pkg = {
            clusterId: 'ST-2/2013',
            primaryCaseNumber: 'ST-2/2013',
            coverage: { analyzed: 42, total: 100, failed: 58, partial: 0 },
            entries: [
                { date: '2025-01-10', title: 'Rješenje o diobi', caseNumber: 'ST-2/2013', detailLink: 'https://e-oglasna.pravosudje.hr/objave/1' },
            ],
            flows: {
                count: 1,
                entries: [
                    {
                        id: 'flow-1',
                        docId: 'doc-hash-1',
                        fileName: 'Dioba.pdf',
                        description: 'Tražbina vjerovnika A',
                        value: 15000,
                        valueEur: 15000,
                        currency: 'EUR',
                        grounded: true,
                        quote: 'Tražbina iznosi 15.000,00 EUR',
                        sourcePages: [2],
                        sourceChunkId: 'Dioba.pdf:prose-1',
                        sourceEntryIndex: 0,
                    },
                ],
            },
            reconciliation: {
                conflicts: [
                    { finding: 'Različiti iznosi za istu namjenu.', reason: 'Odstupanje u 2 dokumenta.', sources: ['doc-1', 'doc-2'] },
                ],
                openQuestions: [{ text: 'Provjeriti ukupni iznos.', source: 'reconciliation', kind: 'arithmetic' }],
                valueChanges: [],
            },
        };

        const report = buildFallbackReport(pkg, {
            fallbackReason: 'provider-credits-exhausted',
            reasonDetail: 'HTTP 402',
        });

        expect(report.generationMode).toBe('deterministic_fallback');
        expect(report.fallbackReason).toBe('provider-credits-exhausted');
        expect(report.narrative).toContain('ST-2/2013');
        expect(report.narrative).toContain('OpenRouter');
        expect(report.findings.length).toBeGreaterThanOrEqual(2);
        expect(report.findings[0].verificationStatus).toBe('verified_deterministic');
        expect(report.claims).toEqual([]);
        expect(validateReport(report)).toEqual({ valid: true });
    });
});
