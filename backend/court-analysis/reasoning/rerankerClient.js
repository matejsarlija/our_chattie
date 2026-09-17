// backend/court-analysis/reasoning/rerankerClient.js
//
// Purpose: The Gemini-backed `llmRerank` implementation handed to
//          rerankEvidence, plus the gating resolver that decides whether
//          reranking runs at all.
//
// Gating:
//   REASONING_RERANK=off    → never rerank
//   REASONING_RERANK=force  → always attempt (ambiguity gate bypassed) — lets
//                             the JSON-parsing/fallback branches be exercised
//                             deterministically instead of shipping untested
//   unset (auto)            → ambiguous candidates only
//
// Cost contract: exactly ONE model call per run; candidates ≤24 (bounded in
// reranker.js); output is a strict JSON array of {id, score} recovered via
// extractJsonBlock with outputCapWarning on parse failure.

const { createGeminiClient, outputCapWarning } = require('../../helpers/geminiConfig');
const { withGeminiRetry, withGeminiTimeout } = require('../../helpers/geminiRetry');
const { trackGeminiInvoke } = require('../../helpers/geminiUsage');
const { extractJsonBlock } = require('../../helpers/jsonExtract');
const agentLog = require('../../helpers/agentLog');
const { resolveReasoningRerankMode } = require('../../helpers/reasoningSettings');

// Lazy client: constructing ChatGoogleGenerativeAI at import time would force
// every consumer of this module (and its tests) to hold an API key, even when
// reranking never runs. Build on first use instead.
let gemini = null;

function getGemini() {
    if (!gemini) gemini = createGeminiClient('rerank');
    return gemini;
}

function resolveRerankMode() {
    // Dashboard setting wins; REASONING_RERANK env stays as CLI fallback
    // (handled inside the resolver).
    return resolveReasoningRerankMode();
}

/**
 * Resolves whether the rerank pass should attempt a model call this run.
 * @param {{ambiguous: boolean}} signals - Cheap deterministic signals.
 */
function shouldAttemptRerank(signals = {}) {
    switch (resolveRerankMode()) {
        case 'off': return false;
        case 'force': return true;
        default:
            return Boolean(signals.ambiguous);
    }
}

function buildRerankPrompt(candidates) {
    const lines = candidates.map((candidate, index) => `${index + 1}. [${candidate.id}] ${candidate.text}`);
    return [
        'Zadan je popis dokaza (isječaka) za jedan pravni predmet.',
        'Ocjeni relevantnost SVAKOG isječka za odgovaranje na pravna pitanja predmeta (vremenski tok, financijski iznosi, status postupka, uloge stranaka).',
        'Vrati strogo JSON polje ocjena 0-1, bez ikakvog drugog teksta:',
        '[{"id":"<id isjecka>","score":<broj 0-1>}, ...]',
        '',
        ...lines
    ].join('\n');
}

/**
 * Factory matching the injected llmRerank contract of rerankEvidence:
 * async ({candidates}) => [{id, score}] — throws on transport errors;
 * returns non-array when parsing fails so the caller falls back gracefully.
 */
function createLlmRerank({ tracker = null, onUsage = null } = {}) {
    return async function llmRerank({ candidates }) {
        if (!Array.isArray(candidates) || candidates.length === 0) return null;

        const prompt = buildRerankPrompt(candidates);
        const response = await withGeminiRetry(() => withGeminiTimeout(
            (signal) => trackGeminiInvoke(getGemini(), prompt, { signal, tracker, onUsage })
        ));

        const parsed = extractJsonBlock(response.content);
        if (!Array.isArray(parsed)) {
            agentLog.warn(outputCapWarning('rerank'));
            agentLog.error('[Reranker] Failed to parse rerank JSON:', String(response.content || '').slice(0, 200));
            return null;
        }

        return parsed.filter((entry) => entry && typeof entry.id === 'string' && Number.isFinite(entry.score));
    };
}

module.exports = {
    resolveRerankMode,
    shouldAttemptRerank,
    createLlmRerank,
    buildRerankPrompt
};
