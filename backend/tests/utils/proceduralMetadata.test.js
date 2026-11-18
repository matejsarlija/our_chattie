const {
    normalizeFilingReference,
    parseProceduralMetadataEntry,
} = require('../../court-analysis/utils/proceduralMetadata');

describe('proceduralMetadata', () => {
    test.each([
        ['St-2_2013-1217', 'St-2/2013-1217'],
        ['St-2/2013-1217', 'St-2/2013-1217'],
        ['P-170-2023-12', 'P-170/2023-12'],
        ['Pž-188/2026-3', 'Pž-188/2026-3'],
        ['Gž-1234/2024-2', 'Gž-1234/2024-2'],
    ])('normalizes %s without dropping the register prefix', (raw, expected) => {
        expect(normalizeFilingReference(raw)).toBe(expected);
    });

    test('extracts a first-instance appeal and attachment references from the CSV pattern', () => {
        const events = parseProceduralMetadataEntry({
            title: 'Žalba od 02.06.2026.; Prilog od: 02.06.2026.',
            court: 'Trgovački sud u Splitu',
            caseNumber: 'St-2/2013',
            documentNames: [
                'Žalba.pdf P227P',
                'Prilog St-2_2013-1217-1 - Odluka TS ST P-170-2023-12 od 05.02.2024. - Presuda.pdf',
            ],
        });
        expect(events).toEqual(expect.arrayContaining([
            expect.objectContaining({ eventType: 'appeal', date: '2026-06-02', instance: 'first-instance' }),
            expect.objectContaining({
                filingReference: 'St-2/2013-1217',
                appellateCaseNumbers: ['P-170/2023-12'],
                date: '2024-02-05',
            }),
        ]));
        expect(events.some((event) => event.appellateCaseNumbers.includes('P-170/2023-12'))).toBe(true);
    });

    test('recognizes the VTS/Pž ruling and explicit filename outcome', () => {
        const [event] = parseProceduralMetadataEntry({
            title: 'Rješenje VTS RH broj Pž-188/2026-3 od 11.3.2026.',
            court: 'Trgovački sud u Splitu',
            caseNumber: 'St-2/2013',
            documentNames: ['Rješenje - odbijena žalba kao neosnovana - potvrđeno rješenje.pdf P558P'],
        });
        expect(event).toEqual(expect.objectContaining({
            eventType: 'appellate-decision',
            instance: 'VTS RH',
            filingReference: null,
            appellateCaseNumbers: ['Pž-188/2026-3'],
            statedOutcome: 'upheld',
            date: '2026-03-11',
        }));
    });

    test('generic and junk titles degrade without guessed identities or exceptions', () => {
        expect(parseProceduralMetadataEntry({ title: 'Podnesak od 17.06.2026.', caseNumber: 'St-2/2013' }))
            .toEqual([expect.objectContaining({ eventType: 'other', filingReference: null, date: '2026-06-17' })]);
        expect(parseProceduralMetadataEntry({ title: '###', documentNames: ['???'] })).toEqual([]);
    });
});
