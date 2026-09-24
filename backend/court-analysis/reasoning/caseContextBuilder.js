// backend/court-analysis/reasoning/caseContextBuilder.js
//
// LC-1 — deterministic CaseContextBuilder (spec §5.3).
//
// Organizes a frozen evidence package into a cited ContextNode DAG without
// any model calls: one case-root, chronological procedural-period nodes, and
// claim/property thread nodes only where stable identity and conservative
// linkage rules support them. Ambiguous relationships become `unresolved`
// nodes instead of merges.
//
// Linkage tiers (mirroring propertyFlow.js `resolveSupersedesTarget`):
// shared claim-registry numbers, shared filing references, explicit
// `supersedes` references resolving to a registry/filing identity, and
// citation-graph edges between filings. Normalized-description containment
// NEVER forms a thread — competing claims with similar wording stay separate.
//
// The function is synchronous (it cannot await a model), reads the package
// without mutating it, and derives every node id from kind + stable evidence
// identity so an evidence change alters only the affected nodes.

const { normalizeText } = require('./indexer');
const { createContextNode, validateContextGraph } = require('./contextNode');

function cleanString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeIdentity(value) {
    const cleaned = cleanString(value);
    if (!cleaned) return null;
    return normalizeText(cleaned).replace(/\s+/g, ' ').trim() || null;
}

function intOrNull(value) {
    return Number.isInteger(value) ? value : null;
}

function arrayOfStrings(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
}

function extractYear(value) {
    if (value === null || value === undefined) return null;
    const match = String(value).match(/(\d{4})/);
    return match ? match[1] : null;
}

/**
 * Indexes ledger rows by owning analysis + normalized description so facts
 * collected from analyses reuse stable ledger ids where they exist.
 * First row wins on collision; the map is rebuilt per call (deterministic).
 */
function indexLedgerRows(factLedger) {
    const index = new Map();
    for (const row of Array.isArray(factLedger) ? factLedger : []) {
        if (!row || typeof row !== 'object' || !row.id) continue;
        const key = `${row?.doc?.analysisId || ''}::${row.kind || ''}::${normalizeIdentity(row.description) || ''}`;
        if (!index.has(key)) index.set(key, row.id);
    }
    return index;
}

/**
 * Collects normalized facts from attached analyses in package order.
 * Amount items become `amount` facts, propertyFlow items `property` facts.
 * Exported for reuse (LC-3 report-input selection consumes the same facts).
 *
 * @param {object} pkg - Frozen evidence package.
 * @returns {Array<object>} Facts in deterministic package order.
 */
function collectContextFacts(pkg) {
    const ledgerIndex = indexLedgerRows(pkg?.factLedger);
    const facts = [];
    const analyses = Array.isArray(pkg?.analyses) ? pkg.analyses : [];
    analyses.forEach((analysis, analysisPosition) => {
        if (!analysis || typeof analysis !== 'object') return;
        const analysisId = analysis.id || analysis.fileName || `analysis-${analysisPosition + 1}`;
        const cited = arrayOfStrings(analysis.citedFilingReferences);
        const pushItem = (item, kind, itemIndex) => {
            if (!item || typeof item !== 'object') return;
            const description = cleanString(item.description);
            const ledgerKey = `${analysisId}::${kind}::${normalizeIdentity(description) || ''}`;
            facts.push({
                factId: ledgerIndex.get(ledgerKey) || `${analysisId}#${kind}-${itemIndex}`,
                kind,
                description,
                value: item.amount ?? item.value ?? null,
                currency: cleanString(item.currency),
                date: cleanString(item.date),
                eventType: cleanString(item.eventType),
                claimRegistryNumber: cleanString(item.claimRegistryNumber),
                filingReference: cleanString(item.filingReference),
                references: arrayOfStrings(item.references),
                supersedes: cleanString(item.supersedes),
                transferor: cleanString(item.transferor),
                transferee: cleanString(item.transferee),
                payerOib: cleanString(item.payerOib),
                recipientOib: cleanString(item.recipientOib),
                quote: typeof item.quote === 'string' ? item.quote : null,
                grounded: item.grounded === true,
                analysisId,
                analysisPosition,
                fileName: analysis.fileName || null,
                sourceEntryIndex: intOrNull(analysis.sourceEntryIndex),
                sourceDocumentLinkId: analysis.sourceDocumentLinkId || null,
                documentRole: cleanString(analysis.documentRole),
                citedFilingReferences: cited,
                itemIndex,
            });
        };
        (Array.isArray(analysis.amounts) ? analysis.amounts : []).forEach((item, i) => pushItem(item, 'amount', i));
        (Array.isArray(analysis.propertyFlow) ? analysis.propertyFlow : []).forEach((item, i) => pushItem(item, 'property', i));
    });
    return facts;
}

