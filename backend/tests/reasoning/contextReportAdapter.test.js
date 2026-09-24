const {
    buildProfileReportInput,
    selectContextNodes,
} = require('../../court-analysis/reasoning/contextReportAdapter');
const { buildSynthesisInput } = require('../../court-analysis/reasoning/synthesisInputBuilder');
const {
    stableStringify,
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../court-analysis/reasoning/analysisLab/evidenceIdentity');

const LAB_FIXTURE = require('../fixtures/replays/analysis-lab/kerum-lab.json');
const SUMMARY_ELIGIBLE_KINDS = new Set(['claim-thread', 'property-thread']);

function fixturePackage() {
    return cloneEvidencePackage(LAB_FIXTURE);
}

function packageAnalysisIds(pkg) {
    return new Set((pkg.analyses || []).map((analysis) => analysis.id));
}

function resolvingSummaryLlm() {
    // Answers every node from its own allow-list so all statements validate.
    return jest.fn(async ({ packet }) => JSON.stringify({
        statements: [{
            text: `Sažetak za ${packet.nodeId}.`,
            sourceDocumentIds: packet.availableIds.sourceDocumentIds.slice(0, 1),
            factIds: packet.availableIds.factIds.slice(0, 1),
            citationIds: [],
        }],
    }));
}

describe('contextReportAdapter baseline (LC-3)', () => {
    test('flat profile replays the old path byte-identically', async () => {
        const pkg = fixturePackage();
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'baseline-flat-v1',
        });
        const legacy = buildSynthesisInput(pkg, null, null);
        expect(stableStringify(input)).toBe(stableStringify(legacy));
        expect(trace).toMatchObject({ profileId: 'baseline-flat-v1', baseline: true });
        expect(input.meta.context).toBeUndefined();
        expect(trace.fragments.flatClaims.claims.length).toBeGreaterThan(0);
        expect(trace.fragments.contextNodes).toEqual([]);
    });

    test('unknown profile is rejected', async () => {
        await expect(buildProfileReportInput({
            evidencePackage: fixturePackage(),
            profileId: 'nope-v1',
        })).rejects.toThrow(/Unknown analysis-lab profile/);
    });

    test('adapter never mutates the supplied package', async () => {
        const pkg = fixturePackage();
        const digestBefore = evidencePackageDigest(pkg);
        await buildProfileReportInput({ evidencePackage: pkg, profileId: 'context-tree-v1' });
        await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: resolvingSummaryLlm(),
        });
        expect(evidencePackageDigest(pkg)).toBe(digestBefore);
    });
});

