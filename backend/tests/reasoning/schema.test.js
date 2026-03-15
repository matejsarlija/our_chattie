const { validateClaim, validateEvidence, validateReport, validateEvent, SCHEMA_VERSION } = require('../../court-analysis/reasoning/schema');

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

    describe('Report Validation', () => {
        test('accepts valid report structure', () => {
            const validReport = {
                schemaVersion: SCHEMA_VERSION,
                claims: [],
                findings: [],
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
    });
});
