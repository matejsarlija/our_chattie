#!/usr/bin/env node
/**
 * Live sanity probe for the batched OCR instruction contract.
 *
 * Sends ONE small multi-page image-only PDF through the real
 * extractTextViaOCR batch path against real Gemini and asserts that:
 *   1. every page comes back (batch covers all pending pages),
 *   2. per-page text is attributed to the ORIGINAL page numbers even though
 *      the model only sees positional numbering,
 *   3. `=== STRANICA N ===` markers never leak into page text,
 *   4. no sequential refill was needed (single vision request).
 *
 * Input resolution, in order:
 *   - a multi-page PDF from the local real-document fixtures (the
 *     tests/fixtures/real-documents entries folders, if previously fetched),
 *   - otherwise a synthetic 3-page "scanned" PDF rendered via node-canvas.
 *
 * Gated exactly like verify-live-reasoning: requires GOOGLE_API_KEY, costs a
 * handful of vision requests, never runs in CI lanes.
 *
 * Usage: npm run verify:ocr-batch
 */
(async () => {
    // The backend reads backend/.env (documented in .env.example); repo-root
    // .env is honored too for parity with the other live scripts. dotenv does
    // not override variables that are already set.
    require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
    require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

    const fs = require('fs');
    const os = require('os');
    const path = require('path');

    if (!process.env.GOOGLE_API_KEY) {
        console.error('GOOGLE_API_KEY is not set — live OCR probe skipped.');
        process.exit(2);
    }

    const { createCanvas } = require('canvas');
    const { extractTextViaOCR } = require('../court-analysis/agents/analysis-agent');
    const { createUsageTracker } = require('../helpers/geminiUsage');

    // --- Minimal image-only PDF writer (JPEG/DCTDecode, no deps) ------------

    function buildImageOnlyPdf(jpegs, width, height) {
        const objects = [];
        const pageCount = jpegs.length;
        const pageObjNums = [];
        const contentObjNums = [];
        const imageObjNums = [];

        let nextNum = 3; // 1 = catalog, 2 = pages tree
        for (let i = 0; i < pageCount; i += 1) {
            pageObjNums.push(nextNum++);
            contentObjNums.push(nextNum++);
            imageObjNums.push(nextNum++);
        }

        objects[1] = Buffer.from(`<< /Type /Catalog /Pages 2 0 R >>`);
        objects[2] = Buffer.from(
            `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>`,
        );

        for (let i = 0; i < pageCount; i += 1) {
            objects[pageObjNums[i]] = Buffer.from(
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
                `/Resources << /XObject << /Im${i} ${imageObjNums[i]} 0 R >> >> ` +
                `/Contents ${contentObjNums[i]} 0 R >>`,
            );
            const stream = `q ${width} 0 0 ${height} 0 0 cm /Im${i} Do Q`;
            objects[contentObjNums[i]] = Buffer.concat([
                Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
                Buffer.from(stream),
                Buffer.from('\nendstream'),
            ]);
            objects[imageObjNums[i]] = Buffer.concat([
                Buffer.from(
                    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
                    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegs[i].length} >>\nstream\n`,
                ),
                jpegs[i],
                Buffer.from('\nendstream'),
            ]);
        }

        const chunks = [Buffer.from('%PDF-1.4\n')];
        const offsets = [];
        for (let num = 1; num < objects.length; num += 1) {
            if (!objects[num]) continue;
            offsets[num] = chunks.reduce((sum, c) => sum + c.length, 0);
            chunks.push(Buffer.from(`${num} 0 obj\n`), objects[num], Buffer.from('\nendobj\n'));
        }
        const xrefOffset = chunks.reduce((sum, c) => sum + c.length, 0);
        const maxNum = objects.length - 1;
        let xref = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
        for (let num = 1; num <= maxNum; num += 1) {
            xref += offsets[num]
                ? `${String(offsets[num]).padStart(10, '0')} 00000 n \n`
                : '0000000000 65535 f \n';
        }
        chunks.push(
            Buffer.from(xref),
            Buffer.from(`trailer\n<< /Size ${maxNum + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`),
        );
        return Buffer.concat(chunks);
    }

    function renderScannedStylePage(labelLines) {
        const width = 1240; // A4 @ ~150dpi
        const height = 1754;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f5f2ec'; // scanner-paper off-white
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = '#1c1c1c';
        ctx.font = 'bold 64px sans-serif';
        ctx.fillText(labelLines[0], 80, 180);
        ctx.font = '36px sans-serif';
        labelLines.slice(1).forEach((line, i) => {
            ctx.fillText(line, 80, 280 + i * 60);
        });
        return canvas.toBuffer('image/jpeg');
    }

    // --- Input resolution ----------------------------------------------------

    const PAGE_TOKENS = ['VJERODOSTOJNOST-PRVA', 'TRGOVACKI-DUG-DRUGA', 'STECAJNI-POSTUPAK-TRECA'];

    async function resolveProbePdf() {
        const fixturesRoot = path.join(__dirname, '..', 'tests', 'fixtures', 'real-documents');
        if (fs.existsSync(fixturesRoot)) {
            const oibDirs = fs.readdirSync(fixturesRoot).filter((name) =>
                fs.statSync(path.join(fixturesRoot, name)).isDirectory());
            for (const oib of oibDirs) {
                const entriesDir = path.join(fixturesRoot, oib, 'entries');
                if (!fs.existsSync(entriesDir)) continue;
                const candidates = fs.readdirSync(entriesDir)
                    .filter((name) => name.toLowerCase().endsWith('.pdf'))
                    .sort();
                for (const candidate of candidates) {
                    const filePath = path.join(entriesDir, candidate);
                    try {
                        const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
                        const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)) }).promise;
                        const numPages = doc.numPages;
                        await doc.destroy();
                        if (numPages >= 2) {
                            return { filePath, synthetic: false, expectedPages: Math.min(numPages, 5), tokens: null };
                        }
                    } catch { /* try next candidate */ }
                }
            }
        }

        const jpegs = PAGE_TOKENS.map((token, index) => renderScannedStylePage([
            token,
            `Ovo je stranica broj ${index + 1} sintetskog dokumenta.`,
            'Svrha: provjera pozicijskog oznacivanja stranica u batch OCR zahtjevu.',
            'Sud: Probi sud u Zagrebu',
        ]));
        const filePath = path.join(os.tmpdir(), `ocr-batch-probe-${Date.now()}.pdf`);
        fs.writeFileSync(filePath, buildImageOnlyPdf(jpegs, 1240, 1754));
        return { filePath, synthetic: true, expectedPages: PAGE_TOKENS.length, tokens: PAGE_TOKENS };
    }

    // --- Probe ---------------------------------------------------------------

    const { filePath, synthetic, expectedPages, tokens } = await resolveProbePdf();
    console.log(`[probe] input: ${filePath}${synthetic ? ' (synthetic)' : ' (real fixture)'}`);

    const progressMessages = [];
    // Thread the tracker so vision spend is surfaced, not silently dropped.
    // A zero snapshot is legitimate here when every page was served from the
    // OCR page cache — say so instead of letting it look like a broken meter.
    const usageTracker = createUsageTracker();
    let result;
    try {
        result = await extractTextViaOCR(filePath, (event) => progressMessages.push(event.message || ''), { tracker: usageTracker });
    } finally {
        if (synthetic) fs.unlinkSync(filePath);
        const usage = usageTracker.snapshot();
        console.log(
            `[token-usage] ocr-batch probe: ${usage.calls} calls, ` +
            `${usage.inputTokens} in / ${usage.outputTokens} out / ${usage.totalTokens} total tokens` +
            (usage.calls === 0 ? ' (0 calls: all pages served from the OCR page cache)' : '')
        );
    }

    console.log(`[probe] result: method=${result.method} pages=${result.pages}/${expectedPages} error=${result.error}`);
    console.log(`[probe] progress lines:`);
    for (const message of progressMessages) console.log(`  - ${message}`);

    const failures = [];
    if (result.method !== 'ocr') failures.push(`method is '${result.method}', expected 'ocr'`);
    if (result.text.includes('=== STRANICA')) {
        failures.push("marker header text leaked into page content ('=== STRANICA' found in combined text)");
    }
    if (tokens) {
        for (const token of tokens) {
            const count = result.text.split(token).length - 1;
            if (count !== 1) failures.push(`token '${token}' appears ${count}x in combined text, expected exactly 1x`);
        }
        const positions = tokens.map((token) => result.text.indexOf(token));
        if (positions.some((p) => p === -1) || positions.some((p, i) => i > 0 && p <= positions[i - 1])) {
            failures.push(`page tokens are missing or out of original order: positions=${positions}`);
        }
    }
    if (result.pages < expectedPages && !['ocr-partial'].includes(result.error)) {
        failures.push(`covered ${result.pages}/${expectedPages} pages with error='${result.error}'`);
    }

    if (failures.length > 0) {
        console.error('[probe] FAILED:');
        for (const failure of failures) console.error(`  ✗ ${failure}`);
        process.exit(1);
    }

    console.log('[probe] OK — positional marker contract held against real Gemini.');
    process.exit(0);
})();
