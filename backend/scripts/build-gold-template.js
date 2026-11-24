'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseArgs, loadDocuments, capDocuments, inspectPdfPages } = require('./benchmark-pdf-engines');
const { selectSample } = require('./lib/selection');
const { extractOibs, extractDates, extractFilingNumbers } = require('./lib/metrics');
const { FILING_NUMBER_PATTERN, canonicalCurrency } = require('./lib/canonicalize');
const { normalizeGoldFacts, summarizeGold } = require('./lib/gold-editor');
const { extractTextFromFile } = require('../court-analysis/agents/analysis-agent');

const OUTPUT_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');
const TRANSCRIPT_ROOT = path.join(OUTPUT_ROOT, 'fixtures', 'transcripts');
const createGoldSetId = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;

function templateFileName(docId) {
    return `${crypto.createHash('sha256').update(String(docId)).digest('hex').slice(0, 16)}.json`;
}

function resolveGoldDir(input, outputRoot = OUTPUT_ROOT) {
    if (!input) return null;
    const direct = path.resolve(String(input));
    if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
        return path.basename(direct) === 'gold' ? direct : (fs.existsSync(path.join(direct, 'gold')) ? path.join(direct, 'gold') : direct);
    }
    const bySetId = path.join(outputRoot, String(input), 'gold');
    if (fs.existsSync(bySetId) && fs.statSync(bySetId).isDirectory()) return bySetId;
    throw new Error(`Gold source directory not found: ${input}`);
}

function findLatestGoldDir(outputRoot = OUTPUT_ROOT) {
    if (!fs.existsSync(outputRoot)) return null;
    const candidates = [];
    for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[0-9TZ-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
        const dir = path.join(outputRoot, entry.name, 'gold');
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter((name) => /^[a-f0-9]{16}\.json$/.test(name));
        if (!files.length) continue;
        let completedCount = 0;
        for (const file of files) {
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
                if (summarizeGold(parsed).complete) completedCount += 1;
            } catch { /* ignore unreadable template */ }
        }
        candidates.push({ setId: entry.name, dir, completedCount, totalCount: files.length });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => (b.completedCount - a.completedCount) || b.setId.localeCompare(a.setId));
    return candidates[0].dir;
}

function loadExistingGoldByDocId(goldDir) {
    const map = new Map();
    if (!goldDir || !fs.existsSync(goldDir)) return map;
    for (const file of fs.readdirSync(goldDir).filter((name) => name.endsWith('.json'))) {
        try {
            const template = JSON.parse(fs.readFileSync(path.join(goldDir, file), 'utf8'));
            const docId = template?.document?.docId || template?.docId;
            if (docId) map.set(docId, template);
        } catch { /* ignore malformed template */ }
    }
    return map;
}

function extractDraftGoldFactsFromText(rawText) {
    const text = String(rawText || '');
    if (!text.trim()) {
        return { amounts: [], oibs: [], dates: [], filingNumbers: [], decisionOutcome: '', tables: [] };
    }
    const scrubbed = text
        .replace(/\b\d{11}\b/g, ' ')
        .replace(/\b\d{1,2}\.\d{1,2}\.\d{4}\.?(?:\s*\d{1,2}:\d{2})?/g, ' ')
        .replace(FILING_NUMBER_PATTERN, ' ');
    const amountMatches = [];
    const seenAmounts = new Set();
    const amountRe = /(?<!\d)(\d{1,3}(?:[.,\s]\d{3})+(?:[,.]\d{2})|\d+[,.]\d{2})(?!\d)\s*(EUR|HRK|kn\.?|kuna|€)/giu;
    for (const match of scrubbed.matchAll(amountRe)) {
        const rawValue = match[1].replace(/\s+/g, '');
        const currency = canonicalCurrency(match[2]);
        if (currency !== 'EUR' && currency !== 'HRK') continue;
        const key = `${rawValue}|${currency}`;
        if (seenAmounts.has(key)) continue;
        seenAmounts.add(key);
        amountMatches.push({ rawValue, currency });
    }
    const oibs = extractOibs(text).map((value) => ({ value }));
    const dates = extractDates(text);
    const filingNumbers = extractFilingNumbers(text);
    const { facts } = normalizeGoldFacts({
        amounts: amountMatches,
        oibs,
        dates,
        filingNumbers,
        decisionOutcome: '',
        tables: [],
    });
    return facts;
}

