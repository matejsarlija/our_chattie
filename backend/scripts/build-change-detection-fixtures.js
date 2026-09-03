#!/usr/bin/env node
/**
 * Builds the frozen change-detection fixture pairs from the Phase A CSV export
 * fixtures. Deterministic and offline: it never touches the network — it reads
 * tests/fixtures/csv-export/oib-66124057408.csv, applies a DOCUMENTED delta,
 * and writes:
 *
 *   tests/fixtures/change-detection/oib-old.csv / oib-new.csv
     tests/fixtures/change-detection/edits-old.csv / edits-new.csv
 *   tests/fixtures/change-detection/manifest.json
 *
 * Re-run after refreshing the Phase A CSV (`npm run fixtures:fetch:csv`) with:
 *   node scripts/build-change-detection-fixtures.js
 *
 * The applied deltas are asserted by tests/changeDetection.service.test.js
 * against the expectations recorded in manifest.json.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { parseCsvExport } = require('../scraper/csvExportParser');

const SOURCE_CSV = path.resolve(__dirname, '../tests/fixtures/csv-export/oib-66124057408.csv');
const OUT_DIR = path.resolve(__dirname, '../tests/fixtures/change-detection');

const HEADER = [
    'Vrsta objave',
    'Sud',
    'Oznaka spisa',
    'Naslov',
    'Stečajni dužnik',
    'Adresa stečajnog dužnika',
    'OIB stečajnog dužnika',
    'Sudionici',
    'Početni dan objave',
    'Posljednji dan objave',
    'Oglas (link)',
    'Dokumenti (datoteke)',
    'Dokumenti (link)',
    'e-Predmet (link)'
];

function csvCell(value) {
    const text = String(value == null ? '' : value);
    return `"${text.replace(/"/g, '""')}"`;
}

function serializeCsv(rows) {
    const lines = [HEADER.map(csvCell).join(',')];
    for (const row of rows) {
        lines.push(HEADER.map((column) => csvCell(row[column])).join(','));
    }
    return `${lines.join('\r\n')}\r\n`;
}

function cloneRow(row) {
    return { ...row };
}

function buildOibPair(rows) {
    // Real consecutive publications of St-2/2013 (indices into the frozen export).
    const base = [rows[0], rows[2], rows[3], rows[4], rows[5]].map(cloneRow);
    const byGuid = Object.fromEntries(base.map((row) => [row['Oglas (link)'], row]));

    const guidModifiedPages = rows[0]['Oglas (link)'];
    const guidPublicationEnd = rows[2]['Oglas (link)'];
    const guidRemoved = rows[3]['Oglas (link)'];

    // Delta 1: page-count change on the newest filing's document.
    const modifiedPages = cloneRow(byGuid[guidModifiedPages]);
    modifiedPages['Dokumenti (datoteke)'] = modifiedPages['Dokumenti (datoteke)'].replace(
        'Podnesak.pdf P75P',
        'Podnesak.pdf P76P'
    );

    // Delta 2: publication ended (empty -> populated Posljednji dan objave).
    const publicationEnd = cloneRow(byGuid[guidPublicationEnd]);
    publicationEnd['Posljednji dan objave'] = '30.06.2026.';

    const oldRows = [...base];
    const replacedGuids = new Set([guidRemoved, guidModifiedPages, guidPublicationEnd]);
    const newRows = [modifiedPages, publicationEnd]
        .concat(base.filter((row) => !replacedGuids.has(row['Oglas (link)'])));

    // Delta 3: a brand-new publication appears (new stable GUID).
    const addedRow = cloneRow(byGuid[guidModifiedPages]);
    addedRow['Oglas (link)'] = 'https://e-oglasna.pravosudje.hr/objave/f3c9d2a1-6f4b-4a2e-9a51-0c7b8e1d2f30';
    addedRow['Naslov'] = 'Novi podnesak od 01.07.2026.';
    addedRow['Početni dan objave'] = '01.07.2026. 10:00:00';
    addedRow['Dokumenti (datoteke)'] = 'Podnesak.pdf P12P';
    newRows.push(addedRow);

    return {
        oldRows,
        newRows,
        expected: {
            counts: { added: 1, removed: 1, modified: 2, unchanged: 2 },
            addedGuids: [addedRow['Oglas (link)']],
            removedGuids: [guidRemoved],
            modifications: {
                [guidModifiedPages]: { changedFields: ['documentFiles'] },
                [guidPublicationEnd]: { changedFields: ['publicationEnd'] }
            }
        }
    };
}

function buildEditsPair() {
    // Synthetic pair over a text query: covers filename rename, page-count
    // change, title edit, and entityDrift (debtor OIB set differs).
    function row(overrides) {
        return {
            'Vrsta objave': 'Stečaj',
            'Sud': 'Trgovački sud u Splitu',
            'Oznaka spisa': 'St-2/2013',
            'Stečajni dužnik': 'KERUM d.o.o. u stečaju',
            'Adresa stečajnog dužnika': 'Zrinjsko Frankopanska 68, 21000 Split, Hrvatska',
            'OIB stečajnog dužnika': '66124057408',
            'Sudionici': 'KERUM d.o.o. u stečaju 66124057408',
            'Posljednji dan objave': '',
            ...overrides
        };
    }

    const guidRename = 'https://e-oglasna.pravosudje.hr/objave/11111111-1111-4111-8111-111111111111';
    const guidPageCount = 'https://e-oglasna.pravosudje.hr/objave/22222222-2222-4222-8222-222222222222';
    const guidTitle = 'https://e-oglasna.pravosudje.hr/objave/33333333-3333-4333-8333-333333333333';
    const guidDriftOld = 'https://e-oglasna.pravosudje.hr/objave/44444444-4444-4444-8444-444444444444';

    const oldRows = [
        row({
            'Naslov': 'Izvješće povjeritelja',
            'Dokumenti (datoteke)': 'Izvješće.pdf P10P',
            'Oglas (link)': guidRename
        }),
        row({
            'Naslov': 'Podnesak od 17.06.2026.',
            'Dokumenti (datoteke)': 'Podnesak.pdf P75P',
            'Oglas (link)': guidPageCount
        }),
        row({
            'Naslov': 'Rješenje od 19.05.2026.',
            'Dokumenti (datoteke)': 'Rješenje - odbijen prigovor na diobeni popis.pdf O339O',
            'Oglas (link)': guidTitle
        }),
        row({
            'Naslov': 'Zaključak',
            'Dokumenti (datoteke)': 'Zaključak.pdf P2P',
            'Oglas (link)': guidDriftOld
        })
    ];

    const newRows = [
        row({
            'Naslov': 'Izvješće povjeritelja',
            'Dokumenti (datoteke)': 'Izvješće-final.pdf P10P',
            'Oglas (link)': guidRename
        }),
        row({
            'Naslov': 'Podnesak od 17.06.2026.',
            'Dokumenti (datoteke)': 'Podnesak.pdf P76P',
            'Oglas (link)': guidPageCount
        }),
        row({
            'Naslov': 'Rješenje od 20.05.2026.',
            'Dokumenti (datoteke)': 'Rješenje - odbijen prigovor na diobeni popis.pdf O339O',
            'Oglas (link)': guidTitle
        }),
        row({
            'Naslov': 'Zaključak',
            'Dokumenti (datoteke)': 'Zaključak.pdf P2P',
            'Oglas (link)': guidDriftOld
        }),
        // Entity drift: a publication belonging to a DIFFERENT debtor enters the
        // result set, so the observed debtorOib sets disagree across snapshots.
        row({
            'Oznaka spisa': 'St-99/2026',
            'Stečajni dužnik': 'DRUGA Tvrtka d.o.o.',
            'OIB stečajnog dužnika': '12345678901',
            'Sudionici': 'DRUGA Tvrtka d.o.o. 12345678901',
            'Naslov': 'Objava otvaranja stečaja',
            'Dokumenti (datoteke)': 'Objava.pdf P1P',
            'Oglas (link)': 'https://e-oglasna.pravosudje.hr/objave/55555555-5555-4555-8555-555555555555'
        })
    ];

    return {
        oldRows,
        newRows,
        expected: {
            counts: { added: 1, removed: 0, modified: 3, unchanged: 1 },
            addedGuids: ['https://e-oglasna.pravosudje.hr/objave/55555555-5555-4555-8555-555555555555'],
            removedGuids: [],
            modifications: {
                [guidRename]: { changedFields: ['documentFiles'] },
                [guidPageCount]: { changedFields: ['documentFiles'] },
                [guidTitle]: { changedFields: ['title'] }
            },
            entityDrift: true,
            debtorOibs: {
                old: ['66124057408'],
                new: ['66124057408', '12345678901']
            }
        }
    };
}

function main() {
    const source = fs.readFileSync(SOURCE_CSV, 'utf8');
    const parsed = parseCsvExport(source);
    if (!parsed.ok) {
        throw new Error(`Source CSV failed to parse: ${parsed.reason}`);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const oibPair = buildOibPair(parsed.rows);
    const editsPair = buildEditsPair();

    const files = {
        'oib-old.csv': oibPair.oldRows,
        'oib-new.csv': oibPair.newRows,
        'edits-old.csv': editsPair.oldRows,
        'edits-new.csv': editsPair.newRows
    };
    for (const [name, rows] of Object.entries(files)) {
        fs.writeFileSync(path.join(OUT_DIR, name), serializeCsv(rows), 'utf8');
    }

    const manifest = {
        description: 'Frozen change-detection fixtures. Derived deterministically from the Phase A CSV export fixture by scripts/build-change-detection-fixtures.js — do not hand-edit; rebuild instead.',
        builder: 'node scripts/build-change-detection-fixtures.js',
        derivedFrom: 'tests/fixtures/csv-export/oib-66124057408.csv',
        queryContract: 'Parsed with scraper/csvExportParser.parseCsvExport; reduced by change-detection/snapshot.buildSnapshot; compared by change-detection/diff.diffSnapshots.',
        pairs: {
            'oib-old.csv -> oib-new.csv': {
                query: { type: 'oib', value: '66124057408' },
                delta: [
                    'documentFiles page-count change Podnesak.pdf P75P -> P76P on 75527c14-…',
                    'publicationEnd empty -> 30.06.2026. on 0b2785c4-…',
                    'a05148e4-… removed',
                    'new publication f3c9d2a1-… added',
                    '971104f5-… and b81c23b4-… unchanged'
                ],
                expected: oibPair.expected
            },
            'edits-old.csv -> edits-new.csv': {
                query: { type: 'text', value: 'KERUM' },
                delta: [
                    'filename-only rename Izvješće.pdf -> Izvješće-final.pdf (same page count)',
                    'page-count change Podnesak.pdf P75P -> P76P',
                    'title edit Rješenje od 19.05.2026. -> od 20.05.2026.',
                    'entry for a different debtor OIB (12345678901) joins the results -> entityDrift'
                ],
                expected: editsPair.expected
            }
        }
    };

    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    console.log(`[change-detection-fixtures] Wrote ${Object.keys(files).length} CSVs + manifest.json to ${OUT_DIR}`);
}

main();
