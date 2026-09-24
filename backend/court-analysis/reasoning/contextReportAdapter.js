// backend/court-analysis/reasoning/contextReportAdapter.js
//
// LC-3 — profile-aware report-input adapter (spec §5.1).
//
// Sits immediately before synthesis-input assembly. `baseline-flat-v1`
// calls the current flat `buildSynthesisInput` path unchanged (deleting or
// bypassing this adapter restores the baseline with no package migration,
// persisted-run change, or frontend breakage). Both context profiles build
// the same deterministic DAG via `buildCaseContext`; only
// `context-tree-summarized-v1` makes bounded node-summary calls.
//
// The report writer receives original claims/citations first, then branch
// claims grounded in member-fact quotes, then node-summary derivatives whose
// source references are trace metadata only (`supportsFinding: false`). A
// summary statement that cannot be anchored to an original source never
// becomes a claim. Deterministic
// flow/currency/identity and scope results stay owned by their current
// modules (they ride along in the flat meta, untouched).
//
// The adapter never mutates the supplied evidence package.

const { buildSynthesisInput, appendContextClaims } = require('./synthesisInputBuilder');
const { buildCaseContext, collectContextFacts } = require('./caseContextBuilder');
const { getProfile } = require('./analysisLab/profiles');
const { summarizeContextNodes } = require('./analysisLab/contextNodeSummary');
const { CONTEXT_NODE_PROMPT_VERSION } = require('../../helpers/geminiConfig');

const BRANCH_CLAIM_TEXT_MAX_CHARS = 1200;
const TRACE_TEXT_MAX_CHARS = 600;
const TRACE_EVIDENCE_PER_CLAIM_MAX = 4;
const TRACE_CLAIM_MAX = 48;
const TRACE_FACTS_PER_NODE_MAX = 16;

function truncateText(text, maxChars) {
    const flat = String(text || '');
    if (flat.length <= maxChars) return flat;
    return `${flat.slice(0, maxChars).trimEnd()}…`;
}

function buildClaimFragments(claims) {
    const sourceClaims = Array.isArray(claims) ? claims : [];
    const selected = sourceClaims.slice(0, TRACE_CLAIM_MAX);
    return {
        claims: selected.map((claim) => ({
            claimId: String(claim?.id || ''),
            text: truncateText(claim?.text, TRACE_TEXT_MAX_CHARS),
            confidence: claim?.confidence || null,
            evidence: (Array.isArray(claim?.evidence) ? claim.evidence : [])
                .slice(0, TRACE_EVIDENCE_PER_CLAIM_MAX)
                .map((entry) => ({
                    sourceId: entry?.sourceId || null,
                    fileName: entry?.metadata?.fileName || null,
                    citationIds: Array.isArray(entry?.metadata?.citationIds)
                        ? entry.metadata.citationIds.slice(0, 8)
                        : [],
                    factId: entry?.metadata?.factId || null,
                    grounded: typeof entry?.metadata?.grounded === 'boolean'
                        ? entry.metadata.grounded
                        : null,
                    text: truncateText(entry?.text, TRACE_TEXT_MAX_CHARS),
                })),
        })),
        omittedCount: Math.max(0, sourceClaims.length - selected.length),
    };
}

