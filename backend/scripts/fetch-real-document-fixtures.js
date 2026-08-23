#!/usr/bin/env node
/**
 * Fetch real e-Oglasna document fixtures for local verification and tests.
 *
 * Searches e-Oglasna for an OIB (default: 66124057408 — the same OIB used by
 * the other live lanes), downloads the document archives (ZIP) of the first
 * search-page entries that carry a download link, unzips them, runs the REAL
 * production extraction path over every extracted file, probes the OCR render
 * path once, and writes a manifest.json describing everything it observed.
 *
 * Everything under the fixture directory — binaries AND manifest.json — is
 * gitignored on purpose: CI self-skips the matching real-fixture test lane
 * when the files are absent, and local runs regenerate them from live data.
 *
 * Usage:
 *   node scripts/fetch-real-document-fixtures.js [--oib=...] [--limit=10]
 *   node scripts/fetch-real-document-fixtures.js --verify-only   # re-run
 *                                                                # extraction
 *                                                                # over an
 *                                                                # existing
 *                                                                # manifest
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const AdmZip = require('adm-zip');
const agentLog = require('../helpers/agentLog');

// The scraper launches headful in local dev; scripts/CI hosts have no display.
process.env.PUPPETEER_HEADLESS = process.env.PUPPETEER_HEADLESS || '1';

const DEFAULT_OIB = '66124057408';
const DEFAULT_LIMIT = 10;

function parseArgs(argv) {
    const args = { oib: DEFAULT_OIB, limit: DEFAULT_LIMIT, verifyOnly: false, reportOut: null };
    for (const raw of argv) {
        if (raw.startsWith('--oib=')) args.oib = raw.slice('--oib='.length).trim();
        else if (raw.startsWith('--limit=')) args.limit = Number.parseInt(raw.slice('--limit='.length), 10) || DEFAULT_LIMIT;
        else if (raw === '--verify-only') args.verifyOnly = true;
        else if (raw.startsWith('--report-out=')) args.reportOut = raw.slice('--report-out='.length).trim();
    }
    return args;
}

function fixturesDirFor(oib) {
    return path.resolve(__dirname, '../tests/fixtures/real-documents', oib);
}

function slugify(text, fallback = 'entry') {
    const slug = String(text || '')
        .normalize('NFKD')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .slice(0, 48);
    return slug || fallback;
}

function sha256File(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Safe zip extraction: entries are flattened under destinationDir using their
 * basename only. Zip-slip paths and directory entries are skipped. Returns
 * [{ entryName, filePath }] with original archive names preserved in
 * entryName (matching ExtractArchiveTool's shape).
 */
function extractZipSafely(zipPath, destinationDir) {
    const zip = new AdmZip(zipPath);
    const extracted = [];
    for (const entry of zip.getEntries()) {
        if (entry.isDirectory) continue;
        const base = path.basename(entry.entryName);
        if (!base || base.startsWith('__MACOSX')) continue;
        const targetPath = path.join(destinationDir, base);
        fs.writeFileSync(targetPath, entry.getData());
        extracted.push({ entryName: entry.entryName, filePath: targetPath });
    }
    return extracted;
}

async function extractAndProbe(manifest) {
    // Real production extraction path — no mocks. Imported lazily so
    // --verify-only does not pay module init twice.
    const { extractTextFromFile } = require('../court-analysis/agents/analysis-agent');

    let firstEmbeddedPdfEntry = null;
    for (const entry of manifest.entries) {
        for (const file of entry.files) {
            const startedAt = Date.now();
            const result = await extractTextFromFile(file.filePath);
            file.extraction = {
                method: result.method,
                pages: result.pages,
                chars: (result.text || '').length,
                truncated: result.truncated,
                error: result.error,
                ms: Date.now() - startedAt,
                textLayer:
                    result.method === 'pdf-text' && (result.text || '').trim().length > 0 ? 'embedded'
                        : result.method === 'pdf-text' ? 'empty'
                            : result.error ? 'error'
                                : 'none',
            };
            agentLog.log(
                `[Fixtures] ${entry.index}/${manifest.entries.length} ${file.entryName} -> ` +
                `method=${file.extraction.method} pages=${file.extraction.pages} ` +
                `chars=${file.extraction.chars} textLayer=${file.extraction.textLayer}` +
                `${file.extraction.error ? ` error=${file.extraction.error}` : ''}`,
            );
            if (
                !firstEmbeddedPdfEntry &&
                file.extraction.textLayer === 'embedded' &&
                file.filePath.toLowerCase().endsWith('.pdf')
            ) {
                firstEmbeddedPdfEntry = { entry, file };
            }
        }
    }

    if (firstEmbeddedPdfEntry) {
        manifest.renderProbe = await probeRenderPath(firstEmbeddedPdfEntry.file.filePath);
    } else {
        manifest.renderProbe = { probed: false, reason: 'no embedded-text PDF found to probe' };
    }
}

