const { buildTimeline } = require('../../court-analysis/reasoning/timelineBuilder');

describe('TimelineBuilder', () => {
    test('sorts events by date ascending', () => {
        const events = [
            { description: 'Event 2', date: '2023-05-10', evidence: [] },
            { description: 'Event 1', date: '2023-01-01', evidence: [] },
            { description: 'Event 3', date: '2023-12-25', evidence: [] }
        ];
        const timeline = buildTimeline(events);
        expect(timeline[0].description).toBe('Event 1');
        expect(timeline[1].description).toBe('Event 2');
        expect(timeline[2].description).toBe('Event 3');
    });

    test('handles Croatian date formats (dd.mm.yyyy)', () => {
        const events = [
            { description: 'Late', date: '10.5.2023.', evidence: [] },
            { description: 'Early', date: '01.01.2023.', evidence: [] }
        ];
        const timeline = buildTimeline(events);
        expect(timeline[0].description).toBe('Early');
        expect(timeline[1].description).toBe('Late');
    });

    test('places undated events at the end', () => {
        const events = [
            { description: 'Dated', date: '2023-01-01', evidence: [] },
            { description: 'Undated', date: null, evidence: [] }
        ];
        const timeline = buildTimeline(events);
        expect(timeline[0].description).toBe('Dated');
        expect(timeline[1].description).toBe('Undated');
    });

    test('preserves evidence', () => {
        const events = [
            { 
                description: 'Event', 
                date: '2023-01-01', 
                evidence: [{ sourceId: '1', text: 'quote' }] 
            }
        ];
        const timeline = buildTimeline(events);
        expect(timeline[0].evidence).toHaveLength(1);
        expect(timeline[0].evidence[0].sourceId).toBe('1');
    });

    test('returns empty array for empty input', () => {
        expect(buildTimeline([])).toEqual([]);
    });
});
