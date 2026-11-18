'use strict';

const crypto = require('crypto');
const path = require('path');
const { resolveFixturePath } = require('./arms');

function seededRandom(seed) {
    const numericSeed = typeof seed === 'number' || /^\d+$/.test(String(seed))
        ? Number(seed)
        : Number.parseInt(crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16);
    let state = numericSeed >>> 0;
    if (!state) state = 0x6d2b79f5;
    return () => {
        state += 0x6d2b79f5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function stableShuffle(items, seed) {
    const values = [...items];
    const random = seededRandom(seed);
    for (let i = values.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}

function pageBucket(pages) {
    if (pages <= 2) return '1-2';
    if (pages <= 10) return '3-10';
    return '11+';
}

function normalizeDocument(doc) {
    const extraction = doc.extraction || {};
    const pages = Number(extraction.pages || doc.pages || 0);
    const title = `${doc.title || ''} ${doc.entryName || ''} ${path.basename(doc.filePath || '')}`;
    return {
        ...doc,
        pages,
        textLayer: extraction.textLayer === 'embedded' || extraction.textLayer === true,
        pageBucket: pageBucket(pages),
        tableHeavy: Boolean(doc.tableHeavy || /troškovnik|popis|tablica|diobeni|obračun|registar|tražbin/i.test(title)),
    };
}

function flattenManifest(manifest, fixtureRoot) {
    const docs = [];
    for (const entry of manifest.entries || []) {
        for (const file of entry.files || []) {
            const resolved = resolveFixturePath(file.filePath || file.entryName, fixtureRoot);
            if (!resolved || path.extname(resolved).toLowerCase() !== '.pdf') continue;
            docs.push(normalizeDocument({
                docId: `${entry.index || ''}:${file.entryName || path.basename(resolved)}`,
                filePath: resolved,
                entryName: file.entryName,
                title: entry.title,
                caseNumber: entry.caseNumber,
                date: entry.date,
                extraction: file.extraction || {},
                sourceSha256: file.sha256 || null,
            }));
        }
    }
    return docs;
}

function stratify(docs) {
    const buckets = new Map();
    for (const doc of docs) {
        const key = `${doc.textLayer ? 'text' : 'scan'}|${doc.pageBucket}|${doc.tableHeavy ? 'table' : 'other'}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(doc);
    }
    return buckets;
}

function selectSample(docs, count, seed = 1) {
    if (!Number.isInteger(count) || count < 1) return [];
    const groups = [...stratify(docs).entries()].sort(([a], [b]) => a.localeCompare(b));
    const shuffled = groups.map(([key, values]) => [key, stableShuffle(values, `${seed}:${key}`)]);
    const selected = [];
    let round = 0;
    while (selected.length < count) {
        let added = false;
        for (const [, values] of shuffled) {
            if (values[round]) { selected.push(values[round]); added = true; }
            if (selected.length >= count) break;
        }
        if (!added) break;
        round += 1;
    }
    return selected;
}

module.exports = { seededRandom, stableShuffle, pageBucket, normalizeDocument, flattenManifest, stratify, selectSample };