async function readSourceTextForDraft(doc, transcriptRoot = TRANSCRIPT_ROOT) {
    const transcriptFile = path.join(transcriptRoot, `${doc.docId}.json`);
    if (fs.existsSync(transcriptFile)) {
        try {
            const fixture = JSON.parse(fs.readFileSync(transcriptFile, 'utf8'));
            if (typeof fixture?.canonicalTranscript?.text === 'string' && fixture.canonicalTranscript.text.trim()) {
                return fixture.canonicalTranscript.text;
            }
        } catch { /* fall back to local extraction */ }
    }
    if (doc.filePath && fs.existsSync(doc.filePath)) {
        const extracted = await extractTextFromFile(doc.filePath);
        return extracted.text || '';
    }
    return '';
}

async function main(argv = process.argv.slice(2)) {
    const args = parseArgs(argv);
    const all = loadDocuments(args);
    const docs = args.docs?.length || args['doc-id']?.length ? all : args.sample ? selectSample(all, Number(args.sample), Number(args.seed || 1)) : all;
    capDocuments(docs, args);
    const carryDir = args['carry-from']
        ? resolveGoldDir(args['carry-from'])
        : args['carry-latest'] ? findLatestGoldDir() : null;
    const existingByDocId = loadExistingGoldByDocId(carryDir);
    const prefillDrafts = Boolean(args['prefill-drafts']);

    const goldSetId = createGoldSetId();
    const outputDir = path.join(OUTPUT_ROOT, goldSetId, 'gold');
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const written = [];
    let carriedCount = 0;
    let prefilledCount = 0;
    for (const doc of docs) {
        const pages = await inspectPdfPages(doc);
        const existing = existingByDocId.get(doc.docId);
        let facts = {
            amounts: [],
            oibs: [],
            dates: [],
            filingNumbers: [],
            decisionOutcome: '',
            tables: [],
        };
        let factsComplete = false;
        let reviewedCategories = [];

        if (existing && (summarizeGold(existing).complete || Object.values(existing.facts || {}).some((v) => Array.isArray(v) ? v.length > 0 : Boolean(v)))) {
            const normalized = normalizeGoldFacts(existing.facts || {});
            facts = normalized.facts;
            factsComplete = existing.factsComplete === true;
            reviewedCategories = Array.isArray(existing.reviewedCategories) ? existing.reviewedCategories : [];
            carriedCount += 1;
        } else if (prefillDrafts) {
            const sourceText = await readSourceTextForDraft(doc);
            if (sourceText.trim()) {
                facts = extractDraftGoldFactsFromText(sourceText);
                prefilledCount += 1;
            }
        }

        const content = {
            schemaVersion: 2,
            factsComplete,
            reviewedCategories,
            document: {
                docId: doc.docId,
                title: doc.title || existing?.document?.title || path.basename(doc.filePath),
                fileName: path.basename(doc.filePath),
                pages,
                textLayer: doc.textLayer ?? existing?.document?.textLayer ?? null,
                tableHeavy: doc.tableHeavy ?? existing?.document?.tableHeavy ?? null,
            },
            facts,
            instructions: {
                amounts: 'Add one item per source-stated amount: {"rawValue":"1.234,56","currency":"EUR|HRK|kn"}. Preserve the source spelling.',
                oibs: 'Add {"value":"11 digits","role":"explicit legal role"}; do not infer roles.',
                dates: 'Add Croatian source dates exactly as printed (dd.mm.yyyy.).',
                filingNumbers: 'Preserve register prefixes, e.g. St-2/2013, P-2/2020, Pz-3/2022.',
                tables: 'One entry per table: {"description":"table name","rowCount":N}, where N counts data rows only (exclude headings and totals). Put line amounts in amounts, not here.',
            },
        };
        const file = path.join(outputDir, templateFileName(doc.docId));
        fs.writeFileSync(file, JSON.stringify(content, null, 2), { mode: 0o600 });
        written.push(file);
    }
    console.log(JSON.stringify({ goldSetId, outputDir, count: written.length, carriedCount, prefilledCount, carryFrom: carryDir, templates: written }, null, 2));
    return { goldSetId, outputDir, count: written.length, carriedCount, prefilledCount, carryFrom: carryDir, templates: written };
}

if (require.main === module) main().catch((error) => { console.error(`[build-gold-template] ${error.message}`); process.exitCode = 1; });
module.exports = { main, createGoldSetId, templateFileName, resolveGoldDir, findLatestGoldDir, loadExistingGoldByDocId, extractDraftGoldFactsFromText };
