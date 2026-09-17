// backend/court-analysis/reasoning/citationGraph.js
//
// L-02 — lightweight filing citation graph. Nodes are analyzed documents;
// edges run from a citing document to the `poslovni broj` it explicitly
// references (J-05 `citedFilingReferences`). A document's OWN filing
// references come from its normalized money/property entries (J-04), so the
// graph resolves references to real nodes when another analyzed document
// owns that filing number.
//
// Consumers: reconcilePropertyFlows treats citation-linked tražbina entries
// as lifecycle-chain links (same as an explicit `supersedes`), instead of
// guessing from prose. Empty input → empty graph, never throws.

function ownFilingReferences(analysis) {
    const refs = new Set();
    for (const key of ['amounts', 'propertyFlow']) {
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
    const list = analysis?.citedFilingReferences;
    if (!Array.isArray(list)) return out;
    for (const ref of list) {
        const s = String(ref || '').trim();
        if (s) out.add(s);
    }
    return out;
}

/**
 * @param {Array<object>} analyses - Normalized analyses (as attached by
 * attachAnalysesToEvidencePackage: {id, fileName, amounts, propertyFlow,
 * citedFilingReferences}).
 * @returns {{nodes: Array<{id: string, fileName: string|null, filingReferences: string[]}>, edges: Array<{from: string, to: string, via: string}>}}
 */
function buildCitationGraph(analyses) {
    const nodes = [];
    const refOwners = new Map(); // filingReference -> node id (first owner wins)
    const list = Array.isArray(analyses) ? analyses : [];

    for (const analysis of list) {
        const id = analysis?.id || analysis?.fileName || `analysis-${nodes.length + 1}`;
        const refs = [...ownFilingReferences(analysis)];
        nodes.push({ id, fileName: analysis?.fileName || null, filingReferences: refs });
        for (const ref of refs) {
            if (!refOwners.has(ref)) refOwners.set(ref, id);
        }
    }

    const edges = [];
    for (const analysis of list) {
        const fromId = analysis?.id || analysis?.fileName;
        if (!fromId) continue;
        for (const ref of citedReferences(analysis)) {
            const toId = refOwners.get(ref) || null;
            edges.push({ from: fromId, to: toId || ref, via: ref, resolved: toId !== null });
        }
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
