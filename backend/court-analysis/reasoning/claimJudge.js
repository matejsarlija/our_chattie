// court-analysis/reasoning/claimJudge.js
//
// TX-1 "same claim?" judge (ticket TX-1): a bounded, gated lite-model pass
// over identifier-less pairs the deterministic rules must leave as
// "possibly related" (TR-3) or as arithmetic divergences.
//
// Gate (pure, deterministic): only pairs that survive dedupe + materiality
// with NO shared identifiers (registry number, filing reference, party name,
// OIB) reach the judge. Identifier-backed pairs cost zero calls — the
// deterministic path owns them. At most MAX_CLAIM_JUDGE_PAIRS pairs per run.
//
// Verdicts are ADVISORY annotations (`claimJudge` on the item +
// `claimLinks` records). Nothing is merged, deleted, or reclassified: a
// `same` verdict records linkage evidence for future chain work and the UI;
// `different` confirms the possibly-related standing. An unparseable judge
// response degrades to `uncertain`, never throws.

const { extractJsonBlock } = require('../../helpers/jsonExtract');
const { normalizeText } = require('./indexer');
const { withGeminiRetry, withGeminiTimeout } = require('../../helpers/geminiRetry');
const { trackGeminiInvoke } = require('../../helpers/geminiUsage');
const { createGeminiClient, outputCapWarning } = require('../../helpers/geminiConfig');
const agentLog = require('../../helpers/agentLog');

const MAX_CLAIM_JUDGE_PAIRS = 5;
const QUOTE_EXCERPT_CHARS = 500;

function getGemini() {
    if (!getGemini.cached) getGemini.cached = createGeminiClient('claimJudge');
    return getGemini.cached;
}

function normalizedNames(entry) {
    const names = [];
    for (const key of ['transferor', 'transferee', 'payerName', 'recipientName']) {
        const value = entry?.[key];
        if (typeof value === 'string' && value.trim()) names.push(normalizeText(value));
    }
    return names;
}

function normalizedOibs(entry) {
    const oibs = [];
    for (const key of ['transferorOib', 'transfereeOib', 'payerOib', 'recipientOib']) {
        const digits = String(entry?.[key] || '').replace(/\D/g, '');
        if (digits.length === 11) oibs.push(digits);
    }
    return oibs;
}

function entryIdentifiers(entry) {
    const registries = [];
    const filings = [];
    if (typeof entry?.claimRegistryNumber === 'string' && entry.claimRegistryNumber.trim()) {
        registries.push(entry.claimRegistryNumber.trim().toLowerCase());
    }
    if (typeof entry?.filingReference === 'string' && entry.filingReference.trim()) {
        filings.push(entry.filingReference.trim().toLowerCase());
    }
    return { registries, filings, names: normalizedNames(entry), oibs: normalizedOibs(entry) };
}

/**
 * True when any identifier is shared across the entry set (registry number,
 * filing reference, party name, or OIB). Identifier-backed groups never
 * reach the judge.
 */
function groupSharesIdentifiers(entries) {
    const seen = { registries: new Set(), filings: new Set(), names: new Set(), oibs: new Set() };
    for (const entry of entries) {
        const ids = entryIdentifiers(entry);
        for (const [bucket, values] of Object.entries(ids)) {
            for (const value of values) {
                if (seen[bucket].has(value)) return true;
                seen[bucket].add(value);
            }
        }
    }
    return false;
}

function resolveEntriesBySources(sources, flowEntries) {
    const bySourceId = new Map();
    for (const entry of Array.isArray(flowEntries) ? flowEntries : []) {
        if (entry?.sourceId && !bySourceId.has(entry.sourceId)) bySourceId.set(entry.sourceId, entry);
    }
    const resolved = [];
    for (const sourceId of Array.isArray(sources) ? sources : []) {
        const entry = bySourceId.get(sourceId);
        if (entry && !resolved.includes(entry)) resolved.push(entry);
    }
    return resolved;
}

function effectiveValue(entry) {
    if (Number.isFinite(entry?.valueEur)) return entry.valueEur;
    if (Number.isFinite(entry?.value)) return entry.value;
    return null;
}

