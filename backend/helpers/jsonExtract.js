// Recovery parser for LLM JSON responses.
//
// Models occasionally wrap otherwise-valid JSON in prose ("Here is the
// requested JSON:") or leave fence markers in place. A strict JSON.parse then
// throws away an already-paid-for completion and — for synthesis/verification
// — the whole run. Extraction order: raw text -> fence-stripped -> first
// balanced {...} -> first balanced [...]. The balanced scan is string-aware so
// brackets inside string literals cannot desynchronize it. Returns the parsed
// value, or null when nothing parseable exists (callers decide how to fail).

function stripCodeFences(text) {
    return String(text || "")
        .replace(/```(?:json|JSON)?\s*/g, "")
        .replace(/```/g, "")
        .trim();
}

function findBalanced(text, open, close) {
    const start = text.indexOf(open);
    if (start === -1) return null;
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
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

function extractJsonBlock(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;

    for (const candidate of [raw.trim(), stripCodeFences(raw)]) {
        try {
            return JSON.parse(candidate);
        } catch (_) { /* fall through to block extraction */ }
    }

    const stripped = stripCodeFences(raw);
    for (const [open, close] of [["{", "}"], ["[", "]"]]) {
        const block = findBalanced(stripped, open, close);
        if (!block) continue;
        try {
            return JSON.parse(block);
        } catch (_) { /* keep scanning */ }
    }
    return null;
}

module.exports = { extractJsonBlock, stripCodeFences };
