// backend/court-analysis/reasoning/analysisLab/contextNodeSummary.js
//
// LC-2 — bounded ContextNode summary service with citation validation.
//
// Builds a compact, bounded source packet for one eligible ContextNode,
// invokes the dedicated `contextNode` summary role, and validates every
// returned statement's ids against the node's own evidence. Validated ids
// are retained as references — but id membership is NOT a grounding proof:
// summaries are derived context only (`grounded: false`,
// `supportsFinding: false`) and can never independently support a report
// finding; findings must cite original evidence (see
// `findingCitesOriginalEvidence`).
//
// Failure contract: summary failure, timeout, malformed output, or an
// invalid citation produces `status: 'partial'` plus trace/gap metadata and
// retains the raw node — never fails the experiment, never invents a
// summary. There is no model-directed child discovery or recursion: the
// caller selects nodes, the model only summarizes the packet it is given.

const { extractJsonBlock } = require('../../../helpers/jsonExtract');
const {
    createGeminiClient,
    outputCapWarning,
    CONTEXT_NODE_PROMPT_VERSION,
} = require('../../../helpers/geminiConfig');
const { withGeminiRetry, withGeminiTimeout } = require('../../../helpers/geminiRetry');
const { trackGeminiInvoke } = require('../../../helpers/geminiUsage');
const agentLog = require('../../../helpers/agentLog');
const { collectContextFacts } = require('../caseContextBuilder');

// Only lifecycle branches are summarizable in v1: the case root is too
// broad, periods duplicate chronology the flat path already carries, and
// unresolved nodes have no stable thread to state.
const SUMMARY_ELIGIBLE_KINDS = ['claim-thread', 'property-thread'];

const NODE_SUMMARY_MAX_PACKET_CHARS = 6000;
const NODE_SUMMARY_MAX_QUOTE_CHARS = 500;
const NODE_SUMMARY_TIMEOUT_MS = 60000;

function cleanString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function truncateText(text, maxChars) {
    const flat = String(text || '');
    if (flat.length <= maxChars) return { text: flat, truncated: false };
    return { text: `${flat.slice(0, maxChars).trimEnd()}…`, truncated: true };
}

/**
 * Collects the node's known evidence ids: every statement id must be a
 * member of this set or the statement is rejected.
 */
function nodeEvidenceIds(node) {
    return new Set([
        ...(Array.isArray(node?.sourceDocumentIds) ? node.sourceDocumentIds : []),
        ...(Array.isArray(node?.factIds) ? node.factIds : []),
        ...(Array.isArray(node?.citationIds) ? node.citationIds : []),
    ]);
}

/**
 * Builds the bounded source packet for one eligible node from collected
 * context facts. Quotes are capped per fact and the whole packet is capped;
 * any truncation is recorded so the summary stays inspectable.
 *
 * @param {object} node - ContextNode to summarize.
 * @param {Array<object>} facts - Output of `collectContextFacts(pkg)`.
 * @param {object} [options] - `{ maxPacketChars }`.
 * @returns {{ nodeId, kind, title, promptVersion, facts: Array, availableIds, truncated }}
 */
function buildNodeSourcePacket(node, facts = [], maxPacketChars = NODE_SUMMARY_MAX_PACKET_CHARS) {
    const memberIds = new Set(Array.isArray(node?.factIds) ? node.factIds : []);
    const packetFacts = (Array.isArray(facts) ? facts : [])
        .filter((fact) => memberIds.has(fact?.factId))
        .map((fact) => {
            const quote = truncateText(fact.quote || fact.description || '', NODE_SUMMARY_MAX_QUOTE_CHARS);
            return {
                factId: fact.factId,
                kind: fact.kind,
                description: fact.description,
                value: fact.value ?? null,
                currency: fact.currency,
                date: fact.date,
                eventType: fact.eventType,
                claimRegistryNumber: fact.claimRegistryNumber,
                filingReference: fact.filingReference,
                transferor: fact.transferor,
                transferee: fact.transferee,
                quote: quote.text,
                quoteTruncated: quote.truncated,
                grounded: fact.grounded === true,
                fileName: fact.fileName,
                analysisId: fact.analysisId,
            };
        });

    let truncated = packetFacts.some((fact) => fact.quoteTruncated);
    let droppedFacts = 0;
    let serialized = JSON.stringify(packetFacts);
    while (serialized.length > maxPacketChars && packetFacts.length > 1) {
        packetFacts.pop();
        droppedFacts += 1;
        truncated = true;
        serialized = JSON.stringify(packetFacts);
    }

    return {
        nodeId: node?.id || null,
        kind: node?.kind || null,
        title: node?.title || null,
        promptVersion: CONTEXT_NODE_PROMPT_VERSION,
        facts: packetFacts,
        availableIds: {
            sourceDocumentIds: [...(node?.sourceDocumentIds || [])],
            factIds: [...(node?.factIds || [])],
            citationIds: [...(node?.citationIds || [])],
        },
        truncated,
        droppedFacts,
    };
}

