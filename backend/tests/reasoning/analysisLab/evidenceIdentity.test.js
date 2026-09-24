const {
    stableStringify,
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('../../../court-analysis/reasoning/analysisLab/evidenceIdentity');
const { validateClusterEvidencePackage } = require('../../../court-analysis/reasoning/evidencePackage');

const LAB_FIXTURE = require('../../fixtures/replays/analysis-lab/kerum-lab.json');

// Documented canonical hash of the frozen Lab fixture (LA-0 acceptance).
// If this changes, the fixture changed — update deliberately, never silently.
const DOCUMENTED_FIXTURE_DIGEST = 'e4e6ae8cfad31398ac21e10f9b10c4000efcfeb13a3c0df917c80bf1e788c921';

describe('analysisLab evidenceIdentity (LA-0)', () => {
    test('equivalent key-order objects have the same digest', () => {
        const a = { x: 1, y: { b: 2, a: 1 }, z: [1, 2, 3] };
        const b = { z: [1, 2, 3], y: { a: 1, b: 2 }, x: 1 };
        expect(stableStringify(a)).toBe(stableStringify(b));
        expect(evidencePackageDigest(a)).toBe(evidencePackageDigest(b));
    });

    test('changed source fact has a different digest', () => {
        const base = cloneEvidencePackage(LAB_FIXTURE);
        const mutated = cloneEvidencePackage(LAB_FIXTURE);
        mutated.analyses[0].amounts[0].amount = 9999999;
        expect(evidencePackageDigest(mutated)).not.toBe(evidencePackageDigest(base));
    });

    test('changed citation has a different digest', () => {
        const base = cloneEvidencePackage(LAB_FIXTURE);
        const mutated = cloneEvidencePackage(LAB_FIXTURE);
        mutated.analyses[1].citedFilingReferences.push('St-2/2013-9999');
        expect(evidencePackageDigest(mutated)).not.toBe(evidencePackageDigest(base));
    });

    test('reordered array has a different digest (order is meaningful)', () => {
        const base = cloneEvidencePackage(LAB_FIXTURE);
        const mutated = cloneEvidencePackage(LAB_FIXTURE);
        mutated.analyses = [...mutated.analyses].reverse();
        expect(evidencePackageDigest(mutated)).not.toBe(evidencePackageDigest(base));
    });

    test('mutating variant A clone cannot alter variant B or the frozen fixture', () => {
        const digestBefore = evidencePackageDigest(LAB_FIXTURE);
        const variantA = cloneEvidencePackage(LAB_FIXTURE);
        const variantB = cloneEvidencePackage(LAB_FIXTURE);

        variantA.analyses[0].amounts[0].amount = -1;
        variantA.coverage.gaps.push('injected gap');
        variantA.reconciliation.conflicts.length = 0;
        delete variantA.analyses[2];

        expect(evidencePackageDigest(LAB_FIXTURE)).toBe(digestBefore);
        expect(evidencePackageDigest(variantB)).toBe(digestBefore);
        expect(evidencePackageDigest(variantA)).not.toBe(digestBefore);
        expect(LAB_FIXTURE.analyses).toHaveLength(3);
    });

    test('named Kerum fixture yields the stable documented hash', () => {
        expect(evidencePackageDigest(LAB_FIXTURE)).toBe(DOCUMENTED_FIXTURE_DIGEST);
    });

    test('fixture exercises flat and ContextNode paths without acquisition/model calls', () => {
        // The fixture is a valid canonical evidence package: it must pass
        // the pipeline's own validation and flow through the real flat
        // synthesis-input assembly (this guards the fixture shape against
        // drifting from what the comparison boundary consumes).
        expect(validateClusterEvidencePackage(LAB_FIXTURE)).toEqual({ valid: true });
        // Cluster evidence + identities the DAG builder indexes (date, filing
        // reference, claim registry number, party/OIB, document role).
        expect(LAB_FIXTURE.clusterId).toBe('St-2/2013');
        expect(LAB_FIXTURE.entries.length).toBeGreaterThanOrEqual(3);
        expect(LAB_FIXTURE.analyses.length).toBeGreaterThanOrEqual(3);
        for (const analysis of LAB_FIXTURE.analyses) {
            expect(analysis.sourceDocumentLinkId).toBeTruthy();
            expect(analysis.documentRole).toBeTruthy();
        }
        // Facts/flows with lifecycle linkage (stable supersedes) plus one
        // identifier-less entry that must stay unresolved.
        const propertyItems = LAB_FIXTURE.analyses.flatMap((a) => a.propertyFlow || []);
        expect(propertyItems.some((item) => item.supersedes)).toBe(true);
        expect(propertyItems.some((item) => !item.claimRegistryNumber && !item.filingReference)).toBe(true);
        expect(LAB_FIXTURE.factLedger.length).toBeGreaterThanOrEqual(3);
        // Citations + citation-graph links.
        expect(LAB_FIXTURE.citationGraph.edges.length).toBeGreaterThanOrEqual(2);
        // Reconciliation + scope/coverage gaps.
        expect(LAB_FIXTURE.reconciliation.conflicts.length).toBeGreaterThanOrEqual(1);
        expect(LAB_FIXTURE.reconciliation.openQuestions.length).toBeGreaterThanOrEqual(1);
        expect(LAB_FIXTURE.coverage.complete).toBe(false);
        expect(LAB_FIXTURE.coverage.gaps.length).toBeGreaterThanOrEqual(1);
        expect(LAB_FIXTURE.scope.blockedConclusions.length).toBeGreaterThanOrEqual(1);
        // Retrieval source references (degraded rerank retained).
        expect(LAB_FIXTURE.retrieval.rerankStatus).toBeTruthy();
        expect(LAB_FIXTURE.chunks.length).toBeGreaterThanOrEqual(2);
        // Grounded/total source-claim counts present for the scorecard lane.
        expect(Number.isInteger(LAB_FIXTURE.coverage.groundedClaims)).toBe(true);
        expect(Number.isInteger(LAB_FIXTURE.coverage.totalClaims)).toBe(true);
    });

    test('fixture carries no raw PDFs, credentials, or model output dumps', () => {
        const serialized = stableStringify(LAB_FIXTURE);
        expect(serialized).not.toMatch(/api[_-]?key|GOOGLE_API_KEY|BEGIN PRIVATE|base64.*pdf/i);
        expect(serialized.length).toBeLessThan(256 * 1024);
    });

    test('stableStringify rejects non-JSON values instead of silently digesting them', () => {
        expect(() => stableStringify({ fn: () => {} })).toThrow();
        expect(() => evidencePackageDigest(null)).toThrow();
        expect(() => evidencePackageDigest([1, 2])).toThrow();
    });
});