describe('contextReportAdapter context profiles (LC-3)', () => {
    test('DAG-only profile adds branch claims, makes zero summary calls', async () => {
        const pkg = fixturePackage();
        const summarizeLlm = jest.fn();
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-v1',
            summarizeLlm,
        });
        expect(summarizeLlm).not.toHaveBeenCalled();

        const flatCount = buildSynthesisInput(pkg, null, null).claims.length;
        expect(input.claims.length).toBeGreaterThan(flatCount);
        expect(trace).toMatchObject({ strategy: 'case-context', baseline: false });
        expect(typeof trace.rootId).toBe('string');
        expect(trace.selection.selected.length).toBeGreaterThan(0);
        expect(trace.claims).toMatchObject({ branch: expect.any(Number), derived: 0 });
        expect(input.meta.context).toMatchObject({
            profileId: 'context-tree-v1',
            rootId: trace.rootId,
            nodeSummaries: 'off',
        });
        // Same chronology + reconciliation ownership: timeline and flat meta
        // survive untouched underneath the layered claims.
        expect(input.timeline).toEqual(buildSynthesisInput(pkg, null, null).timeline);
        expect(input.meta.reconciliation).toBeDefined();
    });

    test('candidate trace carries graph, source references, and selection', async () => {
        const pkg = fixturePackage();
        const { trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: resolvingSummaryLlm(),
        });
        expect(trace.dag.stats).toMatchObject({ threads: 3, unresolved: 1 });
        expect(trace.dag.selections.length).toBe(3);
        const selectedFacts = trace.selection.selected.flatMap((entry) => entry.factIds);
        expect(selectedFacts).toContain('ledger-2');
        expect(trace.summaries.stats.calls).toBeGreaterThan(0);
        expect(trace.summaries.outcomes.every((outcome) => outcome.status === 'complete')).toBe(true);
        expect(trace.fragments.contextNodes.length).toBe(trace.selection.selected.length);
        expect(trace.fragments.contextNodes.some((node) => node.facts.some((fact) => fact.excerpt))).toBe(true);
        expect(trace.fragments.contextNodes.some((node) => node.citationIds.length > 0)).toBe(true);
    });

    test('derived claims retain source references without exposing them as finding evidence', async () => {
        const pkg = fixturePackage();
        const originals = packageAnalysisIds(pkg);
        const { input } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm: resolvingSummaryLlm(),
        });
        const derived = input.claims.filter((claim) => String(claim.id).startsWith('context-node-summary-'));
        expect(derived.length).toBeGreaterThan(0);
        for (const claim of derived) {
            expect(claim.evidence).toEqual([]);
            expect(claim.metadata).toMatchObject({ derived: true, supportsFinding: false });
            expect(claim.metadata.sourceReferences.length).toBeGreaterThan(0);
            expect(claim.metadata.sourceReferences.every((sourceId) => originals.has(sourceId))).toBe(true);
        }
    });

    test('node-summary failure still produces a candidate report with a partial trace', async () => {
        const pkg = fixturePackage();
        const summarizeLlm = jest.fn(async () => { throw new Error('provider down'); });
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm,
        });
        const flatCount = buildSynthesisInput(pkg, null, null).claims.length;
        expect(input.claims.length).toBeGreaterThan(flatCount);
        expect(input.claims.some((claim) => String(claim.id).startsWith('context-node-summary-'))).toBe(false);
        expect(trace.summaries.stats.calls).toBeGreaterThan(0);
        expect(trace.summaries.outcomes.every((outcome) => outcome.status === 'partial')).toBe(true);
        const eligibleSelected = trace.selection.selected.filter((node) => SUMMARY_ELIGIBLE_KINDS.has(node.kind));
        expect(new Set(trace.summaries.outcomes.map((outcome) => outcome.nodeId)).size)
            .toBe(eligibleSelected.length);
    });

    test('model-only statements with unresolvable citations never become claims', async () => {
        const pkg = fixturePackage();
        const summarizeLlm = jest.fn(async () => JSON.stringify({
            statements: [{
                text: 'Tvrdnja bez pokrića.',
                sourceDocumentIds: ['ghost-doc'],
                factIds: ['ghost-fact'],
                citationIds: ['ghost-filing'],
            }],
        }));
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-summarized-v1',
            summarizeLlm,
        });
        // LC-2 validation already rejects the ghost statement, so no derived
        // claim exists; the double-guard is asserted structurally anyway.
        expect(input.claims.some((claim) => String(claim.id).startsWith('context-node-summary-'))).toBe(false);
        expect(trace.summaries.outcomes.every((outcome) => outcome.status === 'partial')).toBe(true);
        expect(input.claims.some((claim) => JSON.stringify(claim).includes('ghost-doc'))).toBe(false);
    });

    test('summaries-on without a model seam stays offline with recorded omissions', async () => {
        const pkg = fixturePackage();
        const { input, trace } = await buildProfileReportInput({
            evidencePackage: pkg,
            profileId: 'context-tree-summarized-v1',
        });
        expect(trace.summaries.stats.calls).toBe(0);
        expect(trace.summaries.omitted.length).toBeGreaterThan(0);
        expect(trace.summaries.outcomes).toHaveLength(
            trace.selection.selected.filter((node) => SUMMARY_ELIGIBLE_KINDS.has(node.kind)).length
        );
        expect(trace.summaries.outcomes.every((outcome) => outcome.status === 'partial')).toBe(true);
        expect(input.claims.some((claim) => String(claim.id).startsWith('context-node-'))).toBe(true);
    });
});

describe('selectContextNodes (LC-3)', () => {
    test('orders threads before unresolved before periods and caps deterministically', () => {
        const nodes = [
            { id: 'p1', kind: 'procedural-period' },
            { id: 'u1', kind: 'unresolved' },
            { id: 't2', kind: 'claim-thread' },
            { id: 't1', kind: 'claim-thread' },
            { id: 'root', kind: 'case-root' },
        ];
        const { selected, omitted } = selectContextNodes(nodes, 2);
        expect(selected.map((node) => node.id)).toEqual(['t1', 't2']);
        expect(omitted.map((entry) => entry.nodeId)).toEqual(['u1', 'p1']);
        expect(omitted[0]).toMatchObject({ reason: 'context-node-budget-exhausted' });
    });
});