/**
 * Splits a `supersedes` reference into candidate identifier tokens plus the
 * full reference itself, e.g. `St-2/2013-1098/redni broj 98` → the full
 * string and [`st-2/2013-1098`, `redni`, `broj`, `98`]. Tokens resolve
 * against registry/filing identities by exact (normalized) equality only.
 */
function supersedesTokens(supersedes) {
    const cleaned = cleanString(supersedes);
    if (!cleaned) return [];
    const tokens = new Set([normalizeIdentity(cleaned)]);
    for (const part of cleaned.split(/[\s,;|/]+/)) {
        const token = normalizeIdentity(part);
        if (token) tokens.add(token);
    }
    tokens.delete(null);
    return [...tokens];
}

function createUnionFind(size) {
    const parent = Array.from({ length: size }, (_, index) => index);
    function find(a) {
        let root = a;
        while (parent[root] !== root) root = parent[root];
        while (parent[a] !== a) {
            const next = parent[a];
            parent[a] = root;
            a = next;
        }
        return root;
    }
    return {
        find,
        union(a, b) {
            const rootA = find(a);
            const rootB = find(b);
            if (rootA === rootB) return false;
            parent[rootB] = rootA;
            return true;
        },
    };
}

function analysisYear(analysis, memberFacts) {
    return (
        extractYear(analysis?.decisionDate) ||
        extractYear(analysis?.entryDate) ||
        extractYear(memberFacts.map((fact) => fact.date).find((date) => extractYear(date))) ||
        'undated'
    );
}

function coverageOf(memberFacts) {
    const totalClaims = memberFacts.length;
    const groundedClaims = memberFacts.filter((fact) => fact.grounded).length;
    const gaps = memberFacts.filter((fact) => !fact.grounded).map((fact) => `ungrounded:${fact.factId}`);
    return { groundedClaims, totalClaims, gaps };
}

/**
 * Builds the deterministic v1 ContextNode DAG from an immutable evidence
 * package. Never mutates the package, never calls a model.
 *
 * @param {object} pkg - Frozen evidence package (analyses, factLedger,
 *   citationGraph, coverage).
 * @returns {{ rootId: string, nodes: Array<object>, trace: object }}
 */
