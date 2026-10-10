#!/usr/bin/env node
// Controlled A/B benchmark for native Gemini PDF input vs. the existing
// rasterized-page OCR. It never scrapes or downloads: callers must explicitly
// name a local PDF. Generated transcripts/results stay under backend/data/,
// which is intentionally gitignored.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
    extractTextViaNativePdf,
    extractTextViaOCR,
} = require('../court-analysis/agents/analysis-agent');
const { AnalyzeDocumentsTool } = require('../court-analysis/agents/analysis-agent');
const { createUsageTracker } = require('../helpers/geminiUsage');

function parseArgs(argv) {
    const args = {};
    for (const item of argv) {
        const match = /^--([^=]+)=(.*)$/.exec(item);
        if (match) args[match[1]] = match[2];
        else if (item === '--approved' || item === '--raster-only') {
            args[item.slice(2)] = true;
        }
    }
    return args;
}

function usageWithElapsed(tracker, elapsedMs) {
    return { ...tracker.snapshot(), elapsedMs };
}

function transcriptSummary(text, expectedPages) {
    const markers = [...String(text || '').matchAll(/^===\s*STRANICA\s+(\d+)\s*===/gim)]
        .map((match) => Number(match[1]));
    return {
        chars: String(text || '').length,
        expectedPages,
        markerCount: markers.length,
        pagesMarked: markers,
        complete: markers.length === expectedPages && markers.every((page, index) => page === index + 1),
    };
}

function claimSummary(aiResult) {
    const amounts = Array.isArray(aiResult?.amounts) ? aiResult.amounts : [];
    const propertyFlow = Array.isArray(aiResult?.propertyFlow) ? aiResult.propertyFlow : [];
    const claims = [...amounts, ...propertyFlow];
    return {
        summaryPresent: Boolean(aiResult?.summary),
        amounts: amounts.length,
        propertyFlow: propertyFlow.length,
        groundedClaims: claims.filter((claim) => claim?.grounded === true).length,
        totalClaims: claims.length,
        citedFilingReferences: Array.isArray(aiResult?.citedFilingReferences)
            ? aiResult.citedFilingReferences.length
            : 0,
        extractionGaps: Array.isArray(aiResult?._extractionGaps) ? aiResult._extractionGaps.length : 0,
    };
}

