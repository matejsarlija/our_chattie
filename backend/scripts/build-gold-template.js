'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseArgs, loadDocuments, capDocuments, inspectPdfPages } = require('./benchmark-pdf-engines');
const { selectSample } = require('./lib/selection');

const OUTPUT_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');
const createGoldSetId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const all = loadDocuments(args);
    const docs = args.docs?.length || args['doc-id']?.length ? all : args.sample ? selectSample(all, Number(args.sample), Number(args.seed || 1)) : all;
    capDocuments(docs, args);
    const goldSetId = createGoldSetId();
    const outputDir = path.join(OUTPUT_ROOT, goldSetId, 'gold');
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const written = [];
    for (const doc of docs) {
        const pages = await inspectPdfPages(doc);
        const content = {
            schemaVersion: 2,
            factsComplete: false,
            reviewedCategories: [],
            document: {
                docId: doc.docId,
                title: doc.title || path.basename(doc.filePath),
                fileName: path.basename(doc.filePath),
                pages,
                textLayer: doc.textLayer ?? null,
                tableHeavy: doc.tableHeavy ?? null,
            },
            facts: {
                amounts: [],
                oibs: [],
                dates: [],
                filingNumbers: [],
                decisionOutcome: '',
                tables: [],
            },
            instructions: {
                amounts: 'Add one item per source-stated amount: {"rawValue":"1.234,56","currency":"EUR|HRK|kn"}. Preserve the source spelling.',
                oibs: 'Add {"value":"11 digits","role":"explicit legal role"}; do not infer roles.',
                dates: 'Add Croatian source dates exactly as printed (dd.mm.yyyy.).',
                filingNumbers: 'Preserve register prefixes, e.g. St-2/2013, P-2/2020, Pz-3/2022.',
                tables: 'One entry per table: {"description":"table name","rowCount":N}, where N counts data rows only (exclude headings and totals). Put line amounts in amounts, not here.',
            },
        };
        const file = path.join(outputDir, `${crypto.createHash('sha256').update(doc.docId).digest('hex').slice(0, 16)}.json`);
        fs.writeFileSync(file, JSON.stringify(content, null, 2), { mode: 0o600 });
        written.push(file);
    }
    console.log(JSON.stringify({ goldSetId, outputDir, count: written.length, templates: written }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(`[build-gold-template] ${error.message}`); process.exitCode = 1; });
module.exports = { main, createGoldSetId };
