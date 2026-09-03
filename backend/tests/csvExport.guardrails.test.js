const path = require('path');
const fs = require('fs');
const { parseCsvExport } = require('../scraper/csvExportParser');
const { mapCsvRowsToEntries } = require('../court-analysis/utils/csvFieldMapping');
const { groupEntriesByCase } = require('../court-analysis/utils/grouping');
const { normalizeCaseNumber } = require('../court-analysis/utils/caseNumber');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'csv-export');

// Mirrors pipeline.normalizeEntryForGrouping so grouping runs over the same
// top-level `caseNumber` the pipeline computes.
function normalizeEntry(entry) {
    const normalized = normalizeCaseNumber(entry.caseInfo.caseNumber) || 'N/A';
    return { ...entry, caseNumber: normalized, caseInfo: { ...entry.caseInfo, caseNumber: normalized } };
}

const rows = parseCsvExport(fs.readFileSync(path.join(FIXTURES_DIR, 'oib-66124057408.csv'), 'utf8')).rows;
const entries = mapCsvRowsToEntries(rows).map(normalizeEntry);
const clusters = groupEntriesByCase(entries);

describe('CSV export cluster-scoped guardrails', () => {
    test('groups the complete OIB export into the recorded distinct case set', () => {
        expect(clusters).toHaveLength(25);
        expect(clusters.every((c) => c.isAnonymous === false)).toBe(true);
    });

    test('keeps the register-prefix case number distinct from St-2/2013', () => {
        const byCase = Object.fromEntries(clusters.map((c) => [c.caseNumber, c]));

        expect(byCase['ST-2/2013']).toBeDefined();
        expect(byCase['4 ST-2/2013']).toBeDefined();

        // The prefixed case is its own cluster, never merged into St-2/2013.
        expect(byCase['4 ST-2/2013'].entries).toHaveLength(2);
        for (const entry of byCase['ST-2/2013'].entries) {
            expect(entry.caseNumber).toBe('ST-2/2013');
        }
        for (const entry of byCase['4 ST-2/2013'].entries) {
            expect(entry.caseNumber).toBe('4 ST-2/2013');
        }
    });

    test('every mapped entry carries an authoritative 11-digit debtor OIB', () => {
        for (const entry of entries) {
            expect(entry.caseInfo.debtorOib).toMatch(/^\d{11}$/);
        }
    });

    test('typed-query resolution is not part of the CSV path (backend classifier owns it)', () => {
        // The CSV client takes a raw search term; query.type is resolved upstream
        // by the backend classifier and never inferred from CSV columns.
        expect(mapCsvRowsToEntries(rows)[0].caseInfo).not.toHaveProperty('queryType');
    });
});
