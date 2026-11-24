'use strict';

const {
    FILING_NUMBER_PATTERN,
    canonicalCurrency,
    canonicalDate,
    canonicalFilingNumber,
    extractFilingNumbers,
    foldCroatian,
    parseAmountNumber,
} = require('./canonicalize');

// Scanning and canonicalizing are different jobs: this module finds candidate
// facts in free text, `canonicalize.js` decides what the fact *is*. Both the
// gold lane and the parser lane go through the same canonical form, so a printed
// date can never score in one table and vanish in the other.
const normalizeNumberToken = parseAmountNumber;

function normalizeCurrency(raw) {
    const value = canonicalCurrency(raw);
    return value === 'EUR' || value === 'HRK' ? value : '';
}

function unique(values) { return [...new Set(values)]; }

function extractAmounts(text) {
    let input = String(text || '');
    input = input.replace(/\b\d{11}\b/g, ' ')
        .replace(/\b\d{1,2}\.\d{1,2}\.\d{4}\.?(?:\s*\d{1,2}:\d{2})?/g, ' ')
        .replace(FILING_NUMBER_PATTERN, ' ');
    const found = [];
    const re = /(?<!\d)(\d{1,3}(?:[.,\s]\d{3})+(?:[,.]\d{2})?|\d+(?:[,.]\d{2})?)(?!\d)\s*(EUR|HRK|kn\.?|€)?/giu;
    for (const match of input.matchAll(re)) {
        const value = normalizeNumberToken(match[1]);
        if (value !== null) found.push({ value, currency: normalizeCurrency(match[2]) });
    }
    return unique(found.map(({ value, currency }) => `${value}|${currency}`));
}

function setMetrics(reference, candidate) {
    const expected = new Set(reference);
    const actual = new Set(candidate);
    const tp = [...actual].filter((value) => expected.has(value)).length;
    return {
        precision: actual.size ? tp / actual.size : expected.size === 0 ? 1 : 0,
        recall: expected.size ? tp / expected.size : actual.size === 0 ? 1 : 0,
        counts: { truePositive: tp, predicted: actual.size, reference: expected.size },
    };
}

function scoreSet(referenceText, candidateText, extractor) {
    if (!String(referenceText || '').trim()) {
        return { precision: null, recall: null, counts: { truePositive: 0, predicted: extractor(candidateText).length, reference: null } };
    }
    return setMetrics(extractor(referenceText), extractor(candidateText));
}

