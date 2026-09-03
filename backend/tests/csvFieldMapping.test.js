const path = require('path');
const fs = require('fs');
const {
    CSV_ACQUISITION_MODE,
    stripPageCount,
    parseDocumentFiles,
    parseParticipants,
    mapCsvRowToEntry,
    mapCsvRowsToEntries
} = require('../court-analysis/utils/csvFieldMapping');
const { parseCsvExport } = require('../scraper/csvExportParser');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'csv-export');

function fixtureRows(name) {
    return parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8')).rows;
}

describe('stripPageCount', () => {
    test('strips the trailing page-count marker', () => {
        expect(stripPageCount('Podnesak.pdf P75P')).toBe('Podnesak.pdf');
        expect(stripPageCount('Žalba.pdf P227P')).toBe('Žalba.pdf');
    });

    test('leaves tokens without a page count untouched', () => {
        expect(stripPageCount('Podnesak.pdf')).toBe('Podnesak.pdf');
    });
});

describe('parseDocumentFiles', () => {
    test('parses a single file', () => {
        const result = parseDocumentFiles('Podnesak.pdf P75P');
        expect(result.documentFiles).toEqual(['Podnesak.pdf P75P']);
        expect(result.firstFilename).toBe('Podnesak.pdf');
    });

    test('parses a multi-file cell, splitting on semicolons', () => {
        const raw = 'Žalba.pdf P227P; Prilog St-2_2013-1217-1 - Odluka.pdf; Prilog St-2_2013-1217-2 - Podnesak.pdf';
        const result = parseDocumentFiles(raw);
        expect(result.documentFiles).toHaveLength(3);
        expect(result.firstFilename).toBe('Žalba.pdf');
    });

    test('handles empty input', () => {
        expect(parseDocumentFiles('').documentFiles).toEqual([]);
        expect(parseDocumentFiles(undefined).firstFilename).toBe('');
    });
});

describe('parseParticipants', () => {
    const debtorName = 'KERUM društvo s ograničenom odgovornošću, za unutarnju i vanjsku trgovinu, promet i usluge u stečaju';
    const debtorOib = '66124057408';
    const debtorAddress = 'Zrinjsko Frankopanska 68, 21000 Split, Hrvatska';

    test('marks a bare-OIB participant as DUŽNIK with the debtor address', () => {
        const participants = parseParticipants(`${debtorName} ${debtorOib}`, debtorName, debtorOib, debtorAddress);
        expect(participants).toHaveLength(1);
        expect(participants[0].name).toBe(debtorName);
        expect(participants[0].oib).toBe(debtorOib);
        expect(participants[0].role).toBe('DUŽNIK');
        expect(participants[0].address).toBe(debtorAddress);
    });

    test('parses ULOGA/OIB-labelled non-debtor participants', () => {
        const sudionici = `${debtorName} ${debtorOib}; VAMOS DISTRIBUCIJA društvo s ograničenom odgovornošću za trgovinu, usluge, proizvodnju hrane i pića / ULOGA: Ostali - stranka | OIB: 29498015440`;
        const participants = parseParticipants(sudionici, debtorName, debtorOib, debtorAddress);

        expect(participants).toHaveLength(2);
        expect(participants[0].role).toBe('DUŽNIK');
        expect(participants[0].oib).toBe(debtorOib);
        expect(participants[1].name).toBe('VAMOS DISTRIBUCIJA društvo s ograničenom odgovornošću za trgovinu, usluge, proizvodnju hrane i pića');
        expect(participants[1].oib).toBe('29498015440');
        expect(participants[1].role).toBe('Ostali - stranka');
        expect(participants[1].address).toBe('');
    });

    test('handles an empty Sudionici cell', () => {
        expect(parseParticipants('', debtorName, debtorOib, debtorAddress)).toEqual([]);
    });
});

