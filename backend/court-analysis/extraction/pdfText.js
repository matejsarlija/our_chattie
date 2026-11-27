'use strict';

const fs = require('node:fs');
const path = require('node:path');
const mammoth = require('mammoth');
const WordExtractor = require('word-extractor');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');

pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

const PDFJS_STANDARD_FONT_DATA_URL = (() => {
    const fontsDir = path.join(
        path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')),
        '..',
        '..',
        'standard_fonts',
    );
    return fs.existsSync(fontsDir) ? fontsDir + path.sep : null;
})();

const EXTRACTION_ERROR_CODES = Object.freeze({
    FILE_NOT_FOUND: 'file-not-found',
    UNSUPPORTED_TYPE: 'unsupported-type',
    PDF_PARSE_FAILED: 'pdf-parse-failed',
    DOCX_PARSE_FAILED: 'docx-parse-failed',
    DOC_PARSE_FAILED: 'doc-parse-failed',
    TXT_READ_FAILED: 'txt-read-failed',
    OCR_TIMEOUT: 'ocr-timeout',
    OCR_FAILED: 'ocr-failed',
    OCR_PARTIAL: 'ocr-partial',
    PDF_TOO_LARGE: 'pdf-too-large',
    PDF_PAGE_LIMIT_EXCEEDED: 'pdf-page-limit-exceeded',
    HTML_AS_PDF: 'html-as-pdf',
    PDF_ENCRYPTED: 'pdf-encrypted',
    PDF_CORRUPT: 'pdf-corrupt',
    EMPTY_DOCUMENT: 'empty-document',
    PROVIDER_CREDITS_EXHAUSTED: 'provider-credits-exhausted',
    OCR_PAGE_CAP: 'ocr-page-cap',
});

const DEFAULT_OCR_RENDER_SCALE = 1;
const DEFAULT_OCR_IMAGE_LONG_EDGE = 2000;

function resolveOcrRenderScale() {
    const raw = Number(process.env.OCR_RENDER_SCALE);
    return Number.isFinite(raw) && raw >= 0.5 && raw <= 6 ? raw : DEFAULT_OCR_RENDER_SCALE;
}

function resolveOcrImageLongEdge() {
    const raw = Number.parseInt(process.env.OCR_IMAGE_LONG_EDGE, 10);
    return Number.isFinite(raw) && raw >= 512 && raw <= 4096 ? raw : DEFAULT_OCR_IMAGE_LONG_EDGE;
}

function isPdfJsMocked() {
    if (pdfjsLib?.getDocument?._isMockFunction) return true;
    if (typeof jest !== 'undefined' && !pdfjsLib?.version) return true;
    return false;
}

function isCanvasMocked() {
    return Boolean(createCanvas?._isMockFunction);
}

function buildPageRanges(pageTexts, pageNumbers = pageTexts.map((_, index) => index + 1)) {
    let cursor = 0;
    return pageTexts.map((pageText, index) => {
        const startIndex = cursor;
        const endIndex = startIndex + String(pageText || '').length;
        cursor = endIndex + 2;
        return { pageNumber: pageNumbers[index], startIndex, endIndex };
    });
}

function pageRangesFromMarkedText(text) {
    const markers = [...String(text || '').matchAll(/^=== STRANICA (\d+) ===\s*$/gm)];
    return markers.map((marker, index) => ({
        pageNumber: Number(marker[1]),
        startIndex: marker.index,
        endIndex: markers[index + 1]?.index ?? String(text).length,
    }));
}

function pageNumbersForRange(pageRanges, startIndex, endIndex) {
    return (pageRanges || [])
        .filter((page) => page.endIndex > startIndex && page.startIndex < endIndex)
        .map((page) => page.pageNumber);
}

function buildExtractionResult(overrides = {}) {
    return {
        text: '',
        method: null,
        pages: 0,
        pageRanges: [],
        truncated: false,
        error: null,
        ...overrides,
    };
}

function isTableDenseText(text) {
    const lines = String(text || '').split(/\r?\n/);
    let pipeRows = 0;
    let structuredLines = 0;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if ((trimmed.match(/\|/g) || []).length >= 2) pipeRows += 1;
        if (/\b\d{11}\b/.test(trimmed) || /\b\d{1,3}(?:\.\d{3})*,\d{2}\b/.test(trimmed)) {
            structuredLines += 1;
        }
    }
    return pipeRows >= 8 || structuredLines >= 8;
}

