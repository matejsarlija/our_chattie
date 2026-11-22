'use strict';

const fs = require('fs');
const path = require('path');
// This process only imports the benchmark's local persistence helper; no model
// calls are made. The constructor requires a key during module initialization.
if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
    process.env.GOOGLE_API_KEY = 'offline-transcript-validation';
}
const bench = require('../backend/scripts/benchmark-pdf-engines');

const docs = [
    '26:Prilog St-2_2013-1159-2 - Prilog 2. - Specifikacija djelomičnog namirenja tražbine B2 KAPITAL d.o.o..pdf',
    '6:Prilog St-2_2013-1208-1 - Račun Adria Rijeka 2-2025 (1).pdf',
];
const transcriptDir = path.resolve(__dirname, '../backend/data/pdf-engine-bench/fixtures/transcripts');

for (const docId of docs) {
    const filePath = path.join(transcriptDir, `${docId}.json`);
    const fixture = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const parserRun = fixture.parserRuns?.['or-mistral-ocr'];
    if (parserRun?.status !== 'completed' || typeof parserRun.text !== 'string') {
        throw new Error(`Missing completed Mistral OCR transcript for ${docId}`);
    }
    const body = parserRun.text
        .replace(/^<file\b[^>]*>\s*/u, '')
        .replace(/\s*<\/file>\s*$/u, '')
        .trim();
    const marker = '=== STRANICA 1 ===\n';
    const text = body.startsWith(marker) ? body : `${marker}${body}`;
    const startIndex = marker.length;
    fixture.canonicalTranscript = {
        sourceArm: 'or-mistral-ocr',
        text,
        charCount: text.length,
        pageMap: [{ pageNumber: 1, startIndex, endIndex: text.length }],
        verified: true,
    };
    fixture.stageA = { status: 'ready', reason: null };
    if (/<\/?file\b/iu.test(text)) throw new Error(`Parser wrapper remained in ${docId}`);
    if (!bench.persistVerifiedTranscript(filePath, fixture)) throw new Error(`Transcript validation failed for ${docId}`);
    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (persisted.canonicalTranscript.charCount !== persisted.canonicalTranscript.text.length
        || persisted.canonicalTranscript.pageMap[0].startIndex !== startIndex
        || persisted.canonicalTranscript.pageMap[0].endIndex !== text.length
        || persisted.canonicalTranscript.sourceArm !== 'or-mistral-ocr'
        || persisted.stageA.status !== 'ready') {
        throw new Error(`Persisted transcript verification failed for ${docId}`);
    }
    console.log(`${docId}: chars=${text.length}; source=or-mistral-ocr; wrappers=0`);
}