describe('mapCsvRowToEntry', () => {
    const oibRows = fixtureRows('oib-66124057408.csv');

    test('maps the first OIB fixture row to the pipeline entry shape', () => {
        const entry = mapCsvRowToEntry(oibRows[0]);

        expect(entry.caseInfo.title).toBe('Podnesak od 17.06.2026.');
        expect(entry.caseInfo.caseNumber).toBe('ST-2/2013');
        expect(entry.caseInfo.court).toBe('Trgovački sud u Splitu');
        expect(entry.caseInfo.date).toBe('2026-06-23');
        expect(entry.caseInfo.datePublished).toBe('23.06.2026. 08:36:20');
        expect(entry.caseInfo.detailLink).toBe('https://e-oglasna.pravosudje.hr/objave/75527c14-9d85-48be-b997-eb2fa4c94298');
        expect(entry.caseInfo.debtorOib).toBe('66124057408');
        expect(entry.caseInfo.publicationEnd).toBe(null);
        expect(entry.caseInfo.entryType).toBe('Stečaj');
        expect(entry.caseInfo.ePredmetLink).toContain('e-predmet.pravosudje.hr');

        expect(entry.documentLinks).toHaveLength(1);
        expect(entry.documentLinks[0].url).toBe(entry.caseInfo.documentDownloadLink);
        expect(entry.documentLinks[0].text).toBe('Podnesak.pdf');
        expect(entry.caseInfo.documentFiles).toEqual(['Podnesak.pdf P75P']);

        expect(entry.acquisition.mode).toBe(CSV_ACQUISITION_MODE);
        expect(entry.caseInfo.acquisition.mode).toBe(CSV_ACQUISITION_MODE);
    });

    test('preserves the register-prefix case number as a distinct key', () => {
        const row = oibRows.find((r) => (r['Oznaka spisa'] || '').trim() === '4 St-2/2013');
        const entry = mapCsvRowToEntry(row);
        expect(entry.caseInfo.caseNumber).toBe('4 ST-2/2013');
        expect(entry.caseInfo.caseNumber).not.toBe('ST-2/2013');
    });

    test('splits multi-file rows and strips the page-count suffix for the link text', () => {
        const row = oibRows.find((r) => (r['Dokumenti (datoteke)'] || '').includes(';'));
        const entry = mapCsvRowToEntry(row);
        expect(entry.caseInfo.documentFiles.length).toBeGreaterThan(1);
        expect(entry.documentLinks[0].text).toBe('Žalba.pdf');
    });

    test('reconstructs ULOGA-labelled participants from a real row', () => {
        const row = oibRows.find((r) => (r['Sudionici'] || '').includes('ULOGA'));
        const entry = mapCsvRowToEntry(row);
        expect(entry.caseInfo.participants).toHaveLength(2);
        const debtor = entry.caseInfo.participants[0];
        const other = entry.caseInfo.participants[1];
        expect(debtor.role).toBe('DUŽNIK');
        expect(debtor.oib).toBe('66124057408');
        expect(other.oib).toBe('29498015440');
        expect(other.role).toBe('Ostali - stranka');
    });

    test('produces no documentLinks when the export has no document link', () => {
        const entry = mapCsvRowToEntry({ 'Oznaka spisa': 'St-1/2020', 'Naslov': 'x', 'Sud': 'x', 'Oglas (link)': 'https://x', 'Dokumenti (link)': '', 'Dokumenti (datoteke)': '', 'Početni dan objave': '01.01.2020.', 'OIB stečajnog dužnika': '', 'Sudionici': '' });
        expect(entry.documentLinks).toEqual([]);
    });
});

describe('mapCsvRowsToEntries', () => {
    test('maps every row of the OIB fixture', () => {
        const entries = mapCsvRowsToEntries(fixtureRows('oib-66124057408.csv'));
        expect(entries).toHaveLength(381);
        for (const entry of entries) {
            expect(entry.acquisition.mode).toBe(CSV_ACQUISITION_MODE);
        }
    });
});
