/**
 * Real-document extraction regression lane.
 *
 * Exercises the UNMOCKED production extraction path (pdfjs-dist v3 legacy
 * build) against actual e-Oglasna court documents fetched by
 * `npm run fixtures:fetch` (scripts/fetch-real-document-fixtures.js) —
 * the unit lane fully mocks pdfjs-dist/canvas, so this file is the only
 * automated guard that a parser upgrade keeps parsing real court PDFs.
 *
 * Extraction itself is executed in a child process (the same "run outside
 * Jest" constraint recorded in e4459dd: the real pdfjs build keeps worker
 * handles open under Jest), and the test asserts on its JSON report.
 *
 * Binaries are local-only (gitignored): when the fixture set or its manifest
 * is missing the whole suite self-skips, keeping CI deterministic.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const util = require('util');

const execFileAsync = util.promisify(execFile);

const FIXTURE_OIB = '66124057408';
const fixturesDir = path.resolve(__dirname, 'fixtures/real-documents', FIXTURE_OIB);
const manifestPath = path.join(fixturesDir, 'manifest.json');

const hasFixtures = fs.existsSync(manifestPath);

if (!hasFixtures) {
    console.warn(
        '[document-extraction.real] Fixtures not found — skipping. ' +
        `Run "npm run fixtures:fetch" to download real e-Oglasna documents into ${fixturesDir}.`,
    );
}

(hasFixtures ? describe : describe.skip)('real-document extraction (unmocked pdfjs-dist)', () => {
    let manifest;
    let report;

    const sha256File = (filePath) =>
        crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

    const allFiles = () => manifest.entries.flatMap((entry) => entry.files);

    beforeAll(async () => {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

        // Re-run the real production extraction over every fixture file.
        const reportPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'real-pdf-report-')), 'report.json');
        await execFileAsync('node', [
            'scripts/fetch-real-document-fixtures.js',
            `--oib=${FIXTURE_OIB}`,
            '--verify-only',
            `--report-out=${reportPath}`,
        ], { cwd: path.resolve(__dirname, '..'), timeout: 120000 });
        report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        fs.rmSync(path.dirname(reportPath), { recursive: true, force: true });
    }, 180000);

    it('recorded fixture files exist with matching size and checksum', () => {
        const files = allFiles();
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            expect(fs.existsSync(file.filePath)).toBe(true);
            expect(fs.statSync(file.filePath).size).toBe(file.bytes);
            expect(sha256File(file.filePath)).toBe(file.sha256);
        }
    });

    it('embedded-text PDFs extract through the real pdfjs pipeline', () => {
        const embedded = allFiles().filter((file) => file.extraction?.textLayer === 'embedded');
        expect(embedded.length).toBeGreaterThan(0);

        for (const file of embedded) {
            const observed = findReportedExtraction(file);
            expect(observed.method).toBe('pdf-text');
            expect(observed.error).toBeNull();
            // Regression guards against silent parser drift: page count and
            // extractable character volume must match what was recorded when
            // the fixtures were fetched from e-Oglasna.
            expect(observed.pages).toBe(file.extraction.pages);
            expect(observed.chars).toBe(file.extraction.chars);
            expect(observed.chars).toBeGreaterThan(0);
        }
    });

    it('empty-text-layer PDFs stay eligible for OCR fallback (no parse error)', () => {
        const scanned = allFiles().filter((file) => file.extraction?.textLayer === 'empty');

        // The fetched sample must contain at least one scanned document,
        // otherwise this guard silently stops covering the OCR path.
        expect(scanned.length).toBeGreaterThan(0);

        for (const file of scanned) {
            const observed = findReportedExtraction(file);
            // A scanned page yields an empty layer WITHOUT an error code —
            // that distinction is what sends it to OCR instead of failing.
            expect(observed.method).toBe('pdf-text');
            expect(observed.error).toBeNull();
            expect(observed.chars).toBe(0);
        }
    });

    it('render probe (local OCR rasterization) recorded as passing', () => {
        expect(manifest.renderProbe).toEqual(expect.objectContaining({ ok: true }));
    });

    function findReportedExtraction(fixtureFile) {
        const reportedFiles = report.entries.flatMap((entry) => entry.files);
        const match = reportedFiles.find((file) =>
            file.entryName === fixtureFile.entryName && file.bytes === fixtureFile.bytes);
        expect(match).toBeDefined();
        return match.extraction;
    }
});
