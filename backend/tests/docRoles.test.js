const { classifyDocRole, DOC_ROLES } = require('../court-analysis/utils/docRoles');

function entryWithTitle(title, documentText = null) {
    return {
        caseInfo: { title, caseNumber: 'ST-2/2013' },
        documentLinks: documentText ? [{ url: 'https://x', text: documentText }] : []
    };
}

describe('classifyDocRole (TS-1 deterministic rules)', () => {
    test('ledger titles win over later rules', () => {
        expect(classifyDocRole(entryWithTitle('Diobeni popis'))).toBe('ledger');
        expect(classifyDocRole(entryWithTitle('Završni račun.pdf'))).toBe('ledger');
    });

    test('decisions, transfers, filings, and admin each match their vocabulary', () => {
        expect(classifyDocRole(entryWithTitle('Rješenje - odbijen prigovor'))).toBe('decision');
        expect(classifyDocRole(entryWithTitle('Presuda TS ST P-170-2023'))).toBe('decision');
        expect(classifyDocRole(entryWithTitle('Zaključak'))).toBe('decision');
        expect(classifyDocRole(entryWithTitle('Ugovor o ustupu tražbina'))).toBe('transfer');
        expect(classifyDocRole(entryWithTitle('Ugovor o ustupu tražbine (cesija)'))).toBe('transfer');
        expect(classifyDocRole(entryWithTitle('Podnesak od 15.07.2025.'))).toBe('filing');
        expect(classifyDocRole(entryWithTitle('Žalba'))).toBe('filing');
        expect(classifyDocRole(entryWithTitle('Prijedlog stečajnog upravitelja'))).toBe('filing');
        expect(classifyDocRole(entryWithTitle('Izvješće stečajne upraviteljice od 15.07.2025.'))).toBe('filing');
        expect(classifyDocRole(entryWithTitle('Punomoć za zastupanje'))).toBe('admin');
        expect(classifyDocRole(entryWithTitle('Troškovnik'))).toBe('admin');
    });

    test('link text classifies when the title is a bare attachment label', () => {
        expect(classifyDocRole(entryWithTitle('Prilog', 'Ugovor o ustupu tražbina DDM - Kruščica.pdf'))).toBe('transfer');
        expect(classifyDocRole(entryWithTitle('Prilog', 'Rješenje - potvrda.pdf'))).toBe('decision');
    });

    test('ambiguous and empty metadata defaults to other (exploratory reserve)', () => {
        expect(classifyDocRole(entryWithTitle('Prilog'))).toBe('other');
        expect(classifyDocRole(entryWithTitle('Podnesak'))).toBe('other');
        expect(classifyDocRole(entryWithTitle('Podnesak', 'Podnesak.pdf P75P'))).toBe('other');
        expect(classifyDocRole(entryWithTitle(''))).toBe('other');
        expect(classifyDocRole({})).toBe('other');
        expect(classifyDocRole(null)).toBe('other');
    });

    test('publishes the six-role taxonomy', () => {
        expect(DOC_ROLES).toEqual(['ledger', 'decision', 'transfer', 'filing', 'admin', 'other']);
    });

    test('Kerum ST-2/2013 titles resolve deterministically at >=90%', () => {
        const fs = require('fs');
        const path = require('path');
        const { parseCsvExport } = require('../scraper/csvExportParser');
        const parsed = parseCsvExport(fs.readFileSync(
            path.join(__dirname, 'fixtures', 'csv-export', 'oib-66124057408.csv'),
            'utf8'
        ));
        expect(parsed.ok).toBe(true);
        const st2 = parsed.rows.filter((row) =>
            String(row['Oznaka spisa'] || '').trim().toUpperCase() === 'ST-2/2013'
        );
        expect(st2.length).toBeGreaterThan(300);
        const resolved = st2.filter((row) =>
            classifyDocRole(entryWithTitle(
                String(row['Naslov'] || ''),
                String(row['Dokumenti (datoteke)'] || '')
            )) !== 'other'
        ).length;
        expect(resolved / st2.length).toBeGreaterThanOrEqual(0.9);
    });
});
