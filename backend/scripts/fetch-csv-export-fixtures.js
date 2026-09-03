#!/usr/bin/env node
/**
 * Fetch real e-Oglasna CSV export fixtures for the csv-export discovery lane.
 *
 * The e-Oglasna "Izvoz podataka" endpoint returns the ENTIRE result set for a
 * query as CSV in a single GET (no pagination, no auth). This script re-captures
 * those exports so the frozen fixtures in tests/fixtures/csv-export/ can be
 * refreshed from live data.
 *
 * Unlike the real-document fixtures (which are gitignored binaries), these CSV
 * metadata fixtures are committed: they are plain text and CI uses them for
 * deterministic, offline regression tests.
 *
 * Usage:
 *   node scripts/fetch-csv-export-fixtures.js
 *   node scripts/fetch-csv-export-fixtures.js --oib=66124057408 --case=St-2/2013 --text=KERUM
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://e-oglasna.pravosudje.hr';
const EXPORT_PATH = '/objave/izvoz/csv';
const FIXTURES_DIR = path.resolve(__dirname, '../tests/fixtures/csv-export');

function parseArgs(argv) {
    const args = { oib: '66124057408', caseNumber: 'St-2/2013', text: 'KERUM' };
    for (const raw of argv) {
        if (raw.startsWith('--oib=')) args.oib = raw.slice('--oib='.length).trim();
        else if (raw.startsWith('--case=')) args.caseNumber = raw.slice('--case='.length).trim();
        else if (raw.startsWith('--text=')) args.text = raw.slice('--text='.length).trim();
    }
    return args;
}

function slugify(text) {
    return String(text || '')
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .toLowerCase()
        .slice(0, 48);
}

async function fetchExport(queryValue, queryType) {
    const url = `${BASE_URL}${EXPORT_PATH}?text=${encodeURIComponent(queryValue)}&sort=datePublished,desc`;
    const response = await axios.get(url, { responseType: 'text', timeout: 60000 });
    if (response.status !== 200) {
        throw new Error(`Export returned HTTP ${response.status} for "${queryValue}"`);
    }
    const body = String(response.data || '');
    if (!body.trim()) {
        throw new Error(`Empty export body for "${queryValue}"`);
    }
    const filename = `${queryType}-${slugify(queryValue)}.csv`;
    const filePath = path.join(FIXTURES_DIR, filename);
    fs.writeFileSync(filePath, body, 'utf8');
    const rowCount = body.trim().split('\n').length - 1;
    return { filePath, rowCount, queryValue, queryType };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });

    const targets = [
        { value: args.oib, type: 'oib' },
        { value: args.caseNumber, type: 'case-number' },
        { value: args.text, type: 'text' }
    ];

    for (const target of targets) {
        try {
            const result = await fetchExport(target.value, target.type);
            console.log(`[csv-fixtures] Wrote ${result.filePath} (${result.rowCount} data rows)`);
        } catch (err) {
            console.error(`[csv-fixtures] Failed to fetch "${target.value}": ${err.message}`);
            process.exitCode = 1;
        }
    }
}

main();