function countMultiColumnGeometryRows(items = []) {
    if (!Array.isArray(items) || items.length < 6) return 0;
    const rows = new Map();
    for (const item of items) {
        if (!item || typeof item.str !== 'string' || !item.str.trim()) continue;
        const transform = Array.isArray(item.transform) ? item.transform : null;
        if (!transform || transform.length < 6) continue;
        const x = Number(transform[4]);
        const y = Number(transform[5]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const rowBucket = Math.round(y / 4) * 4;
        if (!rows.has(rowBucket)) rows.set(rowBucket, []);
        rows.get(rowBucket).push(x);
    }
    let multiColumnRows = 0;
    for (const xs of rows.values()) {
        if (xs.length < 3) continue;
        const sorted = [...xs].sort((a, b) => a - b);
        let columns = 1;
        let prev = sorted[0];
        for (let i = 1; i < sorted.length; i += 1) {
            if (sorted[i] - prev >= 25) {
                columns += 1;
                prev = sorted[i];
            }
        }
        if (columns >= 3) multiColumnRows += 1;
    }
    return multiColumnRows;
}

function sniffFileMagic(buffer, filePath = '') {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    const ext = path.extname(String(filePath || '')).toLowerCase();
    if (bytes.length === 0) {
        return { kind: 'empty', valid: false, reasonCode: EXTRACTION_ERROR_CODES.EMPTY_DOCUMENT };
    }

    const headUtf8 = bytes.subarray(0, Math.min(bytes.length, 512)).toString('utf8').replace(/^\uFEFF/, '').trimStart();
    if (/^<(?:!doctype\s+html|html\b|head\b|body\b)/i.test(headUtf8)) {
        return { kind: 'html', valid: false, reasonCode: EXTRACTION_ERROR_CODES.HTML_AS_PDF };
    }

    const pdfMagicWindow = bytes.subarray(0, Math.min(bytes.length, 1024));
    if (pdfMagicWindow.includes('%PDF-')) {
        return { kind: 'pdf', valid: true, reasonCode: null };
    }

    if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
        if (ext === '.docx' || bytes.includes('word/')) {
            return { kind: 'docx', valid: true, reasonCode: null };
        }
        return { kind: 'zip', valid: true, reasonCode: null };
    }

    if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
        return { kind: 'doc', valid: true, reasonCode: null };
    }

    if (ext === '.pdf') {
        return { kind: 'corrupt-pdf', valid: false, reasonCode: EXTRACTION_ERROR_CODES.PDF_CORRUPT };
    }

    const hasNull = bytes.subarray(0, Math.min(bytes.length, 2048)).includes(0x00);
    if (!hasNull && (ext === '.txt' || ext === '.csv' || ext === '.md' || ext === '.json' || !ext)) {
        return { kind: 'txt', valid: true, reasonCode: null };
    }

    return { kind: 'unknown', valid: false, reasonCode: EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE };
}

function measurePageTextMetrics(pageText, numPages, imageOpsCount = 0) {
    const text = String(pageText || '').trim();
    const nonWsChars = text.replace(/\s+/g, '').length;
    const garbledCount = (text.match(/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F\uE000-\uF8FF]/g) || []).length;
    const garbledRatio = nonWsChars > 0 ? garbledCount / nonWsChars : 0;
    const blank = nonWsChars === 0 && imageOpsCount === 0;
    const meetsDensity = numPages <= 1
        ? nonWsChars >= 20
        : (nonWsChars >= 12 || (nonWsChars >= 6 && imageOpsCount === 0));
    const hasUsableText = !blank && garbledRatio < 0.20 && meetsDensity;
    return {
        text,
        nonWsChars,
        garbledCount,
        garbledRatio,
        imageOpsCount,
        blank,
        hasUsableText,
        needsOcr: !blank && !hasUsableText,
    };
}

function hasUsablePdfTextLayer(extraction) {
    if (!extraction) return false;
    if (extraction.method && extraction.method !== 'pdf-text') {
        return String(extraction.text || '').trim().length > 0;
    }
    const text = String(extraction.text || '');
    const nonWs = text.replace(/\s+/g, '');
    if (nonWs.length < 20) return false;
    const pages = Math.max(1, Number(extraction.pages) || 1);
    if (pages >= 2 && nonWs.length < pages * 12) return false;
    const garbled = (text.match(/[\uFFFD\uE000-\uF8FF]/g) || []).length;
    if ((garbled / nonWs.length) >= 0.20) return false;
    return true;
}

