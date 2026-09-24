// backend/court-analysis/reasoning/analysisLab/traceBounds.js
//
// LQ-2 — trace-size, redaction, and failure-mode guards (spec §9).
//
// Persisted experiment records stay complete for audit. This module bounds
// what travels over the API so a pathological trace (hundreds of nodes,
// pasted prompts, stack traces) cannot blow up a response payload: arrays
// are capped, long text fields are cut with an explicit reason, and carrier
// keys for stacks are dropped. Every cut sets
// `trace.responseBounds = { truncated: true, reasons: [...] }` so the UI
// can say what was hidden instead of silently hiding it.
//
// Secrets are a second net here (the store already strips credential-bearing
// keys on write): `boundExperimentForResponse` never reintroduces them.

const TRACE_BOUNDS = {
    maxSelectedNodes: 100,
    maxOmittedEntries: 100,
    maxSummaryOutcomes: 100,
    maxDroppedDerived: 50,
    maxDagSelections: 100,
    maxDagLinks: 200,
    maxIdsPerNode: 50,
    maxReasonChars: 300,
    maxErrorChars: 500,
};

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepClone(value) {
    if (value === null || value === undefined) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
}

function cutText(value, maxChars) {
    if (typeof value !== 'string') return { text: value, cut: false };
    if (value.length <= maxChars) return { text: value, cut: false };
    return { text: `${value.slice(0, maxChars).trimEnd()}…`, cut: true };
}

function capArray(list, max, label, reasons) {
    if (!Array.isArray(list)) return list;
    if (list.length <= max) return list;
    reasons.push(`${label}: kept ${max} of ${list.length}`);
    return list.slice(0, max);
}

function boundIdList(ids, reasons, nodeId) {
    if (!Array.isArray(ids)) return ids;
    if (ids.length <= TRACE_BOUNDS.maxIdsPerNode) return ids;
    reasons.push(`node ${nodeId || '?'}: kept ${TRACE_BOUNDS.maxIdsPerNode} of ${ids.length} ids`);
    return ids.slice(0, TRACE_BOUNDS.maxIdsPerNode);
}

function boundTextFields(entry, fields, reasons, label) {
    if (!isObject(entry)) return entry;
    const out = { ...entry };
    for (const field of fields) {
        if (typeof out[field] !== 'string') continue;
        const max = field === 'errorMessage' || field === 'error' ? TRACE_BOUNDS.maxErrorChars : TRACE_BOUNDS.maxReasonChars;
        const { text, cut } = cutText(out[field], max);
        out[field] = text;
        if (cut) reasons.push(`${label}: ${field} truncated to ${max} chars`);
    }
    return out;
}

/**
 * Bounds one variant trace for API responses. Pure: never mutates the input.
 * @returns {{ trace, truncated: boolean, reasons: Array<string> }}
 */
function boundTrace(trace) {
    if (!isObject(trace)) return { trace, truncated: false, reasons: [] };
    const reasons = [];
    const out = { ...trace };

    if (isObject(out.selection)) {
        const selection = { ...out.selection };
        if (Array.isArray(selection.selected)) {
            const capped = capArray(selection.selected, TRACE_BOUNDS.maxSelectedNodes, 'selected nodes', reasons);
            selection.selected = capped.map((node) => {
                if (!isObject(node)) return node;
                const bounded = { ...node };
                for (const key of ['factIds', 'sourceDocumentIds', 'citationIds']) {
                    bounded[key] = boundIdList(bounded[key], reasons, bounded.nodeId);
                }
                return bounded;
            });
        }
        if (Array.isArray(selection.omitted)) {
            selection.omitted = capArray(selection.omitted, TRACE_BOUNDS.maxOmittedEntries, 'omitted selection entries', reasons)
                .map((entry) => boundTextFields(entry, ['reason', 'detail'], reasons, 'omitted selection entry'));
        }
        out.selection = selection;
    }

    if (isObject(out.summaries)) {
        const summaries = { ...out.summaries };
        if (Array.isArray(summaries.outcomes)) {
            summaries.outcomes = capArray(summaries.outcomes, TRACE_BOUNDS.maxSummaryOutcomes, 'summary outcomes', reasons)
                .map((outcome) => boundTextFields(outcome, ['reason', 'detail', 'gap'], reasons, 'summary outcome'));
        }
        if (Array.isArray(summaries.omitted)) {
            summaries.omitted = capArray(summaries.omitted, TRACE_BOUNDS.maxOmittedEntries, 'omitted summary entries', reasons)
                .map((entry) => boundTextFields(entry, ['reason', 'detail'], reasons, 'omitted summary entry'));
        }
        if (Array.isArray(summaries.droppedDerived)) {
            summaries.droppedDerived = capArray(summaries.droppedDerived, TRACE_BOUNDS.maxDroppedDerived, 'dropped derived statements', reasons)
                .map((entry) => boundTextFields(entry, ['reason', 'detail'], reasons, 'dropped derived statement'));
        }
        out.summaries = summaries;
    }

    if (isObject(out.dag)) {
        const dag = { ...out.dag };
        if (Array.isArray(dag.selections)) {
            dag.selections = capArray(dag.selections, TRACE_BOUNDS.maxDagSelections, 'DAG selections', reasons)
                .map((entry) => boundTextFields(entry, ['reason', 'detail'], reasons, 'DAG selection'));
        }
        if (Array.isArray(dag.links)) {
            dag.links = capArray(dag.links, TRACE_BOUNDS.maxDagLinks, 'DAG links', reasons);
        }
        out.dag = dag;
    }

    out.responseBounds = { truncated: reasons.length > 0, reasons };
    return { trace: out, truncated: reasons.length > 0, reasons };
}

/**
 * Bounds a full experiment record for API responses: per-variant traces are
 * capped (reports, scorecards, and snapshots travel intact), failure text is
 * capped, and stack-trace carriers are dropped so partial/error records stay
 * inspectable without provider internals.
 */
function boundExperimentForResponse(experiment) {
    if (!isObject(experiment)) return experiment;
    const out = deepClone(experiment);
    const variants = isObject(out.variants) ? out.variants : {};
    for (const profileId of Object.keys(variants)) {
        const variant = variants[profileId];
        if (!isObject(variant)) continue;
        if (isObject(variant.trace)) {
            variant.trace = boundTrace(variant.trace).trace;
        }
        if (typeof variant.errorMessage === 'string' && variant.errorMessage.length > TRACE_BOUNDS.maxErrorChars) {
            variant.errorMessage = cutText(variant.errorMessage, TRACE_BOUNDS.maxErrorChars).text;
        }
        delete variant.stack;
        delete variant.stackTrace;
    }
    return out;
}

module.exports = {
    TRACE_BOUNDS,
    boundTrace,
    boundExperimentForResponse,
};