/**
 * Selects judge candidate pairs (pure). Stable order: possibly-related
 * lifecycle questions first, then identifier-less arithmetic conflicts.
 */
function selectClaimJudgePairs(reconciliation, flows, options = {}) {
    const maxPairs = Number.isFinite(options.maxPairs) && options.maxPairs >= 0
        ? Math.floor(options.maxPairs)
        : MAX_CLAIM_JUDGE_PAIRS;
    const flowEntries = Array.isArray(flows?.entries) ? flows.entries : [];
    const pairs = [];

    const questions = Array.isArray(reconciliation?.openQuestions) ? reconciliation.openQuestions : [];
    questions.forEach((question, itemIndex) => {
        if (pairs.length >= maxPairs) return;
        if (!question || question.relationship !== 'possibly-related') return;
        const resolved = resolveEntriesBySources(question.sources, flowEntries);
        if (resolved.length < 2) return;
        if (groupSharesIdentifiers(resolved)) return;
        const [entryA, entryB] = [...resolved].sort((a, b) =>
            String(a.sourceId || '').localeCompare(String(b.sourceId || ''))).slice(0, 2);
        pairs.push({
            itemKind: 'openQuestion',
            itemIndex,
            entryA: describeEntry(entryA),
            entryB: describeEntry(entryB),
            reason: 'identifier-less possibly-related pair'
        });
    });

    const conflicts = Array.isArray(reconciliation?.conflicts) ? reconciliation.conflicts : [];
    conflicts.forEach((conflict, itemIndex) => {
        if (pairs.length >= maxPairs) return;
        if (!conflict || conflict.kind !== 'arithmetic') return;
        const resolved = resolveEntriesBySources(conflict.sources, flowEntries);
        if (resolved.length < 2) return;
        if (groupSharesIdentifiers(resolved)) return;
        // Most informative divergence first: min/max effective value.
        const ranked = [...resolved].sort((a, b) => (effectiveValue(a) ?? 0) - (effectiveValue(b) ?? 0));
        pairs.push({
            itemKind: 'conflict',
            itemIndex,
            entryA: describeEntry(ranked[0]),
            entryB: describeEntry(ranked[ranked.length - 1]),
            reason: 'identifier-less arithmetic divergence'
        });
    });

    return pairs;
}

function describeEntry(entry) {
    return {
        sourceId: entry?.sourceId || null,
        fileName: entry?.fileName || null,
        description: entry?.description || null,
        value: entry?.value ?? null,
        valueEur: entry?.valueEur ?? null,
        currency: entry?.currency || null,
        transferor: entry?.transferor || entry?.payerName || null,
        transferee: entry?.transferee || entry?.recipientName || null,
        claimRegistryNumber: entry?.claimRegistryNumber || null,
        filingReference: entry?.filingReference || null,
        date: entry?.date || null,
        quote: typeof entry?.quote === 'string' ? entry.quote.slice(0, QUOTE_EXCERPT_CHARS) : null
    };
}

function buildClaimJudgePrompt(pair) {
    const render = (label, entry) => [
        `${label}:`,
        `- opis: ${entry.description || '(nepoznato)'}`,
        `- iznos: ${entry.value ?? '?'} ${entry.currency || ''}${entry.valueEur !== null && entry.valueEur !== undefined ? ` (≈ ${entry.valueEur} EUR)` : ''}`,
        `- stranke: ${entry.transferor || '?'} → ${entry.transferee || '?'}`,
        `- identifikatori: redni broj ${entry.claimRegistryNumber || '—'}, poslovni broj ${entry.filingReference || '—'}, datum ${entry.date || '—'}`,
        `- citat: ${entry.quote ? `"${entry.quote}"` : '(nema citata)'}`
    ].join('\n');
    return `SAME-CLAIM JUDGE. Two extracted court-filing facts may describe the SAME receivable/claim. They share no registry number, filing reference, party, or OIB — otherwise this check would not run. Decide ONLY from the evidence below.\n\n${render('Tvrdnja A', pair.entryA)}\n\n${render('Tvrdnja B', pair.entryB)}\n\nReturn ONLY a JSON object: {"verdict": "same" | "different" | "uncertain", "confidence": "high" | "medium" | "low", "reasons": "<1-2 sentences in Croatian>"}. Choose "uncertain" (never guess) when the evidence cannot decide. Provide ONLY the json object and nothing else.`;
}