function extractOibs(text) { return unique(String(text || '').match(/\b\d{11}\b/g) || []); }
function extractDates(text) {
    const pattern = /\b(?:\d{4}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\b|\d{1,2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{4}\.?(?!\d)|\d{1,2}\.?\s*(?:siječnja|veljače|ožujka|travnja|svibnja|lipnja|srpnja|kolovoza|rujna|listopada|studenoga|prosinca)\.?\s*\d{4}\.?(?:\s*g\.?)?)/giu;
    return unique(String(text || '').match(pattern) || []);
}

// Croatian registers print a `poslovni broj` with inconsistent typography:
// `St – 2/2013` in a PDF copy, `St-2/2013` in a model's answer. The pattern and
// the canonical form live in `canonicalize.js` so gold scoring and parser
// fidelity cannot drift apart. This module only runs that extractor.
function mojibakeScore(text) {
    return (String(text || '').match(/(?:Ã.|Ä.|Å.|\uFFFD|\u00C3\u00A8)/g) || []).length;
}
function diacriticFidelity(reference, candidate) {
    const raw = String(candidate || '');
    const chars = ['č', 'ć', 'đ', 'š', 'ž', 'Č', 'Ć', 'Đ', 'Š', 'Ž'];
    const referenceCount = chars.reduce((sum, ch) => sum + (String(reference || '').split(ch).length - 1), 0);
    const actual = chars.reduce((sum, ch) => sum + (raw.split(ch).length - 1), 0);
    return {
        preserved: referenceCount === 0 ? null : Math.min(actual, referenceCount) / referenceCount,
        referenceCharacters: referenceCount,
        candidateCharacters: actual,
        asciiFolded: referenceCount > 0 && foldCroatian(raw) === raw,
        mojibakeCount: mojibakeScore(raw),
    };
}
function pageCompleteness(text, expectedPages) {
    const markers = [...String(text || '').matchAll(/^===\s*STRANICA\s+(\d+)\s*===/gim)].map((match) => Number(match[1]));
    const count = Number(expectedPages) || 0;
    return { complete: count > 0 && markers.length === count && markers.every((page, i) => page === i + 1), expected: count, marked: markers.length, markers };
}
function jsonValidity(text) {
    const raw = String(text || '').trim();
    const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let valid = false;
    try { JSON.parse(stripped); valid = true; } catch { /* invalid */ }
    const errorText = (() => { try { JSON.parse(stripped); return ''; } catch (error) { return error.message; } })();
    return { valid, truncated: /(?:unexpected end|unterminated|end of json input)/i.test(errorText) };
}

function scoreJsonConditions(text, { structuredMode = false } = {}) {
    const rawText = String(text || '');
    let rawParsed = false;
    try { JSON.parse(rawText); rawParsed = true; } catch { /* measure strict raw adherence */ }
    const started = require('node:perf_hooks').performance.now();
    let repaired = false;
    if (!rawParsed) {
        const candidate = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try {
            JSON.parse(candidate);
            repaired = candidate !== rawText;
        } catch { /* no JSON repair beyond trimming and fence removal */ }
    }
    const repairOverheadMs = rawParsed ? 0 : require('node:perf_hooks').performance.now() - started;
    return {
        raw_parse: rawParsed,
        structured_mode: Boolean(structuredMode && rawParsed),
        repaired: Boolean(!rawParsed && repaired),
        rawFailed: !rawParsed,
        repairOverheadMs,
        repairOverheadCost: 0,
    };
}

function scoreJsonRequestConditions(requests, { structuredMode = false } = {}) {
    const scored = requests.map((request) => scoreJsonConditions(request.rawText, { structuredMode }));
    const successful = requests.every((request) => request.status === 'completed' || request.checkpoint === 'hit');
    const rawParse = scored.every((score) => score.raw_parse);
    const repaired = !rawParse && successful && scored.every((score) => score.raw_parse || score.repaired);
    return {
        raw_parse: rawParse,
        structured_mode: Boolean(structuredMode && rawParse),
        repaired,
        rawFailed: !rawParse,
        repairOverheadMs: scored.reduce((sum, score) => sum + score.repairOverheadMs, 0),
        repairOverheadCost: 0,
    };
}

// A parser can "succeed" while returning nothing a model could read. Cloudflare
// Workers AI does exactly that on some scans: a `<file>` envelope, a metadata
// dump, an empty `## Contents` — 883 characters that contain no document text.
// A character threshold cannot separate that from a terse invoice, so the
// scaffolding is removed structurally instead: parser envelope, metadata
// section, heading-only lines, page markers. What remains is either content or
// nothing.
const PARSER_ENVELOPE = /<file\b[^>]*>|<\/file>/gi;
function stripParserScaffolding(text) {
    const lines = String(text || '').replace(PARSER_ENVELOPE, '').split('\n');
    const kept = [];
    let inMetadata = false;
    for (const line of lines) {
        if (/^\s*===\s*STRANICA\s+\d+\s*===\s*$/i.test(line)) continue;
        const heading = /^\s*(#{1,6})\s*(.*)$/.exec(line);
        if (heading) {
            // Headings name structure; the metadata block under `## Metadata`
            // describes the file, not what the file says.
            inMetadata = /^metadata$/i.test(heading[2].trim());
            continue;
        }
        if (inMetadata) continue;
        kept.push(line);
    }
    return kept.join('\n');
}
function effectiveContentChars(text) {
    return (stripParserScaffolding(text).match(/[\p{L}\p{N}]/gu) || []).length;
}
function isEffectivelyEmpty(text) { return effectiveContentChars(text) === 0; }
function computeTextMetrics(reference, candidate, expectedPages) {
    return {
        amounts: scoreSet(reference, candidate, extractAmounts),
        oibs: scoreSet(reference, candidate, extractOibs),
        dates: scoreSet(reference, candidate, (text) => unique(extractDates(text).map(canonicalDate).filter(Boolean))),
        filingNumbers: scoreSet(reference, candidate, extractFilingNumbers),
        diacritics: diacriticFidelity(reference, candidate),
        pageCompleteness: expectedPages ? pageCompleteness(candidate, expectedPages) : null,
    };
}

function scoreGold(gold, extraction) {
    const outcomes = {};
    for (const kind of ['amounts', 'oibs', 'dates', 'filingNumbers']) {
        const expected = gold?.[kind] || [];
        const actual = extraction?.[kind] || [];
        const stringify = (item) => typeof item === 'string' ? item : JSON.stringify(item);
        outcomes[kind] = setMetrics(expected.map(stringify), actual.map(stringify));
    }
    return outcomes;
}

function summarizeTextMetrics(rows) {
    const groups = new Map();
    const fields = ['amounts', 'oibs', 'dates', 'filingNumbers'];
    for (const row of rows) {
        if (!row.metrics) continue;
        const key = `${row.arm}|${row.model || 'model-independent'}|${row.documentType}`;
        if (!groups.has(key)) groups.set(key, {
            arm: row.arm, model: row.model || null, documentType: row.documentType,
            N: 0, emptyOutputs: 0, emptyRawOutputs: 0, fields: Object.fromEntries(fields.map((name) => [name, { truePositive: 0, predicted: 0, reference: 0, N: 0 }])),
            pageComplete: 0, pageEvaluated: 0, pageExpected: 0, pageMarked: 0, diacriticScores: [], mojibakeCount: 0,
        });
        const group = groups.get(key);
        group.N += 1;
        if (row.empty) group.emptyOutputs += 1;
        if (row.emptyRaw) group.emptyRawOutputs += 1;
        for (const name of fields) {
            const counts = row.metrics[name]?.counts;
            if (counts?.reference == null) continue;
            const metric = group.fields[name];
            metric.N += 1;
            metric.truePositive += counts.truePositive;
            metric.predicted += counts.predicted;
            metric.reference += counts.reference;
        }
        const pages = row.metrics.pageCompleteness;
        if (pages?.expected) {
            group.pageEvaluated += 1;
            group.pageExpected += pages.expected;
            group.pageMarked += pages.marked;
            group.pageComplete += pages.complete ? 1 : 0;
        }
        if (row.metrics.diacritics?.preserved != null) group.diacriticScores.push(row.metrics.diacritics.preserved);
        group.mojibakeCount += row.metrics.diacritics?.mojibakeCount || 0;
    }
    return [...groups.values()].map((group) => {
        const fieldsOut = Object.fromEntries(Object.entries(group.fields).map(([name, metric]) => [name, {
            ...metric,
            precision: !metric.N ? null : metric.predicted ? metric.truePositive / metric.predicted : metric.reference === 0 ? 1 : 0,
            recall: metric.reference ? metric.truePositive / metric.reference : metric.N ? 1 : null,
        }]));
        return {
            arm: group.arm, model: group.model, documentType: group.documentType,
            N: group.N, emptyOutputs: group.emptyOutputs, emptyRawOutputs: group.emptyRawOutputs,
            fields: fieldsOut,
            pageCompleteness: { completeDocuments: group.pageComplete, evaluatedDocuments: group.pageEvaluated, expectedPages: group.pageExpected, markedPages: group.pageMarked },
            diacriticFidelity: group.diacriticScores.length ? group.diacriticScores.reduce((a, b) => a + b, 0) / group.diacriticScores.length : null,
            mojibakeCount: group.mojibakeCount,
        };
    });
}

module.exports = {
    normalizeNumberToken, normalizeCurrency, extractAmounts, extractOibs, extractDates,
    extractFilingNumbers, canonicalFilingNumber, foldCroatian, mojibakeScore, diacriticFidelity,
    pageCompleteness, jsonValidity, scoreJsonConditions, scoreJsonRequestConditions, computeTextMetrics, scoreGold, setMetrics, summarizeTextMetrics,
    stripParserScaffolding, effectiveContentChars, isEffectivelyEmpty,
};
