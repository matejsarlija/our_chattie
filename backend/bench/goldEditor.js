'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const goldEditorLib = require('../scripts/lib/gold-editor');
const goldAssistLib = require('../scripts/lib/gold-assist');
const goldLib = require('../scripts/lib/gold');
const { renderPdfPage } = require('../scripts/lib/arms');
const { loadDocuments, inspectPdfPages } = require('../scripts/benchmark-pdf-engines');
const { DEFAULT_DATA_ROOT, corpusDocuments } = require('./corpus');

const PAGE_CACHE = new Map();
const PAGE_CACHE_LIMIT = 80;

function readGoldTemplateRecord(dir, file) {
    const template = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const summary = goldEditorLib.summarizeGold(template);
    return {
        file,
        docId: template.document?.docId || null,
        title: template.document?.title || null,
        pages: template.document?.pages || null,
        summary: { ...summary, facts: goldEditorLib.factCount(summary) },
        template,
    };
}

function listGoldSets(dataRoot = DEFAULT_DATA_ROOT) {
    if (!fs.existsSync(dataRoot)) return [];
    const sets = [];
    for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[0-9TZ-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
        const dir = path.join(dataRoot, entry.name, 'gold');
        if (!fs.existsSync(dir)) continue;
        const documents = [];
        for (const file of fs.readdirSync(dir).filter((name) => /^[a-f0-9]{16}\.json$/.test(name))) {
            try {
                documents.push(readGoldTemplateRecord(dir, file));
            } catch {
                // Skip unreadable templates.
            }
        }
        if (!documents.length) continue;
        documents.sort((a, b) => String(a.docId).localeCompare(String(b.docId), 'hr'));
        sets.push({ setId: entry.name, documents: documents.map(({ template, ...rest }) => rest) });
    }
    return sets.sort((a, b) => b.setId.localeCompare(a.setId));
}

function getGoldTemplate({ set, file, dataRoot = DEFAULT_DATA_ROOT }) {
    const { filePath } = goldEditorLib.resolveGoldTarget(dataRoot, set, file);
    if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
    const template = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const summary = goldEditorLib.summarizeGold(template);
    return {
        template,
        summary: { ...summary, facts: goldEditorLib.factCount(summary) },
    };
}

function saveGoldTemplate({ set, file, facts: rawFacts, factsComplete, reviewedCategories: rawReviewed, dataRoot = DEFAULT_DATA_ROOT }) {
    const { filePath } = goldEditorLib.resolveGoldTarget(dataRoot, set, file);
    if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { facts, errors } = goldEditorLib.normalizeGoldFacts(rawFacts);
    if (errors.length) {
        const err = new Error(errors[0]);
        err.statusCode = 400;
        err.errors = errors;
        throw err;
    }
    const complete = factsComplete === true;
    const reviewedCategories = goldEditorLib.normalizeReviewedCategories(rawReviewed);
    const missingReviews = goldEditorLib.GOLD_CATEGORIES.filter((category) => !reviewedCategories.includes(category));
    if (complete && missingReviews.length) {
        const err = new Error('Review every fact category against the source before marking complete.');
        err.statusCode = 400;
        err.errors = missingReviews.map((category) => `Review ${category}.`);
        throw err;
    }
    const next = { ...existing, facts, reviewedCategories, factsComplete: complete };
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(temp, filePath);
    const summary = goldEditorLib.summarizeGold(next);
    return { ok: true, summary: { ...summary, facts: goldEditorLib.factCount(summary) } };
}

async function renderGoldPage({ set, file, page, dataRoot = DEFAULT_DATA_ROOT }) {
    const { filePath } = goldEditorLib.resolveGoldTarget(dataRoot, set, file);
    if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
    const template = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const docId = template.document?.docId;
    const totalPages = Number(template.document?.pages || 1);
    const doc = corpusDocuments(docId).get(docId);
    if (!doc) throw new Error('No local PDF is available for this template.');
    const pageNum = Number(page);
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > 200) {
        throw new Error('Page must be a whole number between 1 and 200.');
    }
    const key = `${doc.docId}#${pageNum}`;
    let buffer;
    if (PAGE_CACHE.has(key)) {
        buffer = PAGE_CACHE.get(key);
    } else {
        buffer = await renderPdfPage(doc.filePath, pageNum);
        if (PAGE_CACHE.size >= PAGE_CACHE_LIMIT) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);
        PAGE_CACHE.set(key, buffer);
    }
    const etag = `"${crypto.createHash('sha1').update(buffer).digest('hex')}"`;
    return { buffer, etag, totalPages };
}

async function suggestGoldForTemplate({ set, file, model, apiKey, dataRoot = DEFAULT_DATA_ROOT }) {
    const { filePath } = goldEditorLib.resolveGoldTarget(dataRoot, set, file);
    if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
    const template = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const docId = template.document?.docId;
    if (!docId) throw new Error('The gold template has no source document ID.');
    const [doc] = loadDocuments({ 'doc-id': [docId] });
    if (!doc) throw new Error('The local PDF for this gold template is unavailable.');
    const suggestion = await goldAssistLib.suggestGoldFacts({
        filePath: doc.filePath,
        filename: path.basename(doc.filePath),
        pages: await inspectPdfPages(doc),
        model: model || goldAssistLib.DEFAULT_GOLD_MODEL,
        apiKey,
    });
    return { ...suggestion, docId, set, file };
}

module.exports = {
    ...goldEditorLib,
    ...goldAssistLib,
    ...goldLib,
    listGoldSets,
    getGoldTemplate,
    saveGoldTemplate,
    renderGoldPage,
    suggestGoldForTemplate,
};
