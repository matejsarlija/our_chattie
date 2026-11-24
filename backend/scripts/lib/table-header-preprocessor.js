'use strict';

const REQUIRED_HEADER_GROUPS = [
    /(?:vjerovnik|naziv)/i,
    /\boib\b/i,
    /(?:adresa|sjedište|sjediste)/i,
    /(?:iznos|tražbin|potraživ)/i,
    /(?:namiren|postot|%)/i,
];
const DATA_ROW = /^\d{1,4}\.\s+\p{L}/u;

function extractTableHeader(text) {
    const source = String(text || '');
    const firstPage = source
        .split(/\f|\[page\s*2\b|---\s*page\s*2|\n\s*2\s*\n\s*R\.\s*\n/i)[0];
    const lines = firstPage.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const tableStart = lines.findIndex((line) => /\btabela\b/i.test(line));
    if (tableStart < 0) return '';
    const dataStart = lines.findIndex((line, index) => index > tableStart && DATA_ROW.test(line));
    if (dataStart < 0) return '';
    const headerLines = lines.slice(tableStart, dataStart);
    const headerBlock = headerLines.join('\n');
    return REQUIRED_HEADER_GROUPS.every((pattern) => pattern.test(headerBlock))
        ? headerBlock
        : '';
}

function applyHeaderPreservation(chunks, headerText) {
    const header = String(headerText || '').trim();
    if (!header) return chunks;
    return chunks.map((chunk, index) => index === 0 ? chunk : {
        ...chunk,
        text: `[Document Table Headers / Context]:\n${header}\n\n[Chunk Content]:\n${chunk.text}`,
    });
}

module.exports = { extractTableHeader, applyHeaderPreservation };
