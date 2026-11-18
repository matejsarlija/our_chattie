const {
    collectProceduralEvents,
    reconcileProceduralEvents,
} = require('../../court-analysis/reasoning/proceduralFlow');

function analysis(id, proceduralEvents, citedFilingReferences = []) {
    return {
        id,
        fileName: `${id}.pdf`,
        proceduralEvents,
        citedFilingReferences,
    };
}

function appealPair(outcome) {
    return [
        analysis('appeal-doc', [{
            eventType: 'appeal',
            filingReference: 'St-1/2024-appeal',
            description: 'Appeal of first-instance decision',
            grounded: true,
        }]),
        analysis('decision-doc', [{
            eventType: 'appellate-decision',
            filingReference: 'St-1/2024-appellate',
            targetFilingReference: 'St-1/2024-appeal',
            outcome,
            description: `Appellate decision: ${outcome}`,
            grounded: true,
        }]),
    ];
}

describe('proceduralFlow', () => {
    test('collects extracted procedural events with stable source-scoped identities', () => {
        const source = [analysis('doc-a', [{
            eventType: 'appeal', filingReference: ' St-1/2024-A ', targetFilingReference: 'St-1/2024-B',
            description: 'Appeal', grounded: true, extraExtractionField: 'preserved',
        }])];
        const first = collectProceduralEvents(source);
        const withUnrelated = collectProceduralEvents([
            analysis('unrelated', [{ eventType: 'filing', description: 'Other' }]),
            ...source,
        ]);
        expect(first.count).toBe(1);
        expect(first.hasProceduralEvents).toBe(true);
        expect(first.events[0]).toEqual(expect.objectContaining({
            id: expect.any(String), analysisId: 'doc-a', fileName: 'doc-a.pdf',
            filingReference: 'St-1/2024-A', targetFilingReference: 'St-1/2024-B',
            grounded: true, extraExtractionField: 'preserved', citedFilingReferences: [],
        }));
        expect(withUnrelated.events.find((event) => event.analysisId === 'doc-a').id).toBe(first.events[0].id);
        expect(collectProceduralEvents(null)).toEqual({
            count: 0, events: [], hasProceduralEvents: false, metadataStubCount: 0, extractedEventCount: 0,
        });
    });

    test.each(['upheld', 'overturned', 'modified', 'remanded'])(
        'links appeal to appellate decision and derives %s status deterministically',
        (decisionOutcome) => {
            const flow = collectProceduralEvents(appealPair(decisionOutcome));
            const result = reconcileProceduralEvents(flow);
            expect(result.chains).toHaveLength(1);
            expect(result.chains[0].eventIds).toHaveLength(2);
            expect(result.chains[0].edges).toEqual(expect.arrayContaining([
                expect.objectContaining({ from: flow.events[0].id, to: flow.events[1].id }),
            ]));
            expect(result.statuses[flow.events[0].id]).toBe(decisionOutcome);
            expect(result.statuses[flow.events[1].id]).toBe(decisionOutcome);
            expect(result.events.map((event) => event.status)).toEqual([decisionOutcome, decisionOutcome]);
        }
    );
    test('metadata-only appeal and VTS ruling resolve without extracted analyses', () => {
        const flow = collectProceduralEvents([], [
            { index: 1, proceduralEvents: [{
                eventType: 'appeal', filingReference: 'St-2_2013-1214',
                appellateCaseNumbers: ['Pž-188/2026-3'], statedOutcome: 'unknown',
            }] },
            { index: 2, proceduralEvents: [{
                eventType: 'appellate-decision', filingReference: 'St-2/2013-1217',
                appellateCaseNumbers: ['Pž-188/2026-3'], statedOutcome: 'upheld',
            }] },
        ]);
        const result = reconcileProceduralEvents(flow);
        expect(flow.metadataStubCount).toBe(2);
        expect(flow.extractedEventCount).toBe(0);
        expect(result.chains).toHaveLength(1);
        expect(result.chains[0].status).toBe('upheld');
    });

    test('silence after an appeal is appealed-outcome-unknown, not pending or final', () => {
        const flow = collectProceduralEvents([], [{
            index: 0,
            proceduralEvents: [{ eventType: 'appeal', filingReference: 'St-2/2013-1214' }],
        }]);
        const result = reconcileProceduralEvents(flow);
        expect(result.chains[0]).toEqual(expect.objectContaining({
            status: 'appealed-outcome-unknown',
            finalityStated: false,
        }));
    });

    test('extraction refines a metadata stub by exact filing reference', () => {
        const flow = collectProceduralEvents([
            {
                ...analysis('doc-a', [{
                    eventType: 'appellate-decision', filingReference: 'St-2/2013-1217',
                    outcome: 'modified', grounded: true,
                }]),
                sourceEntryIndex: 0,
            },
        ], [{
            index: 0,
            proceduralEvents: [{
                eventType: 'appellate-decision', filingReference: 'St-2_2013-1217',
                appellateCaseNumbers: ['Pž-188/2026-3'], statedOutcome: 'unknown',
            }],
        }]);
        expect(flow.events).toHaveLength(1);
        expect(flow.events[0]).toEqual(expect.objectContaining({
            outcome: 'modified', grounded: true, source: 'metadata+extraction',
        }));
    });

    test('identifier links take precedence over disagreeing descriptions', () => {
        const flow = collectProceduralEvents([
            analysis('appeal', [{
                eventType: 'appeal', filingReference: 'A-1', targetFilingReference: 'D-1',
                description: 'Appeal of unrelated matter',
            }]),
            analysis('decision', [{
                eventType: 'decision', filingReference: 'D-1', outcome: 'granted',
                description: 'Decision in a different matter',
            }]),
        ]);
        const result = reconcileProceduralEvents(flow);
        expect(result.chains).toHaveLength(1);
        expect(result.chains[0].eventIds).toEqual(flow.events.map((event) => event.id));
    });

    test('an unresolved explicit target remains standalone and unresolved', () => {
        const flow = collectProceduralEvents([analysis('appeal', [{
            eventType: 'appeal', filingReference: 'A-1', targetFilingReference: 'missing-1',
        }])]);
        const result = reconcileProceduralEvents(flow);
        expect(result.chains).toHaveLength(1);
        expect(result.chains[0].eventIds).toEqual([flow.events[0].id]);
        expect(result.statuses[flow.events[0].id]).toBe('unresolved');
        expect(result.events[0].unresolvedReferences).toContain('missing-1');
    });

    test('uses owner-analysis citations and supplied citationGraph edges as exact links', () => {
        const flow = collectProceduralEvents([
            analysis('cited', [{ eventType: 'other', filingReference: 'Case-X/1' }]),
            analysis('citing', [{ eventType: 'appeal', filingReference: 'Case-X/2' }], [' case-x/1 ']),
        ]);
        const result = reconcileProceduralEvents(flow, {
            citationGraph: {
                edges: [{ from: 'citing', to: 'cited', via: 'CASE-X/1' }],
            },
        });
        expect(result.chains).toHaveLength(1);
        expect(result.chains[0].edges).toEqual(expect.arrayContaining([
            expect.objectContaining({ basis: 'citedFilingReferences' }),
            expect.objectContaining({ basis: 'citationGraph' }),
        ]));
    });

    test('similar descriptions alone never create links', () => {
        const flow = collectProceduralEvents([
            analysis('a', [{ eventType: 'appeal', filingReference: 'A-1', description: 'Appeal regarding claim 42' }]),
            analysis('b', [{ eventType: 'decision', filingReference: 'B-1', description: 'Appeal regarding claim 42' }]),
        ]);
        const result = reconcileProceduralEvents(flow);
        expect(result.chains).toHaveLength(2);
        expect(result.chains.every((chain) => chain.eventIds.length === 1)).toBe(true);
    });
});
