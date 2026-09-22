// Native Gemini PDF input adapter.
//
// This intentionally sits beside, rather than inside, the LangChain client
// factory. @langchain/google-genai is still used for the rest of the pipeline,
// but its document-input support has historically lagged the official SDK.
// Keeping this seam small makes the experiment reversible.

const { GoogleGenAI, MediaResolution } = require('@google/genai');

const DOCUMENT_INPUT_MODES = Object.freeze({
    LOCAL: 'local',
    NATIVE_PDF: 'native_pdf',
    AUTO: 'auto',
});

function resolveDocumentInputMode(value = process.env.DOCUMENT_INPUT_MODE) {
    // Native PDF is the default for bounded scanned filings. Raster OCR stays
    // the fallback, so a provider/document failure still never fails a run.
    const normalized = String(value || DOCUMENT_INPUT_MODES.AUTO)
        .trim()
        .toLowerCase();
    return Object.values(DOCUMENT_INPUT_MODES).includes(normalized)
        ? normalized
        : DOCUMENT_INPUT_MODES.LOCAL;
}

function resolveNativePdfMinPages() {
    const raw = Number.parseInt(process.env.NATIVE_PDF_MIN_PAGES, 10);
    return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function resolveNativePdfMaxPages(fallbackMaxPages) {
    const raw = Number.parseInt(process.env.NATIVE_PDF_MAX_PAGES, 10);
    const configured = Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallbackMaxPages;
    return Math.min(configured, fallbackMaxPages);
}

function shouldUseNativePdf({ mode, pageCount, fallbackMaxPages }) {
    if (mode === DOCUMENT_INPUT_MODES.LOCAL) return false;
    if (!Number.isFinite(pageCount) || pageCount < 1) return false;

    // Native input receives the original PDF; unlike raster OCR, it cannot
    // silently limit itself to a page prefix. Do not turn a bounded analysis
    // budget into an accidental full-docket upload.
    if (pageCount > resolveNativePdfMaxPages(fallbackMaxPages)) return false;

    return mode === DOCUMENT_INPUT_MODES.NATIVE_PDF
        || pageCount >= resolveNativePdfMinPages();
}

function buildNativePdfTranscriptInstruction(pageCount) {
    return [
        'Transcribe this Croatian court PDF faithfully, page by page.',
        'Preserve amounts, dates, identifiers, OIBs, tables, and visible headings exactly as written.',
        `For every page from 1 through ${pageCount}, begin with a line exactly '=== STRANICA N ===' using that PDF page number.`,
        'Put the text from that page below its marker. Return no commentary, summary, or interpretation.',
    ].join(' ');
}

function nativePdfGenerationConfig(model, { signal } = {}) {
    const config = {
        temperature: 0.1,
        maxOutputTokens: 16384,
        ...(signal ? { abortSignal: signal } : {}),
    };

    // The explicit medium setting is a Gemini 3 control. Sending it to the
    // current 2.5 default would make this adapter less portable, so only set
    // it for the model family that documents the parameter.
    if (/^gemini-3(?:[.-]|$)/i.test(String(model || ''))) {
        config.mediaResolution = MediaResolution.MEDIA_RESOLUTION_MEDIUM;
    }
    return config;
}

function extractNativeUsage(response) {
    const usage = response?.usageMetadata;
    if (!usage || typeof usage !== 'object') return null;
    const inputTokens = usage.promptTokenCount;
    const outputTokens = usage.candidatesTokenCount;
    const totalTokens = usage.totalTokenCount;
    return [inputTokens, outputTokens, totalTokens].some((value) => Number.isFinite(value))
        ? { inputTokens, outputTokens, totalTokens }
        : null;
}

/**
 * Sends an original PDF to Gemini's native document endpoint. This function
 * is deliberately transport-only: callers validate page markers and retain
 * the existing grounding/extraction pipeline after it returns.
 */
async function transcribeNativePdf({ apiKey, model, fileBytes, pageCount, signal }) {
    if (!apiKey) throw new Error('GOOGLE_API_KEY is not set.');
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
        model,
        contents: [{
            role: 'user',
            parts: [
                {
                    inlineData: {
                        mimeType: 'application/pdf',
                        data: Buffer.from(fileBytes).toString('base64'),
                    },
                },
                { text: buildNativePdfTranscriptInstruction(pageCount) },
            ],
        }],
        config: nativePdfGenerationConfig(model, { signal }),
    });
    return {
        text: String(response?.text || ''),
        usage: extractNativeUsage(response),
    };
}

module.exports = {
    DOCUMENT_INPUT_MODES,
    resolveDocumentInputMode,
    resolveNativePdfMinPages,
    resolveNativePdfMaxPages,
    shouldUseNativePdf,
    buildNativePdfTranscriptInstruction,
    nativePdfGenerationConfig,
    extractNativeUsage,
    transcribeNativePdf,
};
