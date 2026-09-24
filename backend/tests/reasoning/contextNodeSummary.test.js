const { buildCaseContext, collectContextFacts } = require('../../court-analysis/reasoning/caseContextBuilder');
const {
    SUMMARY_ELIGIBLE_KINDS,
    buildNodeSourcePacket,
    parseNodeSummaryResponse,
    summarizeContextNode,
    summarizeContextNodes,
    findingCitesOriginalEvidence,
} = require('../../court-analysis/reasoning/analysisLab/contextNodeSummary');
const { cloneEvidencePackage } = require('../../court-analysis/reasoning/analysisLab/evidenceIdentity');

const LAB_FIXTURE = require('../fixtures/replays/analysis-lab/kerum-lab.json');

function buildLab() {
    const pkg = cloneEvidencePackage(LAB_FIXTURE);
    const { nodes } = buildCaseContext(pkg);
    const facts = collectContextFacts(pkg);
    return { pkg, nodes, facts };
}

function threadNodes(nodes) {
    return nodes
        .filter((node) => SUMMARY_ELIGIBLE_KINDS.includes(node.kind))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function mockSummaryLlm(statements) {
    return jest.fn(async () => JSON.stringify({ statements }));
}

describe('contextNodeSummary packet and parsing (LC-2)', () => {
    test('packet is bounded and carries the node allow-list', () => {
        const { nodes, facts } = buildLab();
        const node = threadNodes(nodes)[0];
        const packet = buildNodeSourcePacket(node, facts, 6000);
        expect(packet.nodeId).toBe(node.id);
        expect(packet.facts.length).toBeGreaterThan(0);
        expect(packet.availableIds.sourceDocumentIds).toEqual(node.sourceDocumentIds);
        expect(JSON.stringify(packet).length).toBeLessThanOrEqual(6000 + 2000);
    });

    test('tiny packet budget truncates deterministically and records it', () => {
        const { nodes, facts } = buildLab();
        const node = threadNodes(nodes).find((candidate) => candidate.factIds.length > 1) || threadNodes(nodes)[0];
        const packet = buildNodeSourcePacket(node, facts, 10);
        expect(packet.truncated).toBe(true);
    });

    test('valid citation ids are accepted as references but never as grounding', () => {
        const { nodes } = buildLab();
        const node = nodes.find((candidate) => candidate.kind === 'property-thread');
        const parsed = parseNodeSummaryResponse(JSON.stringify({
            statements: [{
                text: 'Ustup s PROKURATORA na COAST.',
                sourceDocumentIds: ['lab-doc-02'],
                factIds: ['ledger-2'],
                citationIds: ['St-2/2013-1155'],
            }],
        }), node);
        expect(parsed.ok).toBe(true);
        expect(parsed.statements[0]).toMatchObject({ status: 'validated-reference', grounded: false });
    });

    test('unknown citation ids reject the statement', () => {
        const { nodes } = buildLab();
        const node = nodes.find((candidate) => candidate.kind === 'property-thread');
        const parsed = parseNodeSummaryResponse(JSON.stringify({
            statements: [{
                text: 'Nepostojeći izvor.',
                sourceDocumentIds: ['ghost-doc'],
                factIds: [],
                citationIds: [],
            }],
        }), node);
        expect(parsed.ok).toBe(false);
        expect(parsed.reason).toMatch(/no statement with valid evidence references/);
    });

    test('malformed responses are reported, never thrown', () => {
        const { nodes } = buildLab();
        const node = threadNodes(nodes)[0];
        expect(parseNodeSummaryResponse('not json at all {{{', node).ok).toBe(false);
        expect(parseNodeSummaryResponse(JSON.stringify({ nope: 1 }), node).ok).toBe(false);
    });
});

describe('summarizeContextNode (LC-2)', () => {
    test('successful summary attaches validated statements and keeps the raw node intact', async () => {
        const { nodes, facts } = buildLab();
        const node = nodes.find((candidate) => candidate.kind === 'property-thread');
        const summarizeLlm = mockSummaryLlm([{
            text: 'Ustup s PROKURATORA na COAST.',
            sourceDocumentIds: ['lab-doc-02'],
            factIds: ['ledger-2'],
            citationIds: ['St-2/2013-1155'],
        }]);
        const { node: summarized, outcome } = await summarizeContextNode(node, facts, { summarizeLlm });
        expect(outcome).toMatchObject({ status: 'complete', accepted: 1, rejected: 0, calls: 1 });
        expect(summarized.summary).toHaveLength(1);
        expect(summarized.summary[0]).toMatchObject({ status: 'validated-reference', grounded: false });
        expect(summarized.id).toBe(node.id);
        // The input node object is never mutated (frozen DAG nodes gain
        // summaries via copies only).
        expect(node.summary).toBeUndefined();
        expect(summarizeLlm).toHaveBeenCalledTimes(1);
    });

    test('unknown citations degrade to partial and retain the raw node', async () => {
        const { nodes, facts } = buildLab();
        const node = nodes.find((candidate) => candidate.kind === 'property-thread');
        const summarizeLlm = mockSummaryLlm([{
            text: 'Nepostojeći izvor.',
            sourceDocumentIds: ['ghost-doc'],
            factIds: [],
            citationIds: [],
        }]);
        const { node: retained, outcome } = await summarizeContextNode(node, facts, { summarizeLlm });
        expect(outcome.status).toBe('partial');
        expect(outcome.reason).toBe('invalid-summary');
        expect(retained.summary).toBeUndefined();
        expect(retained).toBe(node);
    });

    test('malformed model output preserves the raw node', async () => {
        const { nodes, facts } = buildLab();
        const node = threadNodes(nodes)[0];
        const summarizeLlm = jest.fn(async () => 'definitely not json {{{');
        const { node: retained, outcome } = await summarizeContextNode(node, facts, { summarizeLlm });
        expect(outcome).toMatchObject({ status: 'partial', reason: 'invalid-summary' });
        expect(retained.summary).toBeUndefined();
    });

    test('timeout preserves the raw node with a recorded reason', async () => {
        const { nodes, facts } = buildLab();
        const node = threadNodes(nodes)[0];
        const summarizeLlm = jest.fn(() => new Promise(() => {}));
        const { node: retained, outcome } = await summarizeContextNode(node, facts, {
            summarizeLlm,
            timeoutMs: 20,
        });
        expect(outcome.status).toBe('partial');
        expect(outcome.reason).toBe('call-failed');
        expect(outcome.detail).toMatch(/timed out/);
        expect(retained.summary).toBeUndefined();
    });

    test('transport failure preserves the raw node and never invents a summary', async () => {
        const { nodes, facts } = buildLab();
        const node = threadNodes(nodes)[0];
        const summarizeLlm = jest.fn(async () => { throw new Error('provider down'); });
        const { node: retained, outcome } = await summarizeContextNode(node, facts, { summarizeLlm });
        expect(outcome).toMatchObject({ status: 'partial', reason: 'call-failed' });
        expect(retained.summary).toBeUndefined();
    });

    test('ineligible kinds never reach the model', async () => {
        const { nodes, facts } = buildLab();
        const node = nodes.find((candidate) => candidate.kind === 'procedural-period');
        const summarizeLlm = jest.fn(async () => JSON.stringify({ statements: [] }));
        const { outcome } = await summarizeContextNode(node, facts, { summarizeLlm });
        expect(outcome).toMatchObject({ status: 'partial', reason: 'ineligible-kind' });
        expect(summarizeLlm).not.toHaveBeenCalled();
    });
});

describe('summarizeContextNodes budgets (LC-2)', () => {
    test('node cap attempts the first nodes in id order and omits the rest deterministically', async () => {
        const { nodes, facts } = buildLab();
        const eligible = threadNodes(nodes);
        expect(eligible.length).toBeGreaterThan(1);
        const summarizeLlm = mockSummaryLlm([{
            text: 'Sažetak.',
            sourceDocumentIds: [],
            factIds: [],
            citationIds: [],
        }]);
        // Empty id lists are rejected, so use per-node valid ids via seams.
        summarizeLlm.mockImplementation(async ({ nodeId }) => {
            const node = eligible.find((candidate) => candidate.id === nodeId);
            return JSON.stringify({
                statements: [{
                    text: `Sažetak za ${nodeId}.`,
                    sourceDocumentIds: node.sourceDocumentIds.slice(0, 1),
                    factIds: node.factIds.slice(0, 1),
                    citationIds: [],
                }],
            });
        });
        const onUsage = jest.fn();
        const result = await summarizeContextNodes(nodes, facts, {
            maxNodeCalls: 1,
            summarizeLlm,
            onUsage,
        });
        expect(result.stats).toMatchObject({ eligible: eligible.length, attempted: 1, calls: 1 });
        expect(result.omitted).toHaveLength(eligible.length - 1);
        expect(result.omitted[0]).toMatchObject({ reason: 'node-budget-exhausted' });
        // Deterministic: the attempted node is the first in id order.
        expect(result.outcomes).toHaveLength(eligible.length);
        expect(result.outcomes[0]).toMatchObject({ nodeId: eligible[0].id, status: 'complete' });
        expect(result.outcomes.slice(1).every((outcome) => outcome.status === 'partial')).toBe(true);
        expect(result.outcomes.slice(1).every((outcome) => outcome.reason === 'node-budget-exhausted')).toBe(true);
        expect(onUsage).toHaveBeenCalledTimes(1);
    });

    test('onUsage fires exactly once per summarized node', async () => {
        const { nodes, facts } = buildLab();
        const eligible = threadNodes(nodes);
        const summarizeLlm = jest.fn(async ({ nodeId }) => {
            const node = eligible.find((candidate) => candidate.id === nodeId);
            return JSON.stringify({
                statements: [{
                    text: 'Sažetak.',
                    sourceDocumentIds: node.sourceDocumentIds.slice(0, 1),
                    factIds: node.factIds.slice(0, 1),
                    citationIds: [],
                }],
            });
        });
        const onUsage = jest.fn();
        await summarizeContextNodes(nodes, facts, { maxNodeCalls: 2, summarizeLlm, onUsage });
        expect(summarizeLlm).toHaveBeenCalledTimes(2);
        expect(onUsage).toHaveBeenCalledTimes(2);
    });

    test('without a model seam every eligible node is omitted and nothing is called', async () => {
        const { nodes, facts } = buildLab();
        const eligible = threadNodes(nodes);
        const result = await summarizeContextNodes(nodes, facts, { maxNodeCalls: 4 });
        expect(result.stats.calls).toBe(0);
        expect(result.nodes).toEqual(nodes);
        result.nodes.forEach((node, index) => expect(node).toBe(nodes[index]));
        expect(result.omitted.every((entry) => entry.reason === 'summaries-unavailable')).toBe(true);
        expect(result.omitted).toHaveLength(eligible.length);
        expect(result.outcomes).toHaveLength(eligible.length);
        expect(result.outcomes.every((outcome) => (
            outcome.status === 'partial' && outcome.reason === 'summaries-unavailable'
        ))).toBe(true);
    });
});

describe('findingCitesOriginalEvidence (LC-2)', () => {
    const originals = new Set(['lab-doc-01', 'lab-doc-02', 'chunk-lab-01']);

    test('finding citing original evidence passes', () => {
        expect(findingCitesOriginalEvidence(
            { text: 'Nalaz', citations: [{ sourceId: 'lab-doc-02', text: 'citat' }] },
            originals
        )).toBe(true);
    });

    test('derived-only citations never satisfy the boundary', () => {
        expect(findingCitesOriginalEvidence(
            { text: 'Nalaz', citations: [{ sourceId: 'context-node-summary-1', text: 'sažetak' }] },
            originals
        )).toBe(false);
        expect(findingCitesOriginalEvidence({ text: 'Nalaz', citations: [] }, originals)).toBe(false);
        expect(findingCitesOriginalEvidence({ text: 'Nalaz' }, originals)).toBe(false);
    });
});
