// backend/court-analysis/reasoning/contextNode.js
//
// LC-1 — ContextNode shape factory and DAG validator (spec §5.2).
//
// A ContextNode is recomputable derived report input, never a replacement
// ledger or a new source of legal fact. Node ids are deterministic from kind
// + stable evidence identity (never from array position), so an evidence
// change alters only the affected nodes' ids.
//
// This module never calls a model; `derivedBy.strategy` is `'deterministic'`
// for every v1 node. Model-written summaries (LC-2) attach later without
// changing node identity.

const crypto = require('crypto');
const { stableStringify } = require('./analysisLab/evidenceIdentity');

const CONTEXT_NODE_KINDS = [
    'case-root',
    'procedural-period',
    'claim-thread',
    'property-thread',
    'unresolved',
];

const CONTEXT_NODE_STATUSES = ['complete', 'partial', 'unresolved'];

function slugify(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9čćžšđ]+/gi, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);
}

/**
 * Derives a deterministic node id from kind + a stable identity key.
 * The key must be built from evidence identity (registry/filing numbers,
 * dates, document ids) — never from array positions — so unrelated edits
 * leave unrelated node ids untouched.
 *
 * @param {string} kind - One of CONTEXT_NODE_KINDS.
 * @param {string} key - Stable identity material.
 * @returns {string} Node id, e.g. `cn-claim-thread-registry-98-a3f1c2`.
 */
function deriveContextNodeId(kind, key) {
    if (!CONTEXT_NODE_KINDS.includes(kind)) {
        throw new Error(`Unknown context node kind: ${String(kind)}.`);
    }
    if (typeof key !== 'string' || !key.trim()) {
        throw new Error(`Context node id key must be a non-empty string (kind: ${kind}).`);
    }
    const hash = crypto
        .createHash('sha256')
        .update(`${kind}::${key}`, 'utf8')
        .digest('hex')
        .slice(0, 6);
    const slug = slugify(key);
    return slug ? `cn-${kind}-${slug}-${hash}` : `cn-${kind}-${hash}`;
}

function dedupeOrdered(values) {
    const seen = new Set();
    const out = [];
    for (const value of Array.isArray(values) ? values : []) {
        if (value === null || value === undefined) continue;
        if (!seen.has(value)) {
            seen.add(value);
            out.push(value);
        }
    }
    return out;
}

/**
 * Creates a ContextNode (spec §5.2 shape). Links (`parentIds`/`childIds`)
 * may be attached after creation; call `validateContextGraph` once the DAG
 * is assembled. `summary` stays absent in v1 — model summaries (LC-2) are
 * the only writers of that field and never change node identity.
 */
function createContextNode({
    kind,
    key,
    title,
    sourceDocumentIds = [],
    factIds = [],
    citationIds = [],
    coverage = null,
    status = 'complete',
    derivedBy = null,
    parentIds = [],
    childIds = [],
} = {}) {
    if (!CONTEXT_NODE_KINDS.includes(kind)) {
        throw new Error(`Unknown context node kind: ${String(kind)}.`);
    }
    if (!title || typeof title !== 'string') {
        throw new Error(`Context node (${kind}) requires a string title.`);
    }
    if (!CONTEXT_NODE_STATUSES.includes(status)) {
        throw new Error(`Unknown context node status: ${String(status)}.`);
    }
    return {
        id: deriveContextNodeId(kind, key ?? title),
        kind,
        title,
        sourceDocumentIds: dedupeOrdered(sourceDocumentIds),
        factIds: dedupeOrdered(factIds),
        citationIds: dedupeOrdered(citationIds),
        childIds: dedupeOrdered(childIds),
        parentIds: dedupeOrdered(parentIds),
        coverage: {
            groundedClaims: Number.isInteger(coverage?.groundedClaims) ? coverage.groundedClaims : 0,
            totalClaims: Number.isInteger(coverage?.totalClaims) ? coverage.totalClaims : 0,
            gaps: Array.isArray(coverage?.gaps) ? [...coverage.gaps] : [],
        },
        status,
        derivedBy: derivedBy && typeof derivedBy === 'object'
            ? { strategy: 'deterministic', ...derivedBy }
            : { strategy: 'deterministic' },
    };
}