/**
 * Proves the local OCR *preprocessing* works without any Gemini call: pdf.js
 * rasterizes page 1 into a node-canvas buffer and the pixels are not blank.
 */
async function probeRenderPath(pdfPath) {
    try {
        const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');
        const { createCanvas } = require('canvas');

        const data = new Uint8Array(fs.readFileSync(pdfPath));
        const doc = await pdfjsLib.getDocument({ data }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');
        await page.render({ canvasContext: context, viewport }).promise;
        const pngBuffer = canvas.toBuffer('image/png');

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        let nonBlank = 0;
        let sampled = 0;
        for (let i = 0; i < imageData.data.length; i += 4 * 97) {
            sampled += 1;
            const [r, g, b] = [imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]];
            if (!(r > 245 && g > 245 && b > 245)) nonBlank += 1;
        }
        await doc.destroy();

        const ratio = sampled > 0 ? Number((nonBlank / sampled).toFixed(4)) : 0;
        agentLog.log(
            `[Fixtures] Render probe on ${path.basename(pdfPath)}: ` +
            `pngBytes=${pngBuffer.length} nonBlankRatio=${ratio}`,
        );
        return {
            probed: true,
            ok: pngBuffer.length > 1024 && ratio > 0.001,
            pngBytes: pngBuffer.length,
            nonBlankRatio: ratio,
        };
    } catch (err) {
        agentLog.error(`[Fixtures] Render probe failed for ${pdfPath}:`, err.message);
        return { probed: true, ok: false, error: err.message };
    }
}