/**
 * Builds the `contextNode` role prompt for one source packet. The model may
 * only cite ids from the packet's allow-list; anything else is discarded by
 * the validator, so the prompt states the constraint explicitly.
 */
function buildContextNodeSummaryPrompt(packet) {
    const allowed = [
        ...(packet?.availableIds?.sourceDocumentIds || []),
        ...(packet?.availableIds?.factIds || []),
        ...(packet?.availableIds?.citationIds || []),
    ];
    const facts = (packet?.facts || [])
        .map((fact, index) => (
            `[${index + 1}] factId=${fact.factId} analysisId=${fact.analysisId} ` +
            `(${fact.kind}; ${fact.date || 'bez datuma'}; ${fact.grounded ? 'potvrđeno' : 'nepotvrđeno'}): ` +
            `${fact.description || ''} ${fact.quote ? `Citat: "${fact.quote}"` : ''}`
        ))
        .join('\n');
    return (
        `SAŽETAK KONTEKSTNOG ČVORA (prompt contextNode-v${CONTEXT_NODE_PROMPT_VERSION}). ` +
        `Sažmi dokazni materijal čvora "${packet?.title || ''}" (${packet?.kind || ''}) u 1-4 kratke tvrdnje na hrvatskom. ` +
        `Svaka tvrdnja MORA navesti sourceDocumentIds/factIds/citationIds isključivo s ovog popisa dopuštenih identifikatora: ${allowed.join(', ') || '(nema)'}. ` +
        `Tvrdnja bez valjanih identifikatora bit će odbačena. Ne izmišljaj činjenice, iznose, datume ni veze izvan priloženog materijala.\n\n` +
        `Materijal:\n${facts}\n\n` +
        `Vrati ISKLJUČIVO JSON objekt oblika {"statements": [{"text": "...", "sourceDocumentIds": [...], "factIds": [...], "citationIds": [...]}]}.`
    );
}

/**
 * Parses + validates one model response against the node's evidence.
 * Accepted statements become `validated-reference` derived context
 * (`grounded: false` — membership is not grounding). Statements with any
 * unknown id are rejected; a response with no usable statements is malformed.
 *
 * @returns {{ ok, statements, accepted, rejected, reason }}
 */
function parseNodeSummaryResponse(content, node) {
    const none = (reason) => ({ ok: false, statements: [], accepted: 0, rejected: 0, reason });
    let parsed = null;
    try {
        parsed = extractJsonBlock(typeof content === 'string' ? content : '');
    } catch (err) {
        return none(`unparseable response: ${err.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return none('response is not a JSON object');
    }
    if (!Array.isArray(parsed.statements)) {
        return none('response has no statements array');
    }
    const known = nodeEvidenceIds(node);
    const statements = [];
    let rejected = 0;
    for (const raw of parsed.statements) {
        const text = cleanString(raw?.text);
        const sourceDocumentIds = Array.isArray(raw?.sourceDocumentIds)
            ? raw.sourceDocumentIds.filter((id) => typeof id === 'string') : null;
        const factIds = Array.isArray(raw?.factIds)
            ? raw.factIds.filter((id) => typeof id === 'string') : null;
        const citationIds = Array.isArray(raw?.citationIds)
            ? raw.citationIds.filter((id) => typeof id === 'string') : null;
        if (!text || !sourceDocumentIds || !factIds || !citationIds) {
            rejected += 1;
            continue;
        }
        const cited = [...sourceDocumentIds, ...factIds, ...citationIds];
        if (cited.length === 0 || cited.some((id) => !known.has(id))) {
            rejected += 1;
            continue;
        }
        statements.push({
            text,
            sourceDocumentIds,
            factIds,
            citationIds,
            status: 'validated-reference',
            grounded: false,
        });
    }
    if (statements.length === 0) {
        return { ok: false, statements: [], accepted: 0, rejected, reason: 'no statement with valid evidence references' };
    }
    return { ok: true, statements, accepted: statements.length, rejected, reason: null };
}

/**
 * Production `summarizeLlm` seam over the `contextNode` role, mirroring
 * `createClaimJudge`: lazy client (importing this module never needs an API
 * key), retry + timeout inside. Usage is recorded against `tracker`;
 * `onUsage` is intentionally left to the caller (`summarizeContextNode`
 * fires it exactly once per attempt) so budgeted lanes count calls once.
 */
function createContextNodeLlm({ tracker = null } = {}) {
    const holder = {};
    function getGemini() {
        if (!holder.cached) holder.cached = createGeminiClient('contextNode');
        return holder.cached;
    }
    return async function summarizeWithGemini({ prompt }) {
        const response = await withGeminiRetry(() => withGeminiTimeout(
            (signal) => trackGeminiInvoke(getGemini(), prompt, { signal, tracker, onUsage: null })
        ));
        if (typeof response?.content !== 'string' || !response.content.trim()) {
            agentLog.warn(outputCapWarning('contextNode'));
            throw new Error('Empty contextNode completion.');
        }
        return response.content;
    };
}

function withTimeout(promise, timeoutMs, nodeId) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Node summary timed out after ${timeoutMs}ms (node ${nodeId}).`)),
            timeoutMs
        );
        if (timer.unref) timer.unref();
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function fireUsage(onUsage, payload) {
    if (typeof onUsage !== 'function') return;
    try {
        onUsage(payload);
    } catch (err) {
        agentLog.warn(`[ContextNodeSummary] onUsage threw; ignoring (${err.message})`);
    }
}

