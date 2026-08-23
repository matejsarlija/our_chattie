# Real e-Oglasna document fixtures

Local-only regression fixtures: actual court documents for OIB
**66124057408**, downloaded from https://e-oglasna.pravosudje.hr.

Everything in this directory **except this README is gitignored**
(`*.pdf`/`*.zip` global rules plus the `real-documents/*` rule). CI never
sees the binaries, so `tests/document-extraction.real.test.js` self-skips
when they are missing — commit neither the documents nor `manifest.json`.

## Usage (from `backend/`)

```bash
npm run fixtures:fetch    # search, download ~10 entries, unzip, extract, probe, write manifest
npm run fixtures:verify   # re-run extraction over an existing manifest (also used by tests)
```

Fetch performs, with no Gemini calls:

1. Puppeteer search on e-Oglasna (headless via `PUPPETEER_HEADLESS=1`),
   first page, entries carrying a `/preuzimanje` download link.
2. Download each archive — note the row-level link usually serves a
   **single PDF**, occasionally a ZIP; extension resolved from
   Content-Disposition/Content-Type exactly like `download-agent.js`.
3. Checksums (sha256) + sizes recorded per file.
4. Extraction of every file through the real production path
   (`extractTextFromFile`, unmocked pdfjs-dist v3 legacy build), recording
   method/pages/chars/error/textLayer.
5. One render probe: page 1 rasterized through node-canvas (the OCR
   preprocessing step) asserting non-blank output.

The Jest lane then asserts current behavior matches the recorded facts:
checksums stable, embedded-text PDFs still yield identical page/char
counts, scanned PDFs still return empty text *without* an error code
(OCR-fallback eligibility), render probe still passing.

Re-run `fixtures:fetch` after major site or parser changes to rebase the
recorded expectations intentionally.
