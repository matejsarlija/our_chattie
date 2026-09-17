const path = require('path');
const fs = require('fs');
const { parseCsv, parseCsvExport, REQUIRED_COLUMNS, stripBom } = require('../scraper/csvExportParser');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'csv-export');

function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

describe('parseCsv (low-level)', () => {
    test('parses a simple comma-separated grid', () => {
        expect(parseCsv('a,b,c\n1,2,3')).toEqual([
            ['a', 'b', 'c'],
            ['1', '2', '3']
        ]);
    });

    test('handles quoted fields with embedded commas', () => {
        expect(parseCsv('"a,b",c\n"x,y",z')).toEqual([
            ['a,b', 'c'],
            ['x,y', 'z']
        ]);
    });

    test('handles escaped double quotes', () => {
        expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', 'b']]);
    });

    test('handles embedded newlines inside quoted fields', () => {
        expect(parseCsv('"line1\nline2",b')).toEqual([['line1\nline2', 'b']]);
    });

    test('handles CRLF line endings', () => {
        expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
            ['a', 'b'],
            ['1', '2']
        ]);
    });

    test('does not emit a trailing empty row for a trailing newline', () => {
        expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
    });

    test('parses empty fields', () => {
        expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]);
    });
});

describe('stripBom', () => {
    test('strips a leading UTF-8 BOM', () => {
        expect(stripBom('\uFEFFhello')).toBe('hello');
    });

    test('leaves non-BOM text untouched', () => {
        expect(stripBom('hello')).toBe('hello');
    });
});

describe('parseCsvExport', () => {
    test('parses the real OIB fixture into header-keyed rows', () => {
        const result = parseCsvExport(readFixture('oib-66124057408.csv'));
        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(381);
        expect(result.rows[0]['Oznaka spisa']).toBe('St-2/2013');
        expect(result.rows[0]['OIB stečajnog dužnika']).toBe('66124057408');
    });

    test('parses the case-number fixture', () => {
        const result = parseCsvExport(readFixture('case-number-st-2-2013.csv'));
        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(358);
    });

    test('parses the text-query fixture', () => {
        const result = parseCsvExport(readFixture('text-kerum.csv'));
        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(413);
    });

    test('returns schema-drift when a required column is missing', () => {
        const result = parseCsvExport(readFixture('drift-missing-oib-column.csv'));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('schema-drift');
        expect(result.missingColumns).toContain('OIB stečajnog dužnika');
    });

    test('returns schema-drift for a non-CSV (HTML) body', () => {
        const result = parseCsvExport(readFixture('broken-not-csv.csv'));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('schema-drift');
        expect(result.missingColumns).toEqual(expect.arrayContaining(REQUIRED_COLUMNS));
    });

    test('returns empty for a blank body', () => {
        expect(parseCsvExport('').ok).toBe(false);
        expect(parseCsvExport('   \n  ').ok).toBe(false);
        expect(parseCsvExport(null).ok).toBe(false);
    });

    test('pads short rows and ignores extra cells (relax_column_count)', () => {
        const header = [...REQUIRED_COLUMNS, 'Extra'];
        const headerLine = header.map((c) => `"${c}"`).join(',');
        const shortRow = ['"St-1/2020"', '"Naslov"'].join(',');
        const longRow = [...header.map((c) => `"${c}=v"`), '"extra1"', '"extra2"'].join(',');
        const result = parseCsvExport(`${headerLine}\n${shortRow}\n${longRow}`);

        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(2);

        const short = result.rows[0];
        expect(short['Oznaka spisa']).toBe('St-1/2020');
        expect(short['Naslov']).toBe('Naslov');
        expect(short['Sud']).toBe('');
        expect(short['Dokumenti (link)']).toBe('');

        const long = result.rows[1];
        expect(long['Oznaka spisa']).toBe('Oznaka spisa=v');
        expect(long.Extra).toBe('Extra=v');
        expect(Object.values(long)).not.toContain('extra1');
        expect(Object.values(long)).not.toContain('extra2');
    });
});