/**
 * Summarizes one node. Never throws: every failure mode (missing seam,
 * transport error, timeout, malformed output, invalid citations) returns
 * the raw node with a `partial` outcome + gap metadata.
 *
 * @returns {Promise<{ node, outcome }>} `node` gains `summary` only on
 *   success; `outcome` is `{ nodeId, status: 'complete'|'partial', reason,
 *   accepted, rejected, calls, promptVersion }`.
 */
async function summarizeContextNode(node, facts = [], options = {}) {
    const {
        summarizeLlm = null,
        timeoutMs = NODE_SUMMARY_TIMEOUT_MS,
        maxPacketChars = NODE_SUMMARY_MAX_PACKET_CHARS,
        tracker = null,
        onUsage = null,
    } = options || {};
    const nodeId = node?.id || 'unknown-node';
    const partial = (reason, extra = {}) => ({
        node,
        outcome: {
            nodeId, status: 'partial', reason, accepted: 0, rejected: 0,
            calls: 0, promptVersion: CONTEXT_NODE_PROMPT_VERSION,
            gap: `node-summary:${reason}`,
            ...extra,
        },
    });

    if (!SUMMARY_ELIGIBLE_KINDS.includes(node?.kind)) {
        return partial('ineligible-kind');
    }
    if (typeof summarizeLlm !== 'function') {
        return partial('summaries-unavailable');
    }

    const packet = buildNodeSourcePacket(node, facts, maxPacketChars);
    if (packet.facts.length === 0) {
        return partial('empty-packet');
    }
    const prompt = buildContextNodeSummaryPrompt(packet);

    let content = null;
    let calls = 0;
    try {
        calls = 1;
        content = await withTimeout(
            summarizeLlm({ prompt, nodeId, packet }),
            timeoutMs,
            nodeId
        );
    } catch (err) {
        fireUsage(onUsage, { role: 'contextNode', nodeId, status: 'partial', reason: 'call-failed', usage: tracker?.snapshot?.() || null });
        agentLog.warn(`[ContextNodeSummary] Node ${nodeId} summary call failed; retaining raw node (${err.message})`);
        return partial('call-failed', { calls, detail: String(err?.message || err).slice(0, 300) });
    }
    fireUsage(onUsage, { role: 'contextNode', nodeId, status: 'responded', usage: tracker?.snapshot?.() || null });

    const parsed = parseNodeSummaryResponse(content, node);
    if (!parsed.ok) {
        agentLog.warn(`[ContextNodeSummary] Node ${nodeId} summary rejected (${parsed.reason}); retaining raw node`);
        return partial('invalid-summary', { calls, rejected: parsed.rejected, detail: parsed.reason });
    }
    return {
        node: {
            ...node,
            summary: parsed.statements,
            status: node.status === 'complete' ? 'complete' : node.status,
        },
        outcome: {
            nodeId, status: 'complete', reason: null,
            accepted: parsed.accepted, rejected: parsed.rejected,
            calls, promptVersion: CONTEXT_NODE_PROMPT_VERSION,
            packetTruncated: packet.truncated,
            gap: null,
        },
    };
}

