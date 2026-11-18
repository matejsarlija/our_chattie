// Recovery parser for LLM JSON responses.
//
// Models occasionally wrap otherwise-valid JSON in prose ("Here is the
// requested JSON:") or leave fence markers in place. A strict JSON.parse then
// throws away an already-paid-for completion and — for synthesis/verification
// — the whole run. Extraction order: raw text -> fence-stripped -> first
// balanced block. The balanced scan is string-aware so brackets inside string
// literals cannot desynchronize it. Returns the parsed value, or null when
// nothing parseable exists (callers decide how to fail).
//
// LangChain does not always hand back a plain string: when Gemini returns
// multiple content parts (e.g. a thinking part plus the answer, or an answer
// split across parts) `AIMessage.content` is an array of `{type:'text', text}`
// blocks. Treating that array as "no content" silently degraded synthesis,
// verification and Lab node summaries to their failure paths, so extraction
// now understands both shapes.

function stripCodeFences(text) {
    return String(text || "")
        .replace(/```(?:json|JSON)?\s*/g, "")
        .replace(/```/g, "")
        .trim();
}

function textBlockText(block) {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    if (typeof block.text === 'string') return block.text;
    if (typeof block.value === 'string') return block.value;
    return '';
}

/**
 * Normalizes an AIMessage `content` value (string, content-block array, or a
 * single content block) into the concatenated text the model produced.
 * Non-text blocks are ignored. Returns `''` when there is no text.
 */
function modelContentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content.map(textBlockText).join('');
    }
    if (content && typeof content === 'object') return textBlockText(content);
    return '';
}

function textCandidates(raw) {
    if (typeof raw === 'string') return [raw];
    if (Array.isArray(raw)) {
        const parts = raw.map(textBlockText).filter((part) => part.trim());
        // Individual parts preserve independent answers (last answer wins);
        // the joined form also covers answers split across several parts.
        // Callers try a complete joined response before fragment recovery.
        const ordered = [...parts].reverse();
        const joined = parts.join('');
        return joined && joined !== ordered[0] ? [...ordered, joined] : ordered;
    }
    const text = textBlockText(raw);
    return text.trim() ? [text] : [];
}

/**
 * Returns the index just past the block that starts at `start`, or -1 when the
 * block never closes. String-aware, so brackets inside JSON strings are inert.
 */
function balancedEnd(text, start, open, close) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) { escaped = false; continue; }
            if (ch === "\\") { escaped = true; continue; }
            if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === open) depth += 1;
        else if (ch === close) {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    return -1;
}

function findBalanced(text, open, close) {
    const start = text.indexOf(open);
    if (start === -1) return null;
    const end = balancedEnd(text, start, open, close);
    return end === -1 ? null : text.slice(start, end);
}

// A response that starts with a JSON array (`[{...}]`) embedded in prose has
// its first `{` *inside* the array, so scanning braces first would return one
// element instead of the array. Try whichever bracket appears first, then the
// other, so both response shapes recover.
function blockSearchOrder(text) {
    const objectOrder = [["{", "}"], ["[", "]"]];
    const braces = text.indexOf("{");
    const brackets = text.indexOf("[");
    if (braces === -1 || brackets === -1 || braces < brackets) return objectOrder;
    return [objectOrder[1], objectOrder[0]];
}

function parseJsonString(raw, allowRecovery = true) {
    if (typeof raw !== 'string' || !raw.trim()) return null;

    for (const candidate of [raw.trim(), stripCodeFences(raw)]) {
        try {
            return JSON.parse(candidate);
        } catch (_) { /* fall through to block extraction */ }
    }
    if (!allowRecovery) return null;

    const stripped = stripCodeFences(raw);
    for (const [open, close] of blockSearchOrder(stripped)) {
        const block = findBalanced(stripped, open, close);
        if (!block) continue;
        try {
            return JSON.parse(block);
        } catch (_) { /* keep scanning */ }
    }
    return null;
}

function extractJsonBlock(raw) {
    if (Array.isArray(raw)) {
        // A continuation can contain a complete inner row before the outer
        // array closes. Parse the complete response before recovering rows
        // from individual parts, but keep independent-answer precedence
        // when the concatenation is not itself valid JSON.
        const parsed = parseJsonString(modelContentToText(raw), false);
        if (parsed !== null) return parsed;
    }
    for (const candidate of textCandidates(raw)) {
        const parsed = parseJsonString(candidate);
        if (parsed !== null) return parsed;
    }
    return null;
}