function combineUsage(...usages) {
    return usages.reduce((total, usage) => ({
        inputTokens: total.inputTokens + (usage?.inputTokens || 0),
        outputTokens: total.outputTokens + (usage?.outputTokens || 0),
        totalTokens: total.totalTokens + (usage?.totalTokens || 0),
        calls: total.calls + (usage?.calls || 0),
        elapsedMs: total.elapsedMs + (usage?.elapsedMs || 0),
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0, elapsedMs: 0 });
}

async function analyzeTranscript({ transcriptPath, label }) {
    const tracker = createUsageTracker();
    const startedAt = Date.now();
    const tool = new AnalyzeDocumentsTool();
    const response = await tool._call({
        files: [{ filePath: transcriptPath, text: `${label} transcript` }],
        caseInfo: { caseNumber: 'ST-2/2013', participants: [] },
        usageTracker: tracker,
    });
    const analysis = response.individualAnalyses[0] || {};
    return {
        elapsedMs: Date.now() - startedAt,
        usage: usageWithElapsed(tracker, Date.now() - startedAt),
        aiResult: analysis.aiResult || null,
        error: analysis.error || null,
        coverage: response.coverage,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.approved) {
        throw new Error('Refusing live Gemini benchmark without --approved. This uploads the named local PDF to Gemini.');
    }
    const filePath = args.file ? path.resolve(args.file) : null;
    if (!filePath || !fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== '.pdf') {
        throw new Error('Pass an existing local PDF with --file=/absolute/or/relative/path.pdf');
    }
    if (!process.env.GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY is required for the live benchmark.');
    }

    const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`;
    const outputDir = path.resolve(__dirname, '../data/native-pdf-benchmarks', runId);
    fs.mkdirSync(outputDir, { recursive: true });
    const bytes = fs.readFileSync(filePath);
    const source = {
        fileName: path.basename(filePath),
        bytes: bytes.length,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        runId,
        rasterRenderScale: args['raster-scale'] || process.env.OCR_RENDER_SCALE || '1',
        rasterLongEdge: args['raster-long-edge'] || process.env.OCR_IMAGE_LONG_EDGE || '2000',
    };
    const writeCheckpoint = (name, value) => {
        fs.writeFileSync(path.join(outputDir, name), JSON.stringify({ source, ...value }, null, 2), 'utf8');
    };

    // Separate caches prevent a result from either route contaminating the
    // other. Both remain inside the ignored benchmark directory.
    const previous = {
        mode: process.env.DOCUMENT_INPUT_MODE,
        minPages: process.env.NATIVE_PDF_MIN_PAGES,
        maxPages: process.env.NATIVE_PDF_MAX_PAGES,
        maxOcrPages: process.env.OCR_MAX_PAGES,
        cacheDir: process.env.OCR_CACHE_DIR,
        rasterScale: process.env.OCR_RENDER_SCALE,
        rasterLongEdge: process.env.OCR_IMAGE_LONG_EDGE,
    };

    let native;
    let raster;
    try {
        if (!args['raster-only']) {
            process.env.DOCUMENT_INPUT_MODE = 'native_pdf';
            process.env.NATIVE_PDF_MAX_PAGES = process.env.NATIVE_PDF_MAX_PAGES || '10';
            process.env.OCR_MAX_PAGES = process.env.OCR_MAX_PAGES || '10';
            process.env.OCR_CACHE_DIR = path.join(outputDir, 'native-cache');
            const nativeTracker = createUsageTracker();
            const nativeStartedAt = Date.now();
            const nativeExtraction = await extractTextViaNativePdf(filePath, null, { tracker: nativeTracker });
            native = {
                extraction: nativeExtraction,
                usage: usageWithElapsed(nativeTracker, Date.now() - nativeStartedAt),
                transcript: transcriptSummary(nativeExtraction.text, nativeExtraction.pages),
            };
            writeCheckpoint('native-ocr.json', { route: 'native_pdf', result: native });
            if (nativeExtraction.text) {
                const transcriptPath = path.join(outputDir, 'native-pdf-transcript.txt');
                fs.writeFileSync(transcriptPath, nativeExtraction.text, 'utf8');
                native.analysis = await analyzeTranscript({ transcriptPath, label: 'Native PDF' });
                writeCheckpoint('native-analysis.json', { route: 'native_pdf', result: native });
            }
        }

        process.env.DOCUMENT_INPUT_MODE = 'local';
        process.env.OCR_CACHE_DIR = path.join(outputDir, 'raster-cache');
        process.env.OCR_RENDER_SCALE = source.rasterRenderScale;
        process.env.OCR_IMAGE_LONG_EDGE = source.rasterLongEdge;
        const rasterTracker = createUsageTracker();
        const rasterStartedAt = Date.now();
        const rasterExtraction = await extractTextViaOCR(filePath, null, { tracker: rasterTracker });
        raster = {
            extraction: rasterExtraction,
            usage: usageWithElapsed(rasterTracker, Date.now() - rasterStartedAt),
            transcript: transcriptSummary(rasterExtraction.text, rasterExtraction.pages),
        };
        writeCheckpoint('raster-ocr.json', { route: 'raster_ocr', result: raster });
        if (rasterExtraction.text) {
            const transcriptPath = path.join(outputDir, 'raster-ocr-transcript.txt');
            fs.writeFileSync(transcriptPath, rasterExtraction.text, 'utf8');
            raster.analysis = await analyzeTranscript({ transcriptPath, label: 'Raster OCR' });
            writeCheckpoint('raster-analysis.json', { route: 'raster_ocr', result: raster });
        }
    } finally {
        for (const [key, value] of Object.entries(previous)) {
            const envKey = ({ mode: 'DOCUMENT_INPUT_MODE', minPages: 'NATIVE_PDF_MIN_PAGES', maxPages: 'NATIVE_PDF_MAX_PAGES', maxOcrPages: 'OCR_MAX_PAGES', cacheDir: 'OCR_CACHE_DIR', rasterScale: 'OCR_RENDER_SCALE', rasterLongEdge: 'OCR_IMAGE_LONG_EDGE' })[key];
            if (value === undefined) delete process.env[envKey];
            else process.env[envKey] = value;
        }
    }

    const nativeClaimSummary = native ? claimSummary(native.analysis?.aiResult) : null;
    const rasterClaimSummary = claimSummary(raster.analysis?.aiResult);
    const report = {
        source,
        routes: {
            ...(native ? { nativePdf: {
                ...native,
                claimSummary: nativeClaimSummary,
                totalUsage: combineUsage(native.usage, native.analysis?.usage),
            } } : {}),
            rasterOcr: {
                ...raster,
                claimSummary: rasterClaimSummary,
                totalUsage: combineUsage(raster.usage, raster.analysis?.usage),
            },
        },
        comparison: native ? {
            nativeMinusRasterTokens: combineUsage(native.usage, native.analysis?.usage).totalTokens
                - combineUsage(raster.usage, raster.analysis?.usage).totalTokens,
            nativeMinusRasterElapsedMs: combineUsage(native.usage, native.analysis?.usage).elapsedMs
                - combineUsage(raster.usage, raster.analysis?.usage).elapsedMs,
            nativeGroundedClaimDelta: nativeClaimSummary.groundedClaims - rasterClaimSummary.groundedClaims,
            nativeClaimDelta: nativeClaimSummary.totalClaims - rasterClaimSummary.totalClaims,
        } : null,
    };
    const reportPath = path.join(outputDir, 'comparison.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(JSON.stringify({
        reportPath,
        nativePdf: report.routes.nativePdf?.totalUsage || null,
        rasterOcr: report.routes.rasterOcr.totalUsage,
        comparison: report.comparison,
    }, null, 2));
}

main().catch((error) => {
    console.error(`[native-pdf-benchmark] ${error.message}`);
    process.exitCode = 1;
});