/**
 * Summarizes budgeted thread nodes in deterministic (id-sorted) order.
 * Every eligible node receives exactly one outcome; nodes past
 * `maxNodeCalls` are partial with a recorded omission reason. Without a
 * `summarizeLlm` seam every eligible node is omitted as
 * `summaries-unavailable` so the candidate stays runnable offline.
 *
 * @returns {Promise<{ nodes, outcomes, omitted, stats }>} `nodes` keeps
 *   input order with summarized replacements; input node objects are never
 *   mutated (frozen DAG nodes gain `summary` via copies).
 */
async function summarizeContextNodes(nodes, facts = [], options = {}) {
    const {
        maxNodeCalls = 0,
        summarizeLlm = null,
        timeoutMs = NODE_SUMMARY_TIMEOUT_MS,
        maxPacketChars = NODE_SUMMARY_MAX_PACKET_CHARS,
        tracker = null,
        onUsage = null,
    } = options || {};

    const eligible = (Array.isArray(nodes) ? nodes : [])
        .filter((node) => SUMMARY_ELIGIBLE_KINDS.includes(node?.kind))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
    const budgeted = Math.max(0, Math.floor(maxNodeCalls));
    const attempted = eligible.slice(0, budgeted);
    const skipped = eligible.slice(budgeted);

    const byId = new Map();
    const outcomes = [];
    for (const node of attempted) {
        const result = await summarizeContextNode(node, facts, {
            summarizeLlm, timeoutMs, maxPacketChars, tracker, onUsage,
        });
        byId.set(node.id, result.node);
        outcomes.push(result.outcome);
    }

    const omitted = skipped.map((node) => ({
        nodeId: node.id,
        reason: 'node-budget-exhausted',
        detail: `Node-call budget (${budgeted}) reached; raw node retained without a summary.`,
    }));
    for (const node of skipped) {
        outcomes.push({
            nodeId: node.id,
            status: 'partial',
            reason: 'node-budget-exhausted',
            accepted: 0,
            rejected: 0,
            calls: 0,
            promptVersion: CONTEXT_NODE_PROMPT_VERSION,
            gap: 'node-summary:node-budget-exhausted',
        });
    }
    if (typeof summarizeLlm !== 'function') {
        for (const node of attempted) {
            omitted.push({
                nodeId: node.id,
                reason: 'summaries-unavailable',
                detail: 'No summary model seam supplied; raw node retained without a summary.',
            });
        }
    }

    const outputNodes = (Array.isArray(nodes) ? nodes : []).map((node) => byId.get(node?.id) || node);
    const completed = outcomes.filter((outcome) => outcome.status === 'complete').length;
    return {
        nodes: outputNodes,
        outcomes,
        omitted,
        stats: {
            eligible: eligible.length,
            attempted: attempted.length,
            completed,
            partial: outcomes.length - completed,
            calls: outcomes.reduce((sum, outcome) => sum + (outcome.calls || 0), 0),
        },
    };
}

/**
 * Boundary guard: a report finding may only rest on original evidence.
 * Returns true when at least one of the finding's citations resolves to an
 * original source id (analysis/document/chunk ids from the frozen package).
 * Derived-only citations (`context-node-summary-*` without an original
 * anchor) never satisfy this — summaries are context, not proof.
 *
 * @param {object} finding - Report finding with `citations`/`evidence`.
 * @param {Set<string>|Array<string>} originalSourceIds - Frozen-package ids.
 */
function findingCitesOriginalEvidence(finding, originalSourceIds) {
    const originals = originalSourceIds instanceof Set
        ? originalSourceIds
        : new Set(Array.isArray(originalSourceIds) ? originalSourceIds : []);
    const citations = [...(finding?.citations || []), ...(finding?.evidence || [])];
    return citations.some((citation) => {
        if (!citation || typeof citation !== 'object') return false;
        const id = citation.sourceId || citation.source || citation.id || null;
        return typeof id === 'string' && originals.has(id);
    });
}

module.exports = {
    SUMMARY_ELIGIBLE_KINDS,
    NODE_SUMMARY_MAX_PACKET_CHARS,
    NODE_SUMMARY_TIMEOUT_MS,
    collectContextFacts,
    buildNodeSourcePacket,
    buildContextNodeSummaryPrompt,
    parseNodeSummaryResponse,
    summarizeContextNode,
    summarizeContextNodes,
    findingCitesOriginalEvidence,
    createContextNodeLlm,
};
