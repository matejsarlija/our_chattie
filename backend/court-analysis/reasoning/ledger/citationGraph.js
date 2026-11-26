// backend/court-analysis/reasoning/citationGraph.js
//
// L-02 — lightweight filing citation graph. Nodes are documents; edges run
// from citing documents to the `poslovni broj` they explicitly reference.
// Own references come from structured facts, procedural events, and discovery
// metadata so a decision with no money/property facts still has an identity.

function normalizeRef(ref) {
    return String(ref || '')
        .trim()
        .toLowerCase()
        .replace(/[–—−]/g, '-')
        .replace(/\s+/g, '');
}

function ownFilingReferences(analysis) {
    const refs = new Set();
    for (const key of ['amounts', 'propertyFlow', 'proceduralEvents', 'metadataProceduralEvents']) {
        const list = analysis?.[key];
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            const ref = typeof item?.filingReference === 'string' ? item.filingReference.trim() : '';
            if (ref) refs.add(ref);
        }
    }
    return refs;
}

function citedReferences(analysis) {
    const out = new Set();
    for (const ref of Array.isArray(analysis?.citedFilingReferences) ? analysis.citedFilingReferences : []) {
        const value = String(ref || '').trim();
        if (value) out.add(value);
    }
    for (const event of Array.isArray(analysis?.proceduralEvents) ? analysis.proceduralEvents : []) {
        for (const ref of Array.isArray(event?.referencedFilingReferences) ? event.referencedFilingReferences : []) {
            const value = String(ref || '').trim();
            if (value) out.add(value);
        }
    }
    return out;
}

/**
 * @param {Array<object>} analyses - Normalized analyses.
 * @returns {{nodes: Array<{id: string, fileName: string|null, filingReferences: string[]}>, edges: Array<{from: string, to: string, via: string}>}}
 */
function buildCitationGraph(analyses, metadataEntries = []) {
    const nodes = [];
    const refOwners = new Map(); // normalized filingReference -> Set<nodeId>
    const sourceEntryNodes = new Map(); // entryIndex -> Array<node>
    const list = Array.isArray(analyses) ? analyses : [];

    const addRefOwner = (ref, ownerId) => {
        const norm = normalizeRef(ref);
        if (!norm || !ownerId) return;
        if (!refOwners.has(norm)) refOwners.set(norm, new Set());
        refOwners.get(norm).add(ownerId);
    };

    const resolveSingleOwner = (ref) => {
        const owners = refOwners.get(normalizeRef(ref));
        if (!owners || owners.size !== 1) return null;
        return owners.values().next().value;
    };

    for (const analysis of list) {
        const id = analysis?.id || analysis?.fileName || `analysis-${nodes.length + 1}`;
        const refs = [...ownFilingReferences(analysis)];
        const node = { id, fileName: analysis?.fileName || null, filingReferences: refs };
        nodes.push(node);
        if (Number.isInteger(analysis?.sourceEntryIndex)) {
            if (!sourceEntryNodes.has(analysis.sourceEntryIndex)) {
                sourceEntryNodes.set(analysis.sourceEntryIndex, []);
            }
            sourceEntryNodes.get(analysis.sourceEntryIndex).push(node);
        }
        for (const ref of refs) {
            addRefOwner(ref, id);
        }
    }

    for (const entry of Array.isArray(metadataEntries) ? metadataEntries : []) {
        const entryIndex = entry?.index;
        let entryNodes = Number.isInteger(entryIndex) ? (sourceEntryNodes.get(entryIndex) || []) : [];
        if (entryNodes.length === 0) {
            const id = `entry-${entryIndex ?? nodes.length}`;
            const node = { id, fileName: null, filingReferences: [] };
            nodes.push(node);
            entryNodes = [node];
            if (Number.isInteger(entryIndex)) sourceEntryNodes.set(entryIndex, entryNodes);
        }
        const primaryNode = entryNodes[0];
        for (const event of Array.isArray(entry?.proceduralEvents) ? entry.proceduralEvents : []) {
            const own = typeof event?.filingReference === 'string' ? event.filingReference.trim() : '';
            if (own && !primaryNode.filingReferences.includes(own)) primaryNode.filingReferences.push(own);
            if (own) addRefOwner(own, primaryNode.id);
        }
    }

    const edges = [];
    const addReferences = (fromId, references) => {
        for (const ref of references) {
            const toId = resolveSingleOwner(ref);
            if (toId && toId === fromId) continue;
            edges.push({ from: fromId, to: toId || ref, via: ref, resolved: toId !== null });
        }
    };
    for (const analysis of list) {
        const fromId = analysis?.id || analysis?.fileName;
        if (fromId) addReferences(fromId, citedReferences(analysis));
    }
    for (const entry of Array.isArray(metadataEntries) ? metadataEntries : []) {
        const entryIndex = entry?.index;
        const entryNodes = Number.isInteger(entryIndex) ? (sourceEntryNodes.get(entryIndex) || []) : [];
        if (entryNodes.length === 0) continue;
        const primaryNode = entryNodes[0];
        const refs = new Set((Array.isArray(entry.proceduralEvents) ? entry.proceduralEvents : [])
            .flatMap((event) => Array.isArray(event?.referencedFilingReferences) ? event.referencedFilingReferences : [])
            .map((ref) => String(ref || '').trim()).filter(Boolean));
        addReferences(primaryNode.id, refs);
    }
    return { nodes, edges };
}

/**
 * O(N) indexed lookup of entry-id pairs joined by a direct citation.
 */
function findCitationLinkedPairs(entries, analyses) {
    const pairs = new Set();
    const list = Array.isArray(entries) ? entries : [];
    const citedBySource = new Map();
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        if (!analysis?.id) continue;
        const normCited = new Set();
        for (const ref of citedReferences(analysis)) {
            const norm = normalizeRef(ref);
            if (norm) normCited.add(norm);
        }
        citedBySource.set(analysis.id, normCited);
    }

    const entriesByNormRef = new Map();
    const withRefs = [];
    for (const entry of list) {
        const normRef = normalizeRef(entry?.filingReference);
        if (!normRef) continue;
        withRefs.push({ entry, normRef });
        if (!entriesByNormRef.has(normRef)) entriesByNormRef.set(normRef, []);
        entriesByNormRef.get(normRef).push(entry);
    }

    for (const { entry: a } of withRefs) {
        const cited = citedBySource.get(a.sourceId);
        if (!cited || cited.size === 0) continue;
        for (const ref of cited) {
            const targets = entriesByNormRef.get(ref);
            if (!targets) continue;
            for (const b of targets) {
                if (a.id === b.id) continue;
                const key = [String(a.id), String(b.id)].sort().join('::');
                pairs.add(key);
            }
        }
    }
    return pairs;
}

module.exports = {
    buildCitationGraph,
    findCitationLinkedPairs,
};
