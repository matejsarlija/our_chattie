#!/usr/bin/env node
/**
 * Change-check CLI (Phase B1): "what changed since last time?" for one query.
 *
 *   npm run check:changes -- --oib=66124057408
 *   npm run check:changes -- --case=St-2/2013
 *   npm run check:changes -- --text=KERUM
 *
 * Fetches the COMPLETE CSV export, reduces it to a snapshot, diffs it against
 * the locally stored latest snapshot, persists both, and prints a summary.
 *
 * Flags: exactly one of --oib= | --case= | --text= is required; --json emits
 * the raw ChangeDiff instead of the human-readable summary.
 * Exit codes: 0 = unchanged, 1 = changes detected (incl. first-run baseline),
 * 2 = error.
 */
require('dotenv').config();

const { createChangeCheckService } = require('../change-detection/service');
const { hasChanges } = require('../change-detection/diff');
const { parseCourtAnalysisRequest } = require('../helpers/courtAnalysisRequest');
const { friendlyAnalysisErrorMessage } = require('../helpers/friendlyAnalysisError');

const USAGE = `Usage: npm run check:changes -- [--json] <--oib=<value> | --case=<value> | --text=<value>>

Examples:
  npm run check:changes -- --oib=66124057408
  npm run check:changes -- --case=St-2/2013
  npm run check:changes -- --text=KERUM --json

Exit codes: 0 unchanged, 1 changes detected, 2 error.`;

function parseArgs(argv) {
    const parsed = { oib: null, caseNumber: null, text: null, json: false };
    for (const arg of argv || []) {
        if (arg.startsWith('--oib=')) parsed.oib = arg.slice('--oib='.length).trim();
        else if (arg.startsWith('--case=')) parsed.caseNumber = arg.slice('--case='.length).trim();
        else if (arg.startsWith('--text=')) parsed.text = arg.slice('--text='.length).trim();
        else if (arg === '--json') parsed.json = true;
    }

    const provided = ['oib', 'caseNumber', 'text'].filter((key) => parsed[key]);
    if (provided.length === 0) {
        return { error: 'Exactly one of --oib/--case/--text is required.' };
    }
    if (provided.length > 1) {
        return { error: `Only one query flag allowed (got: ${provided.map((k) => `--${k}`).join(', ')}).` };
    }

    const typeByFlag = { oib: 'oib', caseNumber: 'case_number', text: 'text' };
    const value = parsed[provided[0]];
    if (!value) {
        return { error: 'Query value must not be empty.' };
    }

    // Reuse the backend request validation/classifier so query resolution
    // matches the API path exactly — never inferred from CSV data.
    try {
        const resolved = parseCourtAnalysisRequest({
            query: { type: typeByFlag[provided[0]], value }
        });
        return { query: resolved.query, json: parsed.json };
    } catch (err) {
        return { error: err.message };
    }
}

function formatSummary(result) {
    const lines = [];
    const { type, value } = result.query;
    const typeLabel = type === 'oib' ? 'OIB' : type === 'case_number' ? 'Predmet' : 'Tekst';

    lines.push(`Provjera promjena (${typeLabel}: ${value})`);
    lines.push(`Snapshot ${result.snapshot.snapshotId} @ ${result.snapshot.capturedAt} — ${result.snapshot.entryCount} objava (izvoz: ${result.snapshot.rowCount} redaka)`);
    lines.push('');

    if (result.baseline) {
        lines.push('PRVO SNIMANJE: spremljena početna snapshot (baseline). Nema čime uspoređivati.');
    } else {
        lines.push(`PROMJENE: +${result.diff.counts.added} novo / -${result.diff.counts.removed} uklonjeno / ~${result.diff.counts.modified} izmijenjeno / =${result.diff.counts.unchanged} nepromijenjeno`);
    }

    if (result.diff.entityDrift) {
        lines.push('UPOZORENJE: entitet je drift — skup OIB-a dužnika razlikuje se između snapshotova!');
    }
    for (const warning of result.warnings) {
        lines.push(`UPOZORENJE: ${warning}`);
    }

    for (const guid of result.diff.added) {
        lines.push(`  + Novo: ${guid}`);
    }
    for (const guid of result.diff.removed) {
        lines.push(`  - Uklonjeno: ${guid}`);
    }
    for (const mod of result.diff.modified) {
        lines.push(`  ~ Izmijenjeno: ${mod.guid} [${mod.changedFields.join(', ')}]`);
        for (const field of mod.changedFields) {
            lines.push(`      ${field}: ${JSON.stringify(mod.before[field])} -> ${JSON.stringify(mod.after[field])}`);
        }
    }

    lines.push('');
    lines.push(result.persisted && result.persisted.ok
        ? 'Spremljeno: novi snapshot + diff povijest ažurirana.'
        : 'UPOZORENJE: rezultat NIJE bio moguće spremiti lokalno.');

    return lines.join('\n');
}

/**
 * Runs one CLI check. Returns `{ code, output }` so tests can assert behavior;
 * the bin entry point maps `code` onto process.exitCode.
 */
async function runCheckChanges(argv, dependencies = {}) {
    const args = parseArgs(argv);
    if (args.error) {
        return { code: 2, output: `${args.error}\n\n${USAGE}` };
    }

    const service = dependencies.service || createChangeCheckService();
    let result;
    try {
        result = await service.runCheck(args.query);
    } catch (err) {
        const friendly = friendlyAnalysisErrorMessage(err, { stage: 'discovering' });
        const technical = process.env.LOG_LEVEL === 'debug' ? `\n[${err.name}] ${err.message}` : '';
        return { code: 2, output: `${friendly}${technical}` };
    }

    if (args.json) {
        return { code: hasChanges(result.diff) ? 1 : 0, output: JSON.stringify(result.diff, null, 2) };
    }
    return { code: hasChanges(result.diff) ? 1 : 0, output: formatSummary(result) };
}

async function main() {
    const { code, output } = await runCheckChanges(process.argv.slice(2));
    console.log(output);
    process.exitCode = code;
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err && err.stack ? err.stack : err);
        process.exitCode = 2;
    });
}

module.exports = { runCheckChanges, parseArgs, formatSummary, USAGE };