async function fetchFixtures({ oib, limit }) {
    const CourtSearchPuppeteer = require('../scraper/courtSearchPuppeteer');
    const searcher = new CourtSearchPuppeteer();
    await searcher.init();
    let results;
    try {
        await searcher.performSearch(oib);
        ({ results } = await searcher.parseSearchResultsPage());
    } finally {
        await searcher.close();
    }

    const selected = (results || [])
        .filter((r) => r.documentDownloadLink)
        .slice(0, limit);
    if (selected.length === 0) {
        throw new Error(`No entries with documentDownloadLink found on the first page for ${oib}.`);
    }
    agentLog.log(`[Fixtures] Selected ${selected.length} entr(y/ies) with document archives.`);

    const outDir = fixturesDirFor(oib);
    const zipsDir = path.join(outDir, 'zips');
    const entriesDir = path.join(outDir, 'entries');
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(zipsDir, { recursive: true });
    fs.mkdirSync(entriesDir, { recursive: true });

    const manifest = {
        query: { type: 'text', value: oib },
        source: 'https://e-oglasna.pravosudje.hr',
        fetchedAt: new Date().toISOString(),
        generator: 'backend/scripts/fetch-real-document-fixtures.js',
        selection: `first ${limit} search-page entries carrying documentDownloadLink`,
        entries: [],
    };

    for (let i = 0; i < selected.length; i++) {
        const result = selected[i];
        const index = i + 1;
        const slug = `${index}-${slugify(result.caseNumber || result.title)}`;

        agentLog.log(`[Fixtures] Downloading ${index}/${selected.length}: ${result.documentDownloadLink}`);
        // Same extension-resolution order as DownloadDocumentsTool:
        // Content-Disposition filename -> Content-Type -> '.bin'.
        const response = await axios({
            url: result.documentDownloadLink,
            method: 'GET',
            responseType: 'stream',
            timeout: 120000,
        });
        const disposition = response.headers['content-disposition'] || '';
        const dispositionMatch = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/);
        const serverName = dispositionMatch ? decodeURIComponent(dispositionMatch[1]) : null;
        const mimeExt = require('mime-types').extension(response.headers['content-type']);
        const ext = path.extname(serverName || '') ||
            (mimeExt && mimeExt !== 'bin' ? `.${mimeExt}` : '.bin');
        const downloadPath = path.join(zipsDir, `${slug}${ext}`);
        await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(downloadPath);
            response.data.pipe(writer);
            writer.on('finish', resolve);
            writer.on('error', reject);
            response.data.on('error', reject);
        });

        let extractedFiles;
        if (ext.toLowerCase() === '.zip') {
            const entryDir = path.join(entriesDir, slug);
            fs.mkdirSync(entryDir, { recursive: true });
            extractedFiles = extractZipSafely(downloadPath, entryDir);
        } else {
            // Row-level /preuzimanje links often serve the document itself.
            extractedFiles = [{
                entryName: serverName || path.basename(downloadPath),
                filePath: downloadPath,
            }];
        }

        const files = [];
        for (const extracted of extractedFiles) {
            files.push({
                entryName: extracted.entryName,
                filePath: extracted.filePath,
                bytes: fs.statSync(extracted.filePath).size,
                sha256: await sha256File(extracted.filePath),
            });
        }

        manifest.entries.push({
            index,
            title: result.title,
            caseNumber: result.caseNumber,
            court: result.court,
            date: result.date,
            detailLink: result.detailLink,
            documentDownloadLink: result.documentDownloadLink,
            archivePath: downloadPath,
            archiveType: ext.toLowerCase() === '.zip' ? 'zip' : 'single-file',
            archiveSha256: await sha256File(downloadPath),
            files,
        });
        agentLog.log(
            `[Fixtures] Entry ${index}: "${result.title}" (${ext}) -> ${files.length} file(s).`,
        );
    }

    return manifest;
}

async function verifyOnly(oib) {
    const outDir = fixturesDirFor(oib);
    const manifestPath = path.join(outDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`No manifest at ${manifestPath}. Run without --verify-only first.`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    await extractAndProbe(manifest);
    return manifest;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    let manifest;
    if (args.verifyOnly) {
        manifest = await verifyOnly(args.oib);
    } else {
        manifest = await fetchFixtures(args);
        await extractAndProbe(manifest);
    }

    const allFiles = manifest.entries.flatMap((entry) => entry.files);
    const summary = allFiles.reduce((counts, file) => {
        const key = `${(file.filePath.toLowerCase().split('.').pop() || '?')}|${file.extraction?.textLayer || 'missing'}`;
        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});

    manifest.summary = {
        totalFiles: allFiles.length,
        byExtensionAndTextLayer: summary,
        renderProbe: manifest.renderProbe || null,
    };

    const outDir = fixturesDirFor(args.oib);
    const manifestPath = path.join(outDir, 'manifest.json');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    agentLog.log('[Fixtures] Summary:', JSON.stringify(summary));
    agentLog.log(`[Fixtures] Manifest written: ${manifestPath}`);

    const report = {
        manifestPath,
        summary: manifest.summary,
        renderProbe: manifest.renderProbe,
        entries: manifest.entries.map((entry) => ({
            title: entry.title,
            caseNumber: entry.caseNumber,
            files: entry.files.map((file) => ({
                entryName: file.entryName,
                bytes: file.bytes,
                extraction: file.extraction,
            })),
        })),
    };

    if (args.reportOut) {
        fs.writeFileSync(args.reportOut, `${JSON.stringify(report, null, 2)}\n`);
        agentLog.log(`[Fixtures] Report written: ${args.reportOut}`);
    } else {
        console.log('\n=== FIXTURE REPORT (JSON) ===');
        console.log(JSON.stringify(report, null, 2));
    }

    process.exit(allFiles.length > 0 && (!manifest.renderProbe || manifest.renderProbe.ok !== false) ? 0 : 1);
}

main().catch((err) => {
    agentLog.error('[Fixtures] Failed:', err.message);
    process.exit(1);
});
