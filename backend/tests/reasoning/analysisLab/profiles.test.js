const {
    PROFILE_IDS,
    isKnownProfile,
    getProfile,
    listProfiles,
    snapshotProfile,
    snapshotExecutionSettings,
} = require('../../../court-analysis/reasoning/analysisLab/profiles');

describe('analysisLab profiles (LA-1)', () => {
    test('registry contains exactly the three built-in profiles', () => {
        expect(listProfiles()).toEqual([
            'baseline-flat-v1',
            'context-tree-v1',
            'context-tree-summarized-v1',
        ]);
        expect(PROFILE_IDS).toHaveLength(3);
    });

    test('all three profiles retain explicit strategies and expected summary modes', () => {
        expect(getProfile('baseline-flat-v1')).toMatchObject({
            contextStrategy: 'flat',
            nodeSummaries: 'off',
        });
        expect(getProfile('context-tree-v1')).toMatchObject({
            contextStrategy: 'case-context',
            nodeSummaries: 'off',
        });
        expect(getProfile('context-tree-summarized-v1')).toMatchObject({
            contextStrategy: 'case-context',
            nodeSummaries: 'on',
        });
    });

    test('DAG-only profile has zero node-call budget; summary profile has explicit bounded budgets', () => {
        expect(getProfile('context-tree-v1').budgets).toMatchObject({
            maxNodeCalls: 0,
        });
        const summarized = getProfile('context-tree-summarized-v1').budgets;
        expect(summarized.maxNodeCalls).toBeGreaterThan(0);
        expect(summarized.maxContextNodes).toBeGreaterThan(0);
        expect(Number.isInteger(summarized.maxNodeCalls)).toBe(true);
        expect(Number.isInteger(summarized.maxContextNodes)).toBe(true);
    });

    test('unknown profile ids are rejected', () => {
        expect(isKnownProfile('nope-v1')).toBe(false);
        expect(() => getProfile('nope-v1')).toThrow(/Unknown analysis-lab profile/);
        expect(() => snapshotProfile('nope-v1', { codeRevision: 'test' })).toThrow(/Unknown analysis-lab profile/);
        expect(() => snapshotProfile({ id: 'custom-v1' }, {})).toThrow(/Unknown analysis-lab profile/);
    });

    test('inline profile objects with extra fields are rejected (no user-editable profiles)', () => {
        expect(() =>
            snapshotProfile({ id: 'context-tree-v1', budgets: { maxNodeCalls: 99 } }, { codeRevision: 'test' })
        ).toThrow(/not user-editable/);
    });

    test('snapshots capture profile, models, versions, budgets, and code revision', () => {
        const snapshot = snapshotProfile('context-tree-summarized-v1', { codeRevision: 'abc123' });
        expect(snapshot.id).toBe('context-tree-summarized-v1');
        expect(snapshot.contextStrategy).toBe('case-context');
        expect(snapshot.nodeSummaries).toBe('on');
        expect(snapshot.budgets).toMatchObject({ maxContextNodes: 24, maxNodeCalls: 4 });
        expect(snapshot.codeRevision).toBe('abc123');
        expect(snapshot.modelRoles.synthesis.model).toBeTruthy();
        expect(snapshot.modelRoles.verify.model).toBeTruthy();
        expect(snapshot.promptVersions).toMatchObject({ contextNode: 'v1' });
        expect(snapshot.schemaVersions.evidence).toBe(1);
        expect(snapshot.schemaVersions.extraction).toBe(1);
        expect(snapshot.executionSnapshot.followUpVerification).toBe('off');
        // Serializable with no loss.
        expect(JSON.parse(JSON.stringify(snapshot))).toEqual(JSON.parse(JSON.stringify(snapshot)));
    });

    test('snapshots never persist credentials', () => {
        const snapshot = snapshotProfile('baseline-flat-v1', {
            codeRevision: 'abc123',
            GOOGLE_API_KEY: 'secret-key',
            apiKey: 'secret-key',
            gates: { claimJudge: 'on' },
            retrieval: { mode: 'standard', apiKey: 'secret-key' },
        });
        const serialized = JSON.stringify(snapshot);
        expect(serialized).not.toContain('secret-key');
        expect(serialized).not.toMatch(/apiKey|GOOGLE_API_KEY/i);
    });

    test('later mutation of config/profile objects cannot mutate an existing snapshot', () => {
        const runtime = {
            codeRevision: 'rev-1',
            featureFlags: { experimental: true },
            gates: { claimJudge: 'on' },
        };
        const snapshot = snapshotProfile('context-tree-v1', runtime);
        runtime.codeRevision = 'rev-2';
        runtime.featureFlags.experimental = false;
        runtime.gates.claimJudge = 'off';
        runtime.budgets = { maxNodeCalls: 999 };

        expect(snapshot.codeRevision).toBe('rev-1');
        expect(snapshot.featureFlags).toEqual({ experimental: true });
        expect(snapshot.executionSnapshot.gates.claimJudge).toBe('on');
        expect(snapshot.budgets).toMatchObject({ maxNodeCalls: 0 });
    });

    test('mutating a getProfile copy cannot corrupt the registry', () => {
        const copy = getProfile('context-tree-v1');
        copy.budgets.maxNodeCalls = 999;
        copy.contextStrategy = 'flat';
        expect(getProfile('context-tree-v1').budgets.maxNodeCalls).toBe(0);
        expect(getProfile('context-tree-v1').contextStrategy).toBe('case-context');
    });

    test('execution snapshot carries gates, retrieval/rerank, limits, and model ids', () => {
        const execution = snapshotExecutionSettings({
            gates: { claimJudge: 'off', significance: 'on', verification: 'standard' },
            retrieval: { mode: 'standard', topK: 24 },
            rerank: { mode: 'standard', status: 'fallback' },
            limits: { fullClaimLimit: 12 },
        });
        expect(execution.gates.claimJudge).toBe('off');
        expect(execution.retrieval.topK).toBe(24);
        expect(execution.rerank.status).toBe('fallback');
        expect(execution.limits.fullClaimLimit).toBe(12);
        expect(execution.models.synthesis.model).toBeTruthy();
        expect(JSON.stringify(execution)).not.toMatch(/apiKey|secret/i);
    });
});
