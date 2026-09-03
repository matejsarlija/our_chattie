// Centralized, env-driven Gemini configuration.
// All pipeline entry points that construct a ChatGoogleGenerativeAI client read
// model + key from this single module so users can swap models/providers in
// backend/.env without hunting through source files.
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const LITE_GEMINI_MODEL = 'gemini-3.5-flash-lite';

const GEMINI_MODEL = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
const GEMINI_API_KEY = process.env.GOOGLE_API_KEY || null;

function assertGeminiConfig() {
    if (!GEMINI_API_KEY) {
        throw new Error(
            'GOOGLE_API_KEY is not set. Copy backend/.env.example to backend/.env and add your Google AI Studio API key (https://aistudio.google.com/apikey).'
        );
    }
    return {
        model: GEMINI_MODEL,
        apiKey: GEMINI_API_KEY,
    };
}

// Role-based client factory: one construction site per concern keeps model,
// temperature, and output-token policy auditable. Each role pins its own
// `model` — small, strictly-bounded JSON roles (rerank/planner) route to the
// cheaper/faster lite model, while roles that read and reason over full
// document text stay on the full model. The top-level GEMINI_MODEL env var
// remains a global override that beats every role's model when explicitly
// set (e.g. during a provider migration or a quick experiment).
// Output caps bound the billing exposure of any single completion.
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

const ENV_MODEL_OVERRIDE = process.env.GEMINI_MODEL || null;

const GEMINI_ROLE_CONFIG = {
    // JSON extraction from document text. Dense documents (long summaries,
    // many amounts entries) can exceed smaller ceilings and truncate
    // mid-JSON — the cap must leave generous headroom.
    analysis: { model: DEFAULT_GEMINI_MODEL, temperature: 0.2, maxOutputTokens: 8192 },
    // Vision OCR of rasterized pages — longer raw-text outputs.
    ocr: { model: DEFAULT_GEMINI_MODEL, temperature: 0.1, maxOutputTokens: 4096 },
    // Multi-page OCR batching: several page images in one request, so the
    // output ceiling must cover the combined raw text of all pages.
    'ocr-batch': { model: DEFAULT_GEMINI_MODEL, temperature: 0.1, maxOutputTokens: 8192 },
    // Full structured report synthesis. Raised from 4096: observed truncating
    // mid-JSON on real multi-document clusters (Synthesizer returned invalid
    // JSON), matching the outputCapWarning below almost verbatim — dense
    // narratives + findings + conflicts routinely exceed the smaller ceiling.
    synthesis: { model: DEFAULT_GEMINI_MODEL, temperature: 0.2, maxOutputTokens: 8192 },
    // Strict verification pass over findings.
    verify: { model: DEFAULT_GEMINI_MODEL, temperature: 0.1, maxOutputTokens: 2048 },
    // Listwise evidence reranking: one JSON array of {id, score} over ≤24
    // candidates — a tiny, strictly-bounded output well within the lite
    // model's ability.
    rerank: { model: LITE_GEMINI_MODEL, temperature: 0.0, maxOutputTokens: 1024 },
    // Retrieval query planning: ≤6 short query objects as one JSON array —
    // small and strictly-bounded, same reasoning as rerank.
    planner: { model: LITE_GEMINI_MODEL, temperature: 0.1, maxOutputTokens: 512 },
    // Mermaid diagram generation.
    visualizer: { model: DEFAULT_GEMINI_MODEL, temperature: 0.1, maxOutputTokens: 2048 },
};

function createGeminiClient(role) {
    const roleConfig = GEMINI_ROLE_CONFIG[role] || {};
    return new ChatGoogleGenerativeAI({
        model: ENV_MODEL_OVERRIDE || roleConfig.model || DEFAULT_GEMINI_MODEL,
        apiKey: GEMINI_API_KEY,
        temperature: roleConfig.temperature,
        maxOutputTokens: roleConfig.maxOutputTokens,
    });
}

// JSON-returning roles can fail to parse for two very different reasons:
// model misbehavior, or the completion being cut off by its own output cap
// (truncation mid-JSON). Call sites log this when parsing fails so truncated
// completions are distinguishable in the logs from ordinary bad output.
function outputCapWarning(role) {
    const cap = GEMINI_ROLE_CONFIG[role]?.maxOutputTokens;
    return (
        `[Gemini] A '${role}' completion could not be parsed as JSON — possible ` +
        `output truncation (role cap: maxOutputTokens=${cap ?? "provider default"}). ` +
        "If this recurs on dense documents, raise the role's cap."
    );
}

module.exports = {
    DEFAULT_GEMINI_MODEL,
    LITE_GEMINI_MODEL,
    GEMINI_MODEL,
    GEMINI_API_KEY,
    assertGeminiConfig,
    GEMINI_ROLE_CONFIG,
    createGeminiClient,
    outputCapWarning,
};