function buildContextNodeFragments(nodes, factsById) {
    return (Array.isArray(nodes) ? nodes : []).map((node) => {
        const factIds = Array.isArray(node?.factIds) ? node.factIds : [];
        const facts = factIds.slice(0, TRACE_FACTS_PER_NODE_MAX).map((factId) => {
            const fact = factsById.get(factId);
            return {
                factId,
                sourceId: fact?.analysisId || null,
                fileName: fact?.fileName || null,
                citationIds: Array.isArray(fact?.citedFilingReferences)
                    ? fact.citedFilingReferences.slice(0, 8)
                    : [],
                description: truncateText(fact?.description || '', TRACE_TEXT_MAX_CHARS),
                excerpt: truncateText(fact?.quote || fact?.description || '', TRACE_TEXT_MAX_CHARS),
                date: fact?.date || null,
                grounded: fact?.grounded === true,
            };
        });
        return {
            nodeId: node.id,
            title: truncateText(node.title, TRACE_TEXT_MAX_CHARS),
            kind: node.kind,
            status: node.status,
            sourceDocumentIds: (node.sourceDocumentIds || []).slice(0, 32),
            factIds: factIds.slice(0, 64),
            citationIds: (node.citationIds || []).slice(0, 32),
            coverage: node.coverage || null,
            summary: (Array.isArray(node.summary) ? node.summary : []).slice(0, 12).map((statement) => ({
                text: truncateText(statement?.text, TRACE_TEXT_MAX_CHARS),
                sourceDocumentIds: (statement?.sourceDocumentIds || []).slice(0, 16),
                factIds: (statement?.factIds || []).slice(0, 16),
                citationIds: (statement?.citationIds || []).slice(0, 16),
                grounded: false,
            })),
            facts,
            omittedFactCount: Math.max(0, factIds.length - facts.length),
        };
    });
}

function indexAnalyses(evidencePackage) {
    const byId = new Map();
    for (const analysis of Array.isArray(evidencePackage?.analyses) ? evidencePackage.analyses : []) {
        if (analysis && analysis.id) byId.set(analysis.id, analysis);
    }
    return byId;
}

function indexFactsById(facts) {
    const byId = new Map();
    for (const fact of Array.isArray(facts) ? facts : []) {
        if (fact && fact.factId && !byId.has(fact.factId)) byId.set(fact.factId, fact);
    }
    return byId;
}

/**
 * Maps filing references to owning analysis ids so derived evidence can
 * always be anchored to an original source (analyses carry the filing
 * reference on their amount/property items).
 */
function indexFilings(facts) {
    const byFiling = new Map();
    for (const fact of Array.isArray(facts) ? facts : []) {
        if (!fact?.filingReference || !fact?.analysisId) continue;
        const key = fact.filingReference.trim().toLowerCase();
        if (!byFiling.has(key)) byFiling.set(key, []);
        if (!byFiling.get(key).includes(fact.analysisId)) byFiling.get(key).push(fact.analysisId);
    }
    return byFiling;
}

function rankForSelection(node) {
    if (node.kind === 'claim-thread' || node.kind === 'property-thread') return 0;
    if (node.kind === 'unresolved') return 1;
    return 2;
}

/**
 * Selects DAG nodes for report input in deterministic rank, then id order:
 * lifecycle threads first, unresolved branches second (honesty), period
 * buckets last. The case root is always in scope implicitly — its evidence
 * is the flat claim list. Selection is capped by the profile's
 * `maxContextNodes` budget with recorded omission reasons.
 */
function selectContextNodes(nodes, maxContextNodes) {
    const candidates = (Array.isArray(nodes) ? nodes : [])
        .filter((node) => node && node.kind !== 'case-root')
        .sort((a, b) => {
            const rank = rankForSelection(a) - rankForSelection(b);
            if (rank !== 0) return rank;
            return a.id < b.id ? -1 : 1;
        });
    const cap = Math.max(0, Number.isInteger(maxContextNodes) ? maxContextNodes : candidates.length);
    return {
        selected: candidates.slice(0, cap),
        omitted: candidates.slice(cap).map((node) => ({
            nodeId: node.id,
            reason: 'context-node-budget-exhausted',
            detail: `Profile node budget (${cap}) reached; branch excluded from report input.`,
        })),
    };
}

/**
 * One branch claim per selected node, grounded in member-fact quotes with
 * original analysis ids as evidence — citable by report findings.
 */