/**
 * Parses a top-level JSON array, accepting the shapes models actually emit:
 * a bare array, an array wrapped in prose or fences, and an array wrapped in
 * a single-key object (`{"results": [...]}`). Incomplete trailing elements of
 * a truncated array are dropped rather than failing the whole response, which
 * is what an output cap produces mid-completion.
 *
 * @returns {{ items: Array, truncated: boolean } | null} `truncated` marks a
 *   response recovered past an unparseable/absent tail, so callers can report
 *   the shortfall instead of silently treating it as complete.
 */
function extractJsonArray(raw) {
    if (Array.isArray(raw)) {
        const parsed = parseJsonString(modelContentToText(raw), false);
        if (Array.isArray(parsed)) return { items: parsed, truncated: false };
        const nested = arrayProperty(parsed);
        if (nested) return { items: nested, truncated: false };
    }
    for (const candidate of textCandidates(raw)) {
        const parsed = parseJsonString(candidate);
        if (Array.isArray(parsed)) return { items: parsed, truncated: false };
        const nested = arrayProperty(parsed);
        if (nested) return { items: nested, truncated: false };
    }
    for (const candidate of textCandidates(raw)) {
        const salvaged = salvageArray(stripCodeFences(candidate));
        if (salvaged) return salvaged;
    }
    return null;
}

// Wrapper keys seen in practice, most specific first. A single unnamed array
// property is accepted too: one array inside an object can only be that list.
const ARRAY_WRAPPER_KEYS = ['results', 'verification', 'verdicts', 'findings', 'statements', 'items', 'data'];

function arrayProperty(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    for (const key of ARRAY_WRAPPER_KEYS) {
        if (Array.isArray(parsed[key])) return parsed[key];
    }
    const arrays = Object.values(parsed).filter(Array.isArray);
    return arrays.length === 1 ? arrays[0] : null;
}

/**
 * Recovers the leading complete elements of a JSON array whose tail is
 * missing or malformed. Only whole elements are returned, so every recovered
 * value is a complete, valid JSON parse — never a partially parsed object.
 * Scans forward past earlier prose brackets (`[1]`) that hold no elements.
 */
function salvageArray(text) {
    if (typeof text !== 'string') return null;
    let start = text.indexOf('[');
    while (start !== -1) {
        const salvaged = salvageArrayAt(text, start);
        if (salvaged) return salvaged;
        start = text.indexOf('[', start + 1);
    }
    return null;
}

function salvageArrayAt(text, start) {
    const items = [];
    let index = start + 1;
    while (index < text.length) {
        while (index < text.length && (text[index] === ',' || /\s/.test(text[index]))) index += 1;
        if (index >= text.length) break;
        if (text[index] === ']') return { items, truncated: false };
        const open = text[index];
        const close = open === '{' ? '}' : open === '[' ? ']' : null;
        if (!close) break;
        const end = balancedEnd(text, index, open, close);
        if (end === -1) break;
        try {
            items.push(JSON.parse(text.slice(index, end)));
        } catch (_) {
            break;
        }
        index = end;
    }
    return items.length > 0 ? { items, truncated: true } : null;
}

/**
 * Recovers an array stored under a named key of an otherwise-truncated JSON
 * object (`{"statements": [...]` cut off before the closing brace). Returns
 * null when the key is absent or holds no complete element.
 */
function extractJsonArrayAtKey(raw, key) {
    if (typeof key !== 'string' || !key.trim()) return null;
    const pattern = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:`);
    for (const candidate of textCandidates(raw)) {
        const text = stripCodeFences(candidate);
        const match = pattern.exec(text);
        if (!match) continue;
        const arrayStart = text.indexOf('[', match.index + match[0].length);
        if (arrayStart === -1) continue;
        const salvaged = salvageArray(text.slice(arrayStart));
        if (salvaged) return salvaged;
    }
    return null;
}

module.exports = {
    extractJsonBlock,
    extractJsonArray,
    extractJsonArrayAtKey,
    stripCodeFences,
    modelContentToText,
};
