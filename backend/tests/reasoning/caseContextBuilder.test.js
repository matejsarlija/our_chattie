const { buildCaseContext } = require('../../court-analysis/reasoning/caseContextBuilder');
const {
    createContextNode,
    validateContextGraph,
} = require('../../court-analysis/reasoning/contextNode');
const {
    stableStringify,
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../court-analysis/reasoning/analysisLab/evidenceIdentity');

const LAB_FIXTURE = require('../fixtures/replays/analysis-lab/kerum-lab.json');

function buildFromFixture() {
    return buildCaseContext(cloneEvidencePackage(LAB_FIXTURE));
}

function nodesByKind(nodes, kind) {
    return nodes.filter((node) => node.kind === kind);
}

function nodeById(nodes, id) {
    return nodes.find((node) => node.id === id);
}

describe('caseContextBuilder (LC-1)', () => {
    test('fixture yields a stable DAG across repeated builds', () => {
        const first = buildFromFixture();
        const second = buildFromFixture();
        expect(stableStringify(second)).toBe(stableStringify(first));
        expect(second.rootId).toBe(first.rootId);
    });

    test('builds one case-root, chronological periods, threads, and an unresolved node', () => {
        const { rootId, nodes, trace } = buildFromFixture();

        expect(nodesByKind(nodes, 'case-root')).toHaveLength(1);
        expect(nodeById(nodes, rootId).kind).toBe('case-root');

        const periods = nodesByKind(nodes, 'procedural-period');
        expect(periods.map((node) => node.title)).toEqual([
            'Postupak 2024',
            'Postupak 2025',
            'Postupak 2026',
        ]);

        // Explicit lifecycle: the Prokurator → Coast transfer is its own
        // property thread; the HRK/EUR pair sharing registry 98 is one
        // claim thread; CRO-GO registry 106 is another.
        const propertyThreads = nodesByKind(nodes, 'property-thread');
        expect(propertyThreads).toHaveLength(1);
        expect(propertyThreads[0].title).toContain('PROKURATOR');
        expect(propertyThreads[0].factIds).toEqual(['ledger-2']);

        const claimThreads = nodesByKind(nodes, 'claim-thread');
        expect(claimThreads).toHaveLength(2);
        const thread98 = claimThreads.find((node) => node.factIds.includes('ledger-3'));
        expect(thread98.factIds).toEqual(['ledger-3', 'ledger-4']);

        // The identifier-less ustup is materialized as unresolved, not merged.
        const unresolved = nodesByKind(nodes, 'unresolved');
        expect(unresolved).toHaveLength(1);
        expect(unresolved[0].factIds).toEqual(['lab-doc-02#property-1']);
        expect(trace.omitted).toHaveLength(1);
        expect(trace.omitted[0]).toMatchObject({ factId: 'lab-doc-02#property-1', reason: 'no-stable-identifier' });
    });

    test('nodes carry the §5.2 shape with deterministic derivation and no model summaries', () => {
        const { nodes } = buildFromFixture();
        for (const node of nodes) {
            expect(node).toMatchObject({
                id: expect.any(String),
                kind: expect.any(String),
                title: expect.any(String),
            });
            expect(Array.isArray(node.sourceDocumentIds)).toBe(true);
            expect(Array.isArray(node.factIds)).toBe(true);
            expect(Array.isArray(node.citationIds)).toBe(true);
            expect(Array.isArray(node.childIds)).toBe(true);
            expect(Array.isArray(node.parentIds)).toBe(true);
            expect(node.coverage).toMatchObject({
                groundedClaims: expect.any(Number),
                totalClaims: expect.any(Number),
                gaps: expect.any(Array),
            });
            expect(node.derivedBy).toMatchObject({ strategy: 'deterministic' });
            expect(node.summary).toBeUndefined();
        }
        expect(nodesByKind(nodes, 'unresolved')[0].status).toBe('unresolved');
    });

    test('generic same-description claims remain separate and never merge', () => {
        const pkg = {
            packageType: 'ClusterEvidencePackage',
            schemaVersion: 1,
            clusterId: 'St-9/2024',
            analyses: [
                {
                    id: 'doc-a', fileName: 'a.pdf', decisionDate: '2024-01-05',
                    amounts: [{ description: 'Isti opis tražbine', amount: 100, currency: 'EUR', claimRegistryNumber: '1', filingReference: 'St-9/2024-1', grounded: true }],
                    propertyFlow: [], citedFilingReferences: [],
                },
                {
                    id: 'doc-b', fileName: 'b.pdf', decisionDate: '2024-02-05',
                    amounts: [{ description: 'Isti opis tražbine', amount: 200, currency: 'EUR', claimRegistryNumber: '2', filingReference: 'St-9/2024-2', grounded: true }],
                    propertyFlow: [], citedFilingReferences: [],
                },
                {
                    id: 'doc-c', fileName: 'c.pdf', decisionDate: '2024-03-05',
                    amounts: [],
                    propertyFlow: [
                        { description: 'Neidentificirani ustup', assetType: 'tražbina', eventType: 'ustup', grounded: false },
                        { description: 'Neidentificirani ustup', assetType: 'tražbina', eventType: 'ustup', grounded: false },
                    ],
                    citedFilingReferences: [],
                },
            ],
        };
        const { nodes } = buildCaseContext(pkg);

        const claimThreads = nodesByKind(nodes, 'claim-thread');
        expect(claimThreads).toHaveLength(2);
        expect(claimThreads[0].factIds).toHaveLength(1);
        expect(claimThreads[1].factIds).toHaveLength(1);

        const unresolved = nodesByKind(nodes, 'unresolved');
        expect(unresolved).toHaveLength(2);
        expect(unresolved[0].factIds).not.toEqual(unresolved[1].factIds);
    });

    test('a shared source appears in two nodes where justified', () => {
        const { nodes } = buildFromFixture();
        const inPropertyThread = nodes.find(
            (node) => node.kind === 'property-thread' && node.sourceDocumentIds.includes('lab-doc-02')
        );
        const inPeriod = nodes.find(
            (node) => node.kind === 'procedural-period' && node.sourceDocumentIds.includes('lab-doc-02')
        );
        expect(inPropertyThread).toBeDefined();
        expect(inPeriod).toBeDefined();
        expect(inPeriod.title).toBe('Postupak 2025');
        expect(inPropertyThread.id).not.toBe(inPeriod.id);
    });

    test('changed source changes only the affected node id and contents', () => {
        const before = buildFromFixture();

        const mutated = cloneEvidencePackage(LAB_FIXTURE);
        mutated.analyses[0].amounts[0].claimRegistryNumber = '107';
        const after = buildCaseContext(mutated);

        const beforeById = new Map(before.nodes.map((node) => [node.id, stableStringify(node)]));
        const afterById = new Map(after.nodes.map((node) => [node.id, stableStringify(node)]));

        const renamedBefore = before.nodes.find((node) => node.kind === 'claim-thread' && node.factIds.includes('ledger-1'));
        const renamedAfter = after.nodes.find((node) => node.kind === 'claim-thread' && node.factIds.includes('ledger-1'));
        expect(renamedBefore.id).not.toBe(renamedAfter.id);

        for (const node of after.nodes) {
            if (node.id === renamedAfter.id) continue;
            if (node.kind === 'case-root') {
                // The root keeps its identity but re-points at the renamed
                // child: same id, child list differing only in that entry.
                expect(node.id).toBe(before.nodes[0].id);
                expect(node.childIds.filter((id) => id !== renamedAfter.id)).toEqual(
                    before.nodes[0].childIds.filter((id) => id !== renamedBefore.id)
                );
                continue;
            }
            expect(beforeById.get(node.id)).toBe(afterById.get(node.id));
        }
        expect(before.nodes).toHaveLength(after.nodes.length);
    });

    test('node ids derive from stable identity, not array position', () => {
        const before = buildFromFixture();

        const reordered = cloneEvidencePackage(LAB_FIXTURE);
        reordered.analyses = [...reordered.analyses].reverse();
        const after = buildCaseContext(reordered);

        const threadIds = (result) => result.nodes
            .filter((node) => node.kind === 'claim-thread' || node.kind === 'property-thread' || node.kind === 'unresolved')
            .map((node) => node.id)
            .sort();
        expect(threadIds(after)).toEqual(threadIds(before));
    });

    test('builder never mutates the canonical package or its reconciliation output', () => {
        const frozen = cloneEvidencePackage(LAB_FIXTURE);
        const digestBefore = evidencePackageDigest(frozen);
        buildCaseContext(frozen);
        expect(evidencePackageDigest(frozen)).toBe(digestBefore);
    });

    test('empty package degrades to a root-only graph instead of failing', () => {
        const { rootId, nodes, trace } = buildCaseContext({
            packageType: 'ClusterEvidencePackage',
            schemaVersion: 1,
            clusterId: 'St-0/2024',
            analyses: [],
        });
        expect(nodes).toHaveLength(1);
        expect(nodes[0].kind).toBe('case-root');
        expect(nodes[0].id).toBe(rootId);
        expect(trace.stats).toMatchObject({ facts: 0, threads: 0, unresolved: 0 });
    });

    test('builder rejects a non-object package', () => {
        expect(() => buildCaseContext(null)).toThrow(/must be a plain object/);
        expect(() => buildCaseContext([1])).toThrow(/must be a plain object/);
    });
});

describe('validateContextGraph guards (LC-1)', () => {
    function linkedPair() {
        const parent = createContextNode({ kind: 'case-root', key: 'root:x', title: 'Root' });
        const child = createContextNode({ kind: 'procedural-period', key: 'period:2024', title: 'Postupak 2024' });
        parent.childIds = [child.id];
        child.parentIds = [parent.id];
        return [parent, child];
    }

    test('accepts a well-formed assembly', () => {
        expect(() => validateContextGraph(linkedPair())).not.toThrow();
    });

    test('rejects dangling child links', () => {
        const [parent] = linkedPair();
        parent.childIds = ['cn-procedural-period-ghost-000000'];
        expect(() => validateContextGraph([parent])).toThrow(/dangling link/);
    });

    test('rejects unreciprocated links', () => {
        const [parent, child] = linkedPair();
        child.parentIds = [];
        expect(() => validateContextGraph([parent, child])).toThrow(/not reciprocated/);
    });

    test('rejects cycles', () => {
        const [parent, child] = linkedPair();
        child.childIds = [parent.id];
        parent.parentIds = [child.id];
        expect(() => validateContextGraph([parent, child])).toThrow(/cycle/);
    });

    test('rejects unreachable nodes and duplicate ids', () => {
        const [parent, child] = linkedPair();
        const orphan = createContextNode({ kind: 'unresolved', key: 'unlinked:x:amount:0', title: 'Orphan' });
        expect(() => validateContextGraph([parent, child, orphan])).toThrow(/unreachable/);
        expect(() => validateContextGraph([parent, child, { ...child }])).toThrow(/duplicate node id/);
    });

    test('rejects assemblies without exactly one case-root', () => {
        const [, child] = linkedPair();
        expect(() => validateContextGraph([child])).toThrow(/exactly one case-root/);
    });
});