function buildBranchClaim(node, factsById, index) {
    const evidence = [];
    const lines = [];
    for (const factId of node.factIds || []) {
        const fact = factsById.get(factId);
        if (!fact) continue;
        lines.push(`- ${fact.description || factId}${fact.date ? ` (${fact.date})` : ''}${fact.grounded ? '' : ' [nepotvrđeno]'}`);
        evidence.push({
            sourceId: fact.analysisId,
            text: fact.quote || fact.description || '',
            metadata: {
                sourceType: 'context-node',
                nodeId: node.id,
                factId,
                fileName: fact.fileName || null,
                date: fact.date || null,
                grounded: fact.grounded === true,
            },
        });
    }
    return {
        id: `context-node-${index + 1}`,
        text: truncateText(
            `Kontekstna grana "${node.title}" (${node.kind}):\n${lines.join('\n')}`,
            BRANCH_CLAIM_TEXT_MAX_CHARS
        ),
        confidence: 'medium',
        evidence,
        metadata: { nodeId: node.id, derived: false },
    };
}

/**
 * One derived claim per validated summary statement. Source references are
 * retained as trace metadata only; statements with no resolvable original
 * anchor are dropped and reported. Derived text never carries citable evidence.
 */
function buildDerivedClaims(node, factsById, analysesById, filingsIndex, startIndex, dropped) {
    const claims = [];
    const statements = Array.isArray(node?.summary) ? node.summary : [];
    statements.forEach((statement, statementIndex) => {
        const sourceReferences = [];
        const rememberSource = (sourceId) => {
            if (sourceId && !sourceReferences.includes(sourceId)) sourceReferences.push(sourceId);
        };
        for (const analysisId of statement.sourceDocumentIds || []) {
            const analysis = analysesById.get(analysisId);
            if (analysis) rememberSource(analysisId);
        }
        for (const factId of statement.factIds || []) {
            const fact = factsById.get(factId);
            if (fact) rememberSource(fact.analysisId);
        }
        for (const citationId of statement.citationIds || []) {
            const owners = filingsIndex.get(String(citationId).trim().toLowerCase()) || [];
            for (const ownerId of owners) {
                if (analysesById.has(ownerId)) rememberSource(ownerId);
            }
        }
        if (sourceReferences.length === 0) {
            dropped.push({
                nodeId: node.id,
                statementIndex,
                reason: 'unresolvable-citation',
                detail: 'Summary statement cites no original package source; dropped, never promoted to a claim.',
            });
            return;
        }
        claims.push({
            id: `context-node-summary-${startIndex + claims.length + 1}`,
            text: `${statement.text} [izvedeni sažetak čvora — potpora samo uz citirani izvorni dokaz]`,
            confidence: 'low',
            // These IDs are retained for traceability only. Attaching them as
            // claim evidence lets downstream citation selection turn the
            // model's paraphrase into a source-backed finding.
            evidence: [],
            metadata: {
                nodeId: node.id,
                derived: true,
                supportsFinding: false,
                sourceReferences,
                statementIndex,
                promptVersion: CONTEXT_NODE_PROMPT_VERSION,
            },
        });
    });
    return claims;
}

/**
 * Builds the profile-specific synthesis input. The flat profile delegates
 * to `buildSynthesisInput` unchanged; context profiles layer branch +
 * derived claims on top of that same flat input.
 *
 * @param {object} args - `{ evidencePackage, retrieval, rerankedRetrieval,
 *   profileId, summarizeLlm, tracker, onUsage, summaryTimeoutMs }`.
 * @returns {Promise<{ input, trace }>} Synthesis input + bounded trace.
 */