function deepFreezeNode(node) {
    for (const key of ['sourceDocumentIds', 'factIds', 'citationIds', 'childIds', 'parentIds']) {
        if (Array.isArray(node[key])) Object.freeze(node[key]);
    }
    if (node.coverage && typeof node.coverage === 'object') {
        if (Array.isArray(node.coverage.gaps)) Object.freeze(node.coverage.gaps);
        Object.freeze(node.coverage);
    }
    if (node.derivedBy && typeof node.derivedBy === 'object') Object.freeze(node.derivedBy);
    Object.freeze(node);
    return node;
}

/**
 * Validates a fully assembled ContextNode DAG and freezes it:
 * unique ids, exactly one case-root, no dangling links, bidirectional
 * parent↔child consistency, every node reachable from the root, no cycles.
 * Throws a descriptive error naming the offending node/link otherwise.
 *
 * @param {Array<object>} nodes - Assembled nodes.
 * @returns {Array<object>} The same nodes, frozen.
 */
function validateContextGraph(nodes) {
    if (!Array.isArray(nodes) || nodes.length === 0) {
        throw new Error('Context graph must be a non-empty array of nodes.');
    }
    const byId = new Map();
    for (const node of nodes) {
        if (!node || typeof node !== 'object') {
            throw new Error('Context graph contains a non-object node.');
        }
        if (!node.id || typeof node.id !== 'string') {
            throw new Error('Context graph node is missing a string id.');
        }
        if (byId.has(node.id)) {
            throw new Error(`Context graph has a duplicate node id: ${node.id}.`);
        }
        if (!CONTEXT_NODE_KINDS.includes(node.kind)) {
            throw new Error(`Context graph node ${node.id} has an unknown kind: ${String(node.kind)}.`);
        }
        byId.set(node.id, node);
    }
    const roots = nodes.filter((node) => node.kind === 'case-root');
    if (roots.length !== 1) {
        throw new Error(`Context graph must contain exactly one case-root; found ${roots.length}.`);
    }

    for (const node of nodes) {
        for (const childId of node.childIds || []) {
            if (!byId.has(childId)) {
                throw new Error(`Context graph node ${node.id} links to unknown child ${childId} (dangling link).`);
            }
            const child = byId.get(childId);
            if (!(child.parentIds || []).includes(node.id)) {
                throw new Error(`Context graph link ${node.id} → ${childId} is not reciprocated in the child's parentIds.`);
            }
        }
        for (const parentId of node.parentIds || []) {
            if (!byId.has(parentId)) {
                throw new Error(`Context graph node ${node.id} links to unknown parent ${parentId} (dangling link).`);
            }
            const parent = byId.get(parentId);
            if (!(parent.childIds || []).includes(node.id)) {
                throw new Error(`Context graph link ${node.id} → parent ${parentId} is not reciprocated in the parent's childIds.`);
            }
        }
    }

    // Reachability from the root + cycle detection (iterative DFS).
    const rootId = roots[0].id;
    const visited = new Set();
    const onPath = new Set();
    const stack = [[rootId, 0]];
    onPath.add(rootId);
    while (stack.length > 0) {
        const [currentId, childIndex] = stack[stack.length - 1];
        const current = byId.get(currentId);
        const children = current.childIds || [];
        if (childIndex >= children.length) {
            stack.pop();
            onPath.delete(currentId);
            visited.add(currentId);
            continue;
        }
        stack[stack.length - 1][1] += 1;
        const nextId = children[childIndex];
        if (onPath.has(nextId)) {
            throw new Error(`Context graph contains a cycle involving node ${nextId}.`);
        }
        if (!visited.has(nextId)) {
            onPath.add(nextId);
            stack.push([nextId, 0]);
        }
    }
    const unreachable = nodes.filter((node) => !visited.has(node.id));
    if (unreachable.length > 0) {
        throw new Error(`Context graph has nodes unreachable from the case-root: ${unreachable.map((n) => n.id).join(', ')}.`);
    }

    return nodes.map(deepFreezeNode);
}

module.exports = {
    CONTEXT_NODE_KINDS,
    CONTEXT_NODE_STATUSES,
    deriveContextNodeId,
    createContextNode,
    validateContextGraph,
};