function parseClaimVerdict(content) {
    const parsed = extractJsonBlock(typeof content === 'string' ? content : '');
    const verdict = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    if (verdict && ['same', 'different', 'uncertain'].includes(verdict.verdict)) {
        return {
            verdict: verdict.verdict,
            confidence: ['high', 'medium', 'low'].includes(verdict.confidence) ? verdict.confidence : 'low',
            reasons: typeof verdict.reasons === 'string' && verdict.reasons.trim() ? verdict.reasons.trim() : null
        };
    }
    return { verdict: 'uncertain', confidence: 'low', reasons: 'unparseable judge output' };
}

function createClaimJudge({ tracker = null, onUsage = null } = {}) {
    return async function judgeClaim(pair) {
        const prompt = buildClaimJudgePrompt(pair);
        const response = await withGeminiRetry(() => withGeminiTimeout(
            (signal) => trackGeminiInvoke(getGemini(), prompt, { signal, tracker, onUsage })
        ));
        const parsed = parseClaimVerdict(response?.content);
        if (parsed.reasons === 'unparseable judge output') {
            agentLog.warn(outputCapWarning('claimJudge'));
        }
        return parsed;
    };
}

/**
 * Runs the judge over gated pairs (at most one call per pair). Never throws:
 * a transport failure degrades that pair to `uncertain`.
 */
async function runClaimJudge(pairs, options = {}) {
    const judgeLlm = typeof options.judgeLlm === 'function' ? options.judgeLlm : createClaimJudge(options);
    const verdicts = [];
    for (const pair of Array.isArray(pairs) ? pairs : []) {
        try {
            verdicts.push(await judgeLlm(pair));
        } catch (err) {
            agentLog.warn(`[ClaimJudge] Pair failed; recording uncertain (${err.message})`);
            verdicts.push({ verdict: 'uncertain', confidence: 'low', reasons: `judge call failed: ${err.message}` });
        }
    }
    return verdicts;
}

/**
 * Applies verdicts as advisory annotations. Returns `{ claimLinks }`; the
 * items themselves gain a `claimJudge` field. Nothing is merged or removed.
 */
function applyClaimVerdicts(reconciliation, pairs, verdicts) {
    const list = Array.isArray(pairs) ? pairs : [];
    const claimLinks = [];
    list.forEach((pair, position) => {
        const verdict = Array.isArray(verdicts) ? verdicts[position] : null;
        if (!verdict) return;
        const record = {
            itemKind: pair.itemKind,
            itemIndex: pair.itemIndex,
            entryA: { sourceId: pair.entryA?.sourceId || null, fileName: pair.entryA?.fileName || null },
            entryB: { sourceId: pair.entryB?.sourceId || null, fileName: pair.entryB?.fileName || null },
            verdict: verdict.verdict,
            confidence: verdict.confidence,
            reasons: verdict.reasons
        };
        claimLinks.push(record);
        const bucket = pair.itemKind === 'conflict'
            ? reconciliation?.conflicts
            : reconciliation?.openQuestions;
        const item = Array.isArray(bucket) ? bucket[pair.itemIndex] : null;
        if (item && typeof item === 'object') {
            item.claimJudge = { verdict: verdict.verdict, confidence: verdict.confidence, reasons: verdict.reasons };
        }
    });
    return { claimLinks };
}

module.exports = {
    MAX_CLAIM_JUDGE_PAIRS,
    selectClaimJudgePairs,
    groupSharesIdentifiers,
    buildClaimJudgePrompt,
    parseClaimVerdict,
    createClaimJudge,
    runClaimJudge,
    applyClaimVerdicts
};