async function buildProfileReportInput({
    evidencePackage,
    retrieval = null,
    rerankedRetrieval = null,
    profileId = 'baseline-flat-v1',
    summarizeLlm = null,
    tracker = null,
    onUsage = null,
    summaryTimeoutMs,
} = {}) {
    const profile = getProfile(profileId);
    const flat = buildSynthesisInput(evidencePackage, retrieval, rerankedRetrieval ?? retrieval);

    if (profile.contextStrategy !== 'case-context') {
        return {
            input: flat,
            trace: {
                profileId,
                strategy: profile.contextStrategy,
                baseline: true,
                rootId: null,
                claims: { flat: flat.claims.length, branch: 0, derived: 0 },
                fragments: {
                    flatClaims: buildClaimFragments(flat.claims),
                    contextNodes: [],
                },
                truncated: false,
            },
        };
    }

    const { rootId, nodes, trace: dagTrace } = buildCaseContext(evidencePackage);
    const facts = collectContextFacts(evidencePackage);
    const factsById = indexFactsById(facts);
    const analysesById = indexAnalyses(evidencePackage);
    const filingsIndex = indexFilings(facts);

    const { selected, omitted: selectionOmitted } = selectContextNodes(nodes, profile.budgets?.maxContextNodes);

    let summarizedNodes = selected;
    let summaryOutcomes = [];
    let summaryOmitted = [];
    let summaryStats = { eligible: 0, attempted: 0, completed: 0, partial: 0, calls: 0 };
    if (profile.nodeSummaries === 'on') {
        const summarized = await summarizeContextNodes(selected, facts, {
            maxNodeCalls: profile.budgets?.maxNodeCalls ?? 0,
            summarizeLlm,
            tracker,
            onUsage,
            ...(summaryTimeoutMs !== undefined ? { timeoutMs: summaryTimeoutMs } : {}),
        });
        summarizedNodes = summarized.nodes;
        summaryOutcomes = summarized.outcomes;
        summaryOmitted = summarized.omitted;
        summaryStats = summarized.stats;
    }

    const branchClaims = summarizedNodes.map((node, index) => buildBranchClaim(node, factsById, index));
    const droppedDerived = [];
    const derivedClaims = [];
    for (const node of summarizedNodes) {
        derivedClaims.push(...buildDerivedClaims(node, factsById, analysesById, filingsIndex, derivedClaims.length, droppedDerived));
    }

    const input = {
        ...flat,
        claims: appendContextClaims(flat.claims, [...branchClaims, ...derivedClaims]),
        meta: {
            ...flat.meta,
            context: {
                profileId,
                strategy: profile.contextStrategy,
                rootId,
                nodeSummaries: profile.nodeSummaries,
                promptVersion: CONTEXT_NODE_PROMPT_VERSION,
                selectedNodeIds: summarizedNodes.map((node) => node.id),
                branchClaimIds: branchClaims.map((claim) => claim.id),
                derivedClaimIds: derivedClaims.map((claim) => claim.id),
                summaryOutcomes: summaryOutcomes.map((outcome) => ({
                    nodeId: outcome.nodeId,
                    status: outcome.status,
                    accepted: outcome.accepted,
                    rejected: outcome.rejected,
                })),
            },
        },
    };

    const summariesEnabled = profile.nodeSummaries === 'on';
    return {
        input,
        trace: {
            profileId,
            strategy: profile.contextStrategy,
            baseline: false,
            rootId,
            dag: dagTrace,
            selection: {
                selected: summarizedNodes.map((node) => ({
                    nodeId: node.id,
                    kind: node.kind,
                    status: node.status,
                    factIds: node.factIds,
                })),
                omitted: selectionOmitted,
            },
            fragments: {
                flatClaims: buildClaimFragments(flat.claims),
                contextNodes: buildContextNodeFragments(summarizedNodes, factsById),
            },
            summaries: {
                enabled: summariesEnabled,
                stats: summaryStats,
                outcomes: summaryOutcomes,
                omitted: summaryOmitted,
                droppedDerived,
            },
            claims: { flat: flat.claims.length, branch: branchClaims.length, derived: derivedClaims.length },
            truncated: false,
        },
    };
}

module.exports = {
    buildProfileReportInput,
    selectContextNodes,
    buildBranchClaim,
    buildDerivedClaims,
    buildClaimFragments,
    buildContextNodeFragments,
};
