const { validateClaim, validateEvidence, validateReport, validateEvent, validateTimelineItem, SCHEMA_VERSION } = require('../../court-analysis/reasoning/schema');

describe('Reasoning Schema Validator', () => {
    describe('Evidence Validation', () => {
        test('accepts valid evidence object', () => {
            const validEvidence = {
                sourceId: 'doc-123',
                text: 'According to the document...',
                page: 5
            };
            const result = validateEvidence(validEvidence);
            expect(result.valid).toBe(true);
        });

        test('rejects evidence without sourceId', () => {
            const invalidEvidence = {
                text: 'Missing source',
                page: 1
            };
            const result = validateEvidence(invalidEvidence);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/sourceId/);
        });

        test('rejects evidence without text', () => {
            const invalidEvidence = {
                sourceId: 'doc-123',
                page: 1
            };
            const result = validateEvidence(invalidEvidence);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/text/);
        });
    });

    describe('Claim Validation', () => {
        test('accepts valid claim with evidence', () => {
            const validClaim = {
                id: 'claim-1',
                text: 'The defendant is liable.',
                confidence: 'high',
                evidence: [{ sourceId: 'doc-1', text: 'quote' }]
            };
            const result = validateClaim(validClaim);
            expect(result.valid).toBe(true);
        });

        test('rejects claim without id', () => {
            const invalidClaim = {
                text: 'No ID',
                confidence: 'medium',
                evidence: []
            };
            const result = validateClaim(invalidClaim);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/id/);
        });

        test('rejects claim without valid confidence level', () => {
             const invalidClaim = {
                id: 'claim-1',
                text: 'Bad confidence',
                confidence: 'super-duper',
                evidence: [{ sourceId: 'doc-1', text: 'quote' }]
            };
            const result = validateClaim(invalidClaim);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/confidence/);
        });

        test('rejects claim without evidence array', () => {
            const invalidClaim = {
                id: 'claim-1',
                text: 'No evidence',
                confidence: 'low'
            };
            const result = validateClaim(invalidClaim);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/evidence/);
        });
        
         test('rejects claim with empty evidence array if strict', () => {
            // Assuming we want at least one piece of evidence for a valid claim in strict mode
            const invalidClaim = {
                id: 'claim-1',
                text: 'Empty evidence',
                confidence: 'low',
                evidence: []
            };
            const result = validateClaim(invalidClaim, { strictEvidence: true });
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/evidence/);
        });
    });

    describe('Event Validation', () => {
        test('accepts valid event', () => {
            const event = {
                date: '2023-10-01',
                description: 'Case filed.',
                evidence: []
            };
            const result = validateEvent(event);
            expect(result.valid).toBe(true);
        });

        test('accepts undated event (null)', () => {
            const event = {
                date: null,
                description: 'Undated event.',
                evidence: []
            };
            const result = validateEvent(event);
            expect(result.valid).toBe(true);
        });

        test('rejects event with invalid date type', () => {
            const event = {
                date: 12345, // Should be string or null
                description: 'Bad date.',
                evidence: []
            };
            const result = validateEvent(event);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/date/);
        });
    });

    describe('Report Timeline Item Validation', () => {
        test('accepts a report timeline event with citations', () => {
            const event = {
                date: '2023-10-01',
                description: 'Case filed.',
                citations: [{ source: 'd1', text: 'quote' }]
            };
            const result = validateTimelineItem(event);
            expect(result.valid).toBe(true);
        });

        test('accepts a report timeline event with empty citations', () => {
            const event = {
                date: null,
                description: 'Undated event.',
                citations: []
            };
            const result = validateTimelineItem(event);
            expect(result.valid).toBe(true);
        });

        test('rejects a report timeline event without description', () => {
            const event = {
                date: '2023-10-01',
                citations: []
            };
            const result = validateTimelineItem(event);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/description/);
        });

        test('rejects a report timeline event with non-array citations', () => {
            const event = {
                date: '2023-10-01',
                description: 'Case filed.',
                citations: { source: 'd1' }
            };
            const result = validateTimelineItem(event);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/citations/);
        });
    });

    describe('Report Validation', () => {
        test('accepts valid report structure', () => {
            const validReport = {
                schemaVersion: SCHEMA_VERSION,
                claims: [],
                findings: [],
                verifiedFindings: [],
                meta: { caseLimit: 5 }
            };
            const result = validateReport(validReport);
            expect(result.valid).toBe(true);
        });

        test('rejects report with wrong schema version', () => {
            const invalidReport = {
                schemaVersion: '0.0.0',
                claims: [],
                findings: [],
                meta: {}
            };
            const result = validateReport(invalidReport);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/version/);
        });

        test('rejects report missing required sections', () => {
            const invalidReport = {
                schemaVersion: SCHEMA_VERSION,
                // Missing claims
                findings: [],
                meta: {}
            };
            const result = validateReport(invalidReport);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/claims/);
        });

        test('rejects malformed verified findings', () => {
            const invalidReport = {
                schemaVersion: SCHEMA_VERSION,
                claims: [],
                findings: [],
                verifiedFindings: [{ confidence: 'certain' }],
                meta: {}
            };

            const result = validateReport(invalidReport);

            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/verified finding/);
        });

        test('accepts report with a valid timeline', () => {
            const validReport = {
                schemaVersion: SCHEMA_VERSION,
                claims: [],
                findings: [],
                timeline: [
                    { date: '2023-10-01', description: 'Case filed.', citations: [{ source: 'd1', text: 'quote' }] }
                ],
                meta: {}
            };

            const result = validateReport(validReport);
            expect(result.valid).toBe(true);
        });

        test('rejects report with malformed timeline', () => {
            const invalidReport = {
                schemaVersion: SCHEMA_VERSION,
                claims: [],
                findings: [],
                timeline: [{ date: '2023-10-01', citations: 'not-an-array' }],
                meta: {}
            };

            const result = validateReport(invalidReport);
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/timeline/);
        });
    });
});
