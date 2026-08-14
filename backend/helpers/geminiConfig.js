// Centralized, env-driven Gemini configuration.
// All pipeline entry points that construct a ChatGoogleGenerativeAI client read
// model + key from this single module so users can swap models/providers in
// backend/.env without hunting through source files.
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

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

module.exports = {
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODEL,
    GEMINI_API_KEY,
    assertGeminiConfig,
};