const IMAGE_OPS = new Set([
    pdfjsLib.OPS?.paintImageXObject,
    pdfjsLib.OPS?.paintInlineImageXObject,
    pdfjsLib.OPS?.paintImageMaskXObject,
    pdfjsLib.OPS?.paintImageXObjectRepeat,
].filter((op) => Number.isInteger(op)));

function toPureUint8Array(bytes) {
    if (bytes && bytes.constructor === Uint8Array) return bytes;
    if (ArrayBuffer.isView(bytes)) {
        return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    return new Uint8Array(bytes || 0);
}

async function inspectPdfBuffer(bytes) {
    const data = toPureUint8Array(bytes);
    let doc = null;
    try {
        doc = await pdfjsLib.getDocument({
            data,
            standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
        }).promise;

        const numPages = Number(doc.numPages) || 0;
        const pageAnalyses = [];
        const digitalPageTexts = [];
        const digitalPages = [];
        const ocrPages = [];
        const blankPages = [];
        let geometryTableRows = 0;

        for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
            const page = await doc.getPage(pageNumber);
            const content = await page.getTextContent();
            const items = Array.isArray(content?.items) ? content.items : [];
            const pageText = items
                .filter((item) => typeof item?.str === 'string')
                .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
                .join('')
                .trim();

            geometryTableRows += countMultiColumnGeometryRows(items);

            const preNonWs = pageText.replace(/\s+/g, '').length;
            let imageOpsCount = 0;
            if (preNonWs < 20) {
                if (typeof page.getOperatorList === 'function') {
                    try {
                        const opList = await page.getOperatorList();
                        const fnArray = Array.isArray(opList?.fnArray) ? opList.fnArray : [];
                        for (const fn of fnArray) {
                            if (IMAGE_OPS.has(fn)) imageOpsCount += 1;
                        }
                    } catch {
                        imageOpsCount = 1;
                    }
                } else {
                    imageOpsCount = 1;
                }
            }

            const metrics = measurePageTextMetrics(pageText, numPages, imageOpsCount);
            pageAnalyses.push({ pageNumber, ...metrics });
            if (metrics.blank) {
                blankPages.push(pageNumber);
            } else if (metrics.hasUsableText) {
                digitalPages.push(pageNumber);
                digitalPageTexts.push(metrics.text);
            } else {
                ocrPages.push(pageNumber);
            }
        }

        let docClass = 'empty_or_corrupt';
        if (numPages > 0) {
            if (digitalPages.length > 0 && ocrPages.length === 0) docClass = 'digital_text';
            else if (digitalPages.length === 0 && ocrPages.length > 0) docClass = 'scanned_full';
            else if (digitalPages.length > 0 && ocrPages.length > 0) docClass = 'hybrid_mixed';
            else docClass = 'empty_or_corrupt';
        }

        const digitalText = digitalPageTexts.join('\n\n');
        const tableDense = geometryTableRows >= 8 || isTableDenseText(digitalText);
        const pageRanges = buildPageRanges(digitalPageTexts, digitalPages);

        return {
            ok: docClass !== 'empty_or_corrupt',
            docClass,
            pageCount: numPages,
            pages: numPages,
            digitalPages,
            ocrPages,
            blankPages,
            pageAnalyses,
            text: digitalText,
            digitalText,
            pageRanges,
            tableDense,
            reasonCode: docClass === 'empty_or_corrupt' ? EXTRACTION_ERROR_CODES.EMPTY_DOCUMENT : null,
            error: docClass === 'empty_or_corrupt' ? EXTRACTION_ERROR_CODES.EMPTY_DOCUMENT : null,
        };
    } catch (error) {
        const isEncrypted = error?.name === 'PasswordException' || /password|encrypted/i.test(String(error?.message || ''));
        return {
            ok: false,
            docClass: 'empty_or_corrupt',
            pageCount: 0,
            pages: 0,
            digitalPages: [],
            ocrPages: [],
            blankPages: [],
            pageAnalyses: [],
            text: '',
            digitalText: '',
            pageRanges: [],
            tableDense: false,
            reasonCode: isEncrypted ? EXTRACTION_ERROR_CODES.PDF_ENCRYPTED : EXTRACTION_ERROR_CODES.PDF_CORRUPT,
            error: EXTRACTION_ERROR_CODES.PDF_PARSE_FAILED,
            errorDetail: error?.message || String(error),
        };
    } finally {
        if (doc && typeof doc.destroy === 'function') {
            try {
                await doc.destroy();
            } catch {
                // Ignore pdf.js teardown noise.
            }
        }
    }
}

