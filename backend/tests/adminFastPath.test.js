'use strict';

const {
    canUseAdminFastPath,
    extractAdminNoticeFastPath,
} = require('../court-analysis/extraction/adminFastPath');

describe('Stage T0.5 adminFastPath', () => {
    test('accepts routine short admin notice without currency or cession cues and extracts grounded metadata', () => {
        const text = [
            'PUNOMOĆ',
            'Poslovni broj: St-2/2013-14',
            'Split, 14.03.2024.',
            'Opunomoćitelj: ADRIA d.o.o., OIB: 08697489827',
            'Ovlašćuje se odvjetnik za zastupanje u predmetu St-2/2013.',
        ].join('\n');

        expect(canUseAdminFastPath({
            text,
            docRole: 'admin',
            docClass: 'digital_text',
            file: { text: 'Punomoc.pdf' },
        })).toBe(true);

        const extracted = extractAdminNoticeFastPath({
            text,
            file: { text: 'Punomoc.pdf', entryDate: '2024-03-15' },
            caseInfo: { participants: [{ name: 'ADRIA d.o.o.', role: 'Vjerovnik' }] },
        });

        expect(extracted).toMatchObject({
            caseNumber: 'St-2/2013-14',
            decisionDate: '2024-03-14',
            decisionOutcome: null,
            amounts: [],
            propertyFlow: [],
            proceduralEvents: [],
            adminFastPath: true,
        });
        expect(extracted.citedFilingReferences).toContain('St-2/2013');
        expect(extracted.documentParties).toEqual([
            expect.objectContaining({
                oib: '08697489827',
                quote: 'Opunomoćitelj: ADRIA d.o.o., OIB: 08697489827',
            }),
        ]);
    });

    test('declines fast-path when currency amounts, cession cues, long text, or non-admin roles appear', () => {
        expect(canUseAdminFastPath({
            text: 'Troškovnik iznosi 1.250,00 EUR.',
            docRole: 'admin',
            docClass: 'digital_text',
        })).toBe(false);

        expect(canUseAdminFastPath({
            text: 'Račun za 500 EUR bez decimala.',
            docRole: 'admin',
            docClass: 'digital_text',
        })).toBe(false);

        expect(canUseAdminFastPath({
            text: 'Obavijest o ustupu tražbine na novog vjerovnika.',
            docRole: 'admin',
            docClass: 'digital_text',
        })).toBe(false);

        expect(canUseAdminFastPath({
            text: 'A'.repeat(1005),
            docRole: 'admin',
            docClass: 'digital_text',
        })).toBe(false);

        expect(canUseAdminFastPath({
            text: 'Kratko rješenje suda.',
            docRole: 'decision',
            docClass: 'digital_text',
        })).toBe(false);

        expect(canUseAdminFastPath({
            text: 'Punomoć skenirana.',
            docRole: 'admin',
            docClass: 'scanned_full',
        })).toBe(false);
    });
});