function buildCaseContext(pkg) {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
        throw new Error('buildCaseContext: evidence package must be a plain object.');
    }
    const facts = collectContextFacts(pkg);
    const union = createUnionFind(facts.length);
    const traceLinks = [];

    const linkFacts = (a, b, basis) => {
        if (a === b) return;
        if (facts[a].kind !== facts[b].kind) {
            traceLinks.push({ factIds: [facts[a].factId, facts[b].factId], basis: `${basis}-cross-kind`, united: false });
            return;
        }
        if (union.union(a, b)) {
            traceLinks.push({ factIds: [facts[a].factId, facts[b].factId], basis, united: true });
        }
    };

    // Tier 1 — shared stable identifiers, per kind (never across kinds:
    // amount statements and property transfers stay in their own threads).
    for (const identityField of ['claimRegistryNumber', 'filingReference']) {
        const basis = identityField === 'claimRegistryNumber' ? 'registry' : 'filing';
        const groups = new Map();
        facts.forEach((fact, index) => {
            const identity = normalizeIdentity(fact[identityField]);
            if (!identity) return;
            const key = `${fact.kind}::${identity}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(index);
        });
        for (const group of groups.values()) {
            for (let i = 1; i < group.length; i += 1) linkFacts(group[0], group[i], basis);
        }
    }

    // Tier 2 — explicit `supersedes` references resolving to a registry or
    // filing identity (same tiers as resolveSupersedesTarget, minus the
    // description-containment fallback, which must never merge threads).
    const registryIndex = new Map();
    const filingIndex = new Map();
    facts.forEach((fact, index) => {
        const registry = normalizeIdentity(fact.claimRegistryNumber);
        if (registry && !registryIndex.has(registry)) registryIndex.set(registry, []);
        if (registry) registryIndex.get(registry).push(index);
        const filing = normalizeIdentity(fact.filingReference);
        if (filing && !filingIndex.has(filing)) filingIndex.set(filing, []);
        if (filing) filingIndex.get(filing).push(index);
    });
    facts.forEach((fact, index) => {
        if (!fact.supersedes) return;
        for (const token of supersedesTokens(fact.supersedes)) {
            for (const candidate of registryIndex.get(token) || []) {
                if (candidate !== index) linkFacts(index, candidate, 'supersedes-registry');
            }
            for (const candidate of filingIndex.get(token) || []) {
                if (candidate !== index) linkFacts(index, candidate, 'supersedes-filing');
            }
        }
    });

    // Tier 3 — citation-graph edges between filings. Endpoints may be filing
    // references or analysis ids depending on which graph builder produced
    // them; resolve through both maps.
    const analysisIndex = new Map();
    facts.forEach((fact, index) => {
        if (!analysisIndex.has(fact.analysisId)) analysisIndex.set(fact.analysisId, []);
        analysisIndex.get(fact.analysisId).push(index);
    });
    const resolveEndpoint = (endpoint) => {
        const normalized = normalizeIdentity(endpoint);
        if (!normalized) return [];
        const out = [];
        for (const candidate of filingIndex.get(normalized) || []) out.push(candidate);
        for (const [analysisId, members] of analysisIndex) {
            if (normalizeIdentity(analysisId) === normalized) out.push(...members);
        }
        return [...new Set(out)];
    };
    for (const edge of Array.isArray(pkg?.citationGraph?.edges) ? pkg.citationGraph.edges : []) {
        if (!edge || typeof edge !== 'object') continue;
        for (const a of resolveEndpoint(edge.from)) {
            for (const b of resolveEndpoint(edge.to)) {
                if (a !== b) linkFacts(a, b, 'citation');
            }
        }
    }

    // Partition union-find groups; split defensively by kind (all unions are
    // same-kind, so mixed groups indicate a bug, not a merge).
    const groups = new Map();
    facts.forEach((fact, index) => {
        const root = union.find(index);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(index);
    });

    const selections = [];
    const omitted = [];
    const threadNodes = [];
    const unresolvedNodes = [];

    const orderedGroupKeys = [...groups.keys()].sort((a, b) => {
        const firstA = facts[groups.get(a)[0]].factId;
        const firstB = facts[groups.get(b)[0]].factId;
        return firstA < firstB ? -1 : 1;
    });

    for (const groupKey of orderedGroupKeys) {
        const members = groups.get(groupKey).sort((a, b) => a - b);
        const byKind = new Map();
        for (const index of members) {
            const kind = facts[index].kind;
            if (!byKind.has(kind)) byKind.set(kind, []);
            byKind.get(kind).push(index);
        }
        for (const [kind, kindMembers] of byKind) {
            const memberFacts = kindMembers.map((index) => facts[index]);
            const registries = [...new Set(memberFacts.map((fact) => normalizeIdentity(fact.claimRegistryNumber)).filter(Boolean))].sort();
            const filings = [...new Set(memberFacts.map((fact) => normalizeIdentity(fact.filingReference)).filter(Boolean))].sort();
            if (registries.length === 0 && filings.length === 0) {
                // No stable identity: one unresolved node per fact, never a merge.
                for (const index of kindMembers) {
                    const fact = facts[index];
                    const node = createContextNode({
                        kind: 'unresolved',
                        key: `unlinked:${fact.analysisId}:${fact.kind}:${fact.itemIndex}`,
                        title: fact.description
                            ? fact.description.slice(0, 80)
                            : `Nerazriješeno — ${fact.fileName || fact.analysisId}`,
                        sourceDocumentIds: [fact.analysisId],
                        factIds: [fact.factId],
                        citationIds: fact.citedFilingReferences,
                        coverage: { groundedClaims: 0, totalClaims: 1, gaps: [`${fact.factId}: no stable identifier; kept separate, never merged`] },
                        status: 'unresolved',
                    });
                    unresolvedNodes.push(node);
                    omitted.push({
                        factId: fact.factId,
                        nodeId: node.id,
                        reason: 'no-stable-identifier',
                        detail: 'Fact carries no claim-registry number or filing reference, so it cannot join a thread.',
                    });
                }
                continue;
            }
            const nodeKind = kind === 'property' ? 'property-thread' : 'claim-thread';
            const nodeKey = `registry:${registries.join('|')};filing:${filings.join('|')}`;
            const firstRegistryOriginal = memberFacts.map((fact) => fact.claimRegistryNumber).find(Boolean);
            let title;
            if (nodeKind === 'property-thread') {
                const transfer = memberFacts.find((fact) => fact.transferor || fact.transferee);
                title = transfer && (transfer.transferor || transfer.transferee)
                    ? `${transfer.transferor || '?'} → ${transfer.transferee || '?'}`
                    : `Imovina — redni broj ${firstRegistryOriginal || memberFacts.map((fact) => fact.filingReference).find(Boolean)}`;
            } else {
                title = firstRegistryOriginal
                    ? `Tražbina — redni broj ${firstRegistryOriginal}`
                    : `Tražbina — ${memberFacts.map((fact) => fact.filingReference).find(Boolean)}`;
            }
            const memberAnalyses = [...new Set(memberFacts.map((fact) => fact.analysisId))];
            const analysisById = new Map();
            for (const analysis of Array.isArray(pkg.analyses) ? pkg.analyses : []) {
                if (analysis && analysis.id) analysisById.set(analysis.id, analysis);
            }
            const citationIds = [];
            for (const analysisId of memberAnalyses) {
                for (const ref of arrayOfStrings(analysisById.get(analysisId)?.citedFilingReferences)) {
                    if (!citationIds.includes(ref)) citationIds.push(ref);
                }
            }
            for (const fact of memberFacts) {
                if (fact.filingReference && !citationIds.includes(fact.filingReference)) {
                    citationIds.push(fact.filingReference);
                }
            }
            const node = createContextNode({
                kind: nodeKind,
                key: nodeKey,
                title,
                sourceDocumentIds: memberAnalyses,
                factIds: memberFacts.map((fact) => fact.factId),
                citationIds,
                coverage: coverageOf(memberFacts),
                status: memberFacts.every((fact) => fact.grounded) ? 'complete' : 'partial',
            });
            threadNodes.push(node);
            selections.push({
                nodeId: node.id,
                kind: nodeKind,
                basis: registries.length > 0 ? 'registry' : 'filing',
                identities: { registries, filings },
                factIds: node.factIds,
            });
        }
    }

    // Procedural-period nodes: chronological buckets of analyses by entry year.
    const analyses = Array.isArray(pkg.analyses) ? pkg.analyses : [];
    const factsByAnalysis = new Map();
    facts.forEach((fact, index) => {
        if (!factsByAnalysis.has(fact.analysisId)) factsByAnalysis.set(fact.analysisId, []);
        factsByAnalysis.get(fact.analysisId).push(index);
    });
    const periods = new Map();
    analyses.forEach((analysis) => {
        if (!analysis || typeof analysis !== 'object') return;
        const analysisId = analysis.id || analysis.fileName;
        if (!analysisId) return;
        const memberFacts = (factsByAnalysis.get(analysisId) || []).map((index) => facts[index]);
        const year = analysisYear(analysis, memberFacts);
        if (!periods.has(year)) periods.set(year, { analyses: [], factIndexes: [] });
        periods.get(year).analyses.push(analysis);
        periods.get(year).factIndexes.push(...(factsByAnalysis.get(analysisId) || []));
    });
    const orderedYears = [...periods.keys()].sort((a, b) => {
        if (a === 'undated') return 1;
        if (b === 'undated') return -1;
        return a < b ? -1 : 1;
    });
    const periodNodes = orderedYears.map((year) => {
        const bucket = periods.get(year);
        const memberFacts = bucket.factIndexes.sort((a, b) => a - b).map((index) => facts[index]);
        const sourceDocumentIds = bucket.analyses.map((analysis) => analysis.id || analysis.fileName);
        const citationIds = [];
        for (const analysis of bucket.analyses) {
            for (const ref of arrayOfStrings(analysis.citedFilingReferences)) {
                if (!citationIds.includes(ref)) citationIds.push(ref);
            }
        }
        return createContextNode({
            kind: 'procedural-period',
            key: `period:${year}`,
            title: year === 'undated' ? 'Nedatirani izvori' : `Postupak ${year}`,
            sourceDocumentIds,
            factIds: memberFacts.map((fact) => fact.factId),
            citationIds,
            coverage: coverageOf(memberFacts),
            status: memberFacts.length > 0 && memberFacts.every((fact) => fact.grounded) ? 'complete' : 'partial',
        });
    });

    // Case root: the whole frozen input, with package-level coverage.
    const clusterId = pkg.clusterId || pkg.primaryCaseNumber || 'unknown';
    const packageCoverage = pkg.coverage && typeof pkg.coverage === 'object' ? pkg.coverage : {};
    const rootCoverage = {
        groundedClaims: Number.isInteger(packageCoverage.groundedClaims)
            ? packageCoverage.groundedClaims
            : facts.filter((fact) => fact.grounded).length,
        totalClaims: Number.isInteger(packageCoverage.totalClaims)
            ? packageCoverage.totalClaims
            : facts.length,
        gaps: Array.isArray(packageCoverage.gaps) ? [...packageCoverage.gaps] : [],
    };
    const rootCitations = [];
    for (const analysis of analyses) {
        for (const ref of arrayOfStrings(analysis?.citedFilingReferences)) {
            if (!rootCitations.includes(ref)) rootCitations.push(ref);
        }
    }
    const root = createContextNode({
        kind: 'case-root',
        key: `root:${String(clusterId)}`,
        title: clusterId === 'unknown' ? 'Pregled predmeta' : `${clusterId} — pregled predmeta`,
        sourceDocumentIds: analyses.map((analysis) => analysis?.id || analysis?.fileName).filter(Boolean),
        factIds: facts.map((fact) => fact.factId),
        citationIds: rootCitations,
        coverage: rootCoverage,
        status: packageCoverage.complete === true ? 'complete' : 'partial',
    });

    threadNodes.sort((a, b) => (a.id < b.id ? -1 : 1));
    unresolvedNodes.sort((a, b) => (a.id < b.id ? -1 : 1));
    const nodes = [root, ...periodNodes, ...threadNodes, ...unresolvedNodes];
    root.childIds = nodes.slice(1).map((node) => node.id);
    for (const node of nodes.slice(1)) node.parentIds = [root.id];

    const trace = {
        selections,
        omitted,
        links: traceLinks,
        stats: {
            facts: facts.length,
            sources: analyses.length,
            periods: periodNodes.length,
            threads: threadNodes.length,
            unresolved: unresolvedNodes.length,
        },
        truncated: false,
    };

    return { rootId: root.id, nodes: validateContextGraph(nodes), trace };
}

module.exports = {
    collectContextFacts,
    buildCaseContext,
};
