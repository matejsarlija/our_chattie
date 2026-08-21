#!/usr/bin/env node
/**
 * Standalone verification: pdfjs-dist v3.11.174 legacy build can parse
 * real PDFs via getTextContent(). Run outside Jest to avoid UMD issues.
 *
 * Usage: node scripts/verify-pdf-extraction.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.js');

// Node's StandardFontDataFactory reads fonts from disk; without this every
// non-embedded standard font logs a fetch warning during getTextContent().
const PDFJS_STANDARD_FONT_DATA_URL = (() => {
    const fontsDir = path.join(
        path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.js')),
        '..',
        '..',
        'standard_fonts',
    );
    return fs.existsSync(fontsDir) ? fontsDir + path.sep : null;
})();

const PDFDocument = require('pdfkit');

const testText = 'Verifikacija: 66124057408 — OIB za testni slučaj.\nIznos: 1500 EUR.\nDatum: 2025-01-15.';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-verify-'));
const pdfPath = path.join(tmpDir, 'verification.pdf');

async function main() {
    // Generate a real PDF. An embedded Unicode TTF (DejaVu) is used instead of
    // pdfkit's built-in Helvetica because WinAnsi encoding cannot represent
    // Croatian diacritics — the mojibake would be a fixture artifact, not an
    // extraction defect. Real court PDFs embed their fonts the same way.
    const croatianCapableFont = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const fontOptions = fs.existsSync(croatianCapableFont)
        ? { font: croatianCapableFont }
        : {};
    if (!fs.existsSync(croatianCapableFont)) {
        console.warn('DejaVuSans.ttf not found; falling back to WinAnsi default font (diacritics may degrade).');
    }
    await new Promise((resolve, reject) => {
        const doc = new PDFDocument(fontOptions);
        const stream = fs.createWriteStream(pdfPath);
        doc.pipe(stream);
        doc.text(testText);
        doc.end();
        stream.on('finish', resolve);
        stream.on('error', reject);
    });

    // Extract text using pdfjs-dist (the same path as analysis-agent.js)
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const doc = await pdfjsLib.getDocument({
        data,
        standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL,
    }).promise;
    const numPages = doc.numPages;
    const pageTexts = [];
    for (let i = 1; i <= numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items
            .filter((item) => typeof item.str === 'string')
            .map((item) => item.str)
            .join(' ');
        pageTexts.push(pageText);
    }
    await doc.destroy();
    const extracted = pageTexts.join('\n\n').trim();

    // Validate
    const hasOIB = extracted.includes('66124057408');
    const hasAmount = extracted.includes('1500') || extracted.includes('1500 EUR');
    const hasDate = extracted.includes('2025');

    console.log('--- Extracted text ---');
    console.log(extracted);
    console.log('--- Checks ---');
    console.log(`OIB present:   ${hasOIB ? 'PASS' : 'FAIL'}`);
    console.log(`Amount present: ${hasAmount ? 'PASS' : 'FAIL'}`);
    console.log(`Date present:  ${hasDate ? 'PASS' : 'FAIL'}`);
    console.log(`Pages:         ${numPages === 1 ? 'PASS' : 'FAIL'} (got ${numPages})`);

    const allPassed = hasOIB && hasAmount && hasDate;
    console.log(`\nOverall: ${allPassed ? 'ALL PASS' : 'SOME FAILED'}`);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
    console.error('Verification failed:', err);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
});
