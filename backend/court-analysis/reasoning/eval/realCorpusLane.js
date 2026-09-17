// backend/court-analysis/reasoning/eval/realCorpusLane.js
//
// Purpose: Real-corpus retrieval probe for the eval harness. Builds an
//          in-memory evidence package from the REAL e-Oglasna documents
//          downloaded by `npm run fixtures:fetch` (gitignored, local-only),
//          indexes their full extracted text through the production chunker,
//          and scores retrieval recall against weak-gold spans sampled
//          deterministically from the real document text.
//
// What this measures (and what it does NOT): this is a COVERAGE probe on real
// Croatian legal prose — can the lexical index surface known-real passages?
// It is not relevance gold; hand-labeled relevance still lives only in the
// committed fixture files. Runs entirely offline through pdfjs embedded text
// layers — zero Gemini calls.
//
// Self-skip contract: when the manifest or any PDF is missing, callers skip
// the lane (mirrors document-extraction.real.test.js behavior).

const fs = require('fs');
const path = require('path');

const REAL_FIXTURES_DIR = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'real-documents');
const FIXTURE_OIB = '66124057408';

function manifestPath() {
    return path.join(REAL_FIXTURES_DIR, FIXTURE_OIB, 'manifest.json');
}

function isAvailable() {
    return fs.existsSync(manifestPath());
}

// --- PDF text extraction (outside-Jest constraint: real pdfjs keeps worker
// handles open under Jest; this module runs only from the eval CLI). ----------
let pdfjsLibCache = null;

function getPdfjs() {
    if (!pdfjsLibCache) {
        // eslint-disable-next-line global-require
        const lib = require('pdfjs-dist/legacy/build/pdf.js');
        lib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
        pdfjsLibCache = lib;
    }
    return pdfjsLibCache;
}

async function extractPdfTextLayer(filePath) {
    const pdfjs = getPdfjs();
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    try {
        const pageTexts = [];
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const content = await page.getTextContent();
            pageTexts.push(content.items.map((item) => item.str).join(' ').trim());
        }
        return pageTexts.filter(Boolean).join('\n\n').trim();
    } finally {
        await doc.destroy();
    }
}

// --- Corpus assembly ---------------------------------------------------------

/**
 * Builds a retrieval-probe package from the real manifest.
 * @returns {Promise<{pkg: object, gold: object, docCount: number}|null>} null when unavailable.
 */
async function buildRealCorpusFixture() {
    if (!isAvailable()) return null;
    const manifest = JSON.parse(fs.readFileSync(manifestPath(), 'utf-8'));

    const chunks = [];
    let docCount = 0;
    for (const entry of manifest.entries || []) {
        for (const file of entry.files || []) {
            if (file.extraction?.textLayer !== 'embedded' || !fs.existsSync(file.filePath)) continue;
            let text;
            try {
                text = await extractPdfTextLayer(file.filePath);
            } catch (err) {
                continue; // single unreadable file never fails the lane
            }
            if (!text || text.length < 200) continue;
            docCount += 1;
            const docId = `${entry.caseNumber}::${file.entryName}`;
            // Lazy require keeps Jest suites free of the pdfjs dependency chain.
            const { buildRetrievalChunks } = require('../chunker');
            for (const chunk of buildRetrievalChunks(text, { docId })) {
                chunks.push({
                    id: chunk.id,
                    text: chunk.text,
                    metadata: {
                        fileName: file.entryName,
                        caseNumber: entry.caseNumber,
                        startIndex: chunk.metadata?.startIndex ?? null,
                        endIndex: chunk.metadata?.endIndex ?? null
                    }
                });
            }
        }
    }
    if (chunks.length === 0) return null;

    const pkg = {
        clusterId: `REAL-${FIXTURE_OIB}`,
        primaryCaseNumber: (manifest.entries || [])[0]?.caseNumber || null,
        query: { type: 'text', value: FIXTURE_OIB },
        identity: { participantNames: [], participantOibs: [] },
        entries: [],
        documentLinks: [],
        analyses: [],
        chunks
    };

    // Weak gold: first sentence ≥140 chars from every 7th chunk. Verbatim
    // substrings of indexed text → reachable iff ranking surfaces their chunk.
    const goldSpans = [];
    for (let i = 0; i < chunks.length; i += 7) {
        const chunk = chunks[i];
        const sentences = chunk.text.split(/(?<=[.!?])\s+/).filter((s) => s.length >= 140);
        const spanSource = sentences[0] || chunk.text.slice(0, 180);
        if (spanSource.trim().length < 80) continue;
        goldSpans.push({ textIncludes: spanSource.slice(0, 160) });
    }

    return {
        pkg,
        gold: { schemaVersion: 1, clusterId: pkg.clusterId, citationSpans: goldSpans },
        docCount
    };
}

module.exports = { isAvailable, buildRealCorpusFixture };
