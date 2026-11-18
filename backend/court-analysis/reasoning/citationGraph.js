// backend/court-analysis/reasoning/citationGraph.js
//
// L-02 — lightweight filing citation graph. Nodes are documents; edges run
// from citing documents to the `poslovni broj` they explicitly reference.
// Own references come from structured facts, procedural events, and discovery
// metadata so a decision with no money/property facts still has an identity.
//
// Consumers: lifecycle reconciliation uses exact references only. Empty
// input → empty graph, never throws.
//
// Consumers: reconcilePropertyFlows treats citation-linked tražbina entries
// as lifecycle-chain links (same as an explicit `supersedes`), instead of
// guessing from prose. Empty input → empty graph, never throws.

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
 * @param {Array<object>} analyses - Normalized analyses (as attached by
 * attachAnalysesToEvidencePackage: {id, fileName, amounts, propertyFlow,
 * citedFilingReferences}).
 * @returns {{nodes: Array<{id: string, fileName: string|null, filingReferences: string[]}>, edges: Array<{from: string, to: string, via: string}>}}
 */
function buildCitationGraph(analyses, metadataEntries = []) {
    const nodes = [];
    const refOwners = new Map(); // filingReference -> node id (first owner wins)
    const sourceEntryNodes = new Map();
    const list = Array.isArray(analyses) ? analyses : [];

    for (const analysis of list) {
        const id = analysis?.id || analysis?.fileName || `analysis-${nodes.length + 1}`;
        const refs = [...ownFilingReferences(analysis)];
        nodes.push({ id, fileName: analysis?.fileName || null, filingReferences: refs });
        if (Number.isInteger(analysis?.sourceEntryIndex)) sourceEntryNodes.set(analysis.sourceEntryIndex, nodes[nodes.length - 1]);
        for (const ref of refs) {
            if (!refOwners.has(ref)) refOwners.set(ref, id);
        }
    }

    for (const entry of Array.isArray(metadataEntries) ? metadataEntries : []) {
        const entryIndex = entry?.index;
        let node = Number.isInteger(entryIndex) ? sourceEntryNodes.get(entryIndex) : null;
        if (!node) {
            const id = `entry-${entryIndex ?? nodes.length}`;
            node = { id, fileName: null, filingReferences: [] };
            nodes.push(node);
            if (Number.isInteger(entryIndex)) sourceEntryNodes.set(entryIndex, node);
        }
        for (const event of Array.isArray(entry?.proceduralEvents) ? entry.proceduralEvents : []) {
            const own = typeof event?.filingReference === 'string' ? event.filingReference.trim() : '';
            if (own && !node.filingReferences.includes(own)) node.filingReferences.push(own);
            if (own && !refOwners.has(own)) refOwners.set(own, node.id);
        }
    }

    const edges = [];
    const addReferences = (fromId, references) => {
        for (const ref of references) {
            const toId = refOwners.get(ref) || null;
            edges.push({ from: fromId, to: toId || ref, via: ref, resolved: toId !== null });
        }
    };
    for (const analysis of list) {
        const fromId = analysis?.id || analysis?.fileName;
        if (fromId) addReferences(fromId, citedReferences(analysis));
    }
    for (const entry of Array.isArray(metadataEntries) ? metadataEntries : []) {
        const entryIndex = entry?.index;
        const node = Number.isInteger(entryIndex) ? sourceEntryNodes.get(entryIndex) : null;
        if (!node) continue;
        const refs = new Set((Array.isArray(entry.proceduralEvents) ? entry.proceduralEvents : [])
            .flatMap((event) => Array.isArray(event?.referencedFilingReferences) ? event.referencedFilingReferences : [])
            .map((ref) => String(ref || '').trim()).filter(Boolean));
        addReferences(node.id, refs);
    }
    return { nodes, edges };
}

/**
 * Finds entry-id pairs joined by a direct citation: entry A's filing
 * reference appears in entry B's document's citedFilingReferences (or vice
 * versa). Only pairs where BOTH entries carry a filingReference participate —
 * no fuzzy matching.
 * @param {Array<object>} entries - Normalized money/property entries
 * ({id, filingReference, sourceId}).
 * @param {Array<object>} analyses - Same shape as buildCitationGraph input.
 * @returns {Set<string>} `idA::idB` (sorted) pair keys.
 */
function findCitationLinkedPairs(entries, analyses) {
    const pairs = new Set();
    const list = Array.isArray(entries) ? entries : [];
    const bySource = new Map();
    for (const analysis of Array.isArray(analyses) ? analyses : []) {
        if (analysis?.id) bySource.set(analysis.id, analysis);
    }
    const citedBySource = new Map();
    for (const [sourceId, analysis] of bySource) {
        citedBySource.set(sourceId, citedReferences(analysis));
    }

    const withRefs = list.filter((e) => typeof e?.filingReference === 'string' && e.filingReference.trim());
    for (let i = 0; i < withRefs.length; i++) {
        for (let j = i + 1; j < withRefs.length; j++) {
            const a = withRefs[i];
            const b = withRefs[j];
            const aCitesB = citedBySource.get(a.sourceId)?.has(b.filingReference.trim());
            const bCitesA = citedBySource.get(b.sourceId)?.has(a.filingReference.trim());
            if (aCitesB || bCitesA) {
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