async function renderPageToJpeg(page) {
    const baseViewport = page.getViewport({ scale: 1 });
    const longestEdge = Math.max(baseViewport.width, baseViewport.height);
    const requestedScale = resolveOcrRenderScale();
    const capScale = resolveOcrImageLongEdge() / Math.max(1, longestEdge);
    const scale = Math.min(requestedScale, capScale);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toBuffer('image/jpeg', { quality: 0.9 });
}

async function renderPdfPagesToJpegBuffers(bytes, pageNumbers) {
    const data = toPureUint8Array(bytes);
    let doc = null;
    try {
        doc = await pdfjsLib.getDocument({
            data,
            standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
        }).promise;
        const rendered = [];
        for (const pageNumber of pageNumbers || []) {
            if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.numPages) {
                throw new Error(`Page ${pageNumber} is outside 1–${doc.numPages}`);
            }
            const page = await doc.getPage(pageNumber);
            const jpegBuffer = await renderPageToJpeg(page);
            rendered.push({ pageNumber, buffer: jpegBuffer });
        }
        return rendered;
    } finally {
        if (doc && typeof doc.destroy === 'function') {
            try {
                await doc.destroy();
            } catch {
                // Ignore pdf.js teardown noise.
            }
        }
    }
}

async function extractTextFromFile(filePath) {
    const lowerPath = String(filePath || '').toLowerCase();
    if (!filePath || !fs.existsSync(filePath)) {
        return buildExtractionResult({ error: EXTRACTION_ERROR_CODES.FILE_NOT_FOUND });
    }

    try {
        if (lowerPath.endsWith('.pdf')) {
            const data = new Uint8Array(fs.readFileSync(filePath));
            let doc = null;
            try {
                doc = await pdfjsLib.getDocument({
                    data,
                    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
                }).promise;
                const pageTexts = [];
                for (let i = 1; i <= doc.numPages; i += 1) {
                    const page = await doc.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = (content.items || [])
                        .filter((item) => typeof item.str === 'string')
                        .map((item) => `${item.str}${item.hasEOL ? '\n' : ' '}`)
                        .join('')
                        .trim();
                    pageTexts.push(pageText);
                }
                return buildExtractionResult({
                    text: pageTexts.join('\n\n'),
                    method: 'pdf-text',
                    pages: pageTexts.length,
                    pageRanges: buildPageRanges(pageTexts),
                });
            } finally {
                if (doc && typeof doc.destroy === 'function') {
                    try {
                        await doc.destroy();
                    } catch {
                        // Ignore pdf.js teardown noise.
                    }
                }
            }
        }
        if (lowerPath.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ path: filePath });
            return buildExtractionResult({
                text: result.value,
                method: 'docx',
                pages: 1,
            });
        }
        if (lowerPath.endsWith('.doc')) {
            const extractor = new WordExtractor();
            const doc = await extractor.extract(filePath);
            return buildExtractionResult({
                text: doc.getBody(),
                method: 'doc',
                pages: 1,
            });
        }
        if (lowerPath.endsWith('.txt')) {
            return buildExtractionResult({
                text: fs.readFileSync(filePath, 'utf8'),
                method: 'txt',
                pages: 1,
            });
        }
    } catch {
        let errorCode = EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE;
        if (lowerPath.endsWith('.pdf')) errorCode = EXTRACTION_ERROR_CODES.PDF_PARSE_FAILED;
        else if (lowerPath.endsWith('.docx')) errorCode = EXTRACTION_ERROR_CODES.DOCX_PARSE_FAILED;
        else if (lowerPath.endsWith('.doc')) errorCode = EXTRACTION_ERROR_CODES.DOC_PARSE_FAILED;
        else if (lowerPath.endsWith('.txt')) errorCode = EXTRACTION_ERROR_CODES.TXT_READ_FAILED;
        return buildExtractionResult({ error: errorCode });
    }
    return buildExtractionResult({ error: EXTRACTION_ERROR_CODES.UNSUPPORTED_TYPE });
}

module.exports = {
    EXTRACTION_ERROR_CODES,
    PDFJS_STANDARD_FONT_DATA_URL,
    buildExtractionResult,
    buildPageRanges,
    pageRangesFromMarkedText,
    pageNumbersForRange,
    isTableDenseText,
    sniffFileMagic,
    measurePageTextMetrics,
    hasUsablePdfTextLayer,
    inspectPdfBuffer,
    renderPageToJpeg,
    renderPdfPagesToJpegBuffers,
    extractTextFromFile,
    isPdfJsMocked,
    isCanvasMocked,
    resolveOcrRenderScale,
    resolveOcrImageLongEdge,
};
