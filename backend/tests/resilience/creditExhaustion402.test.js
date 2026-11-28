'use strict';

const { createCreditExhaustedLatch, isCreditExhaustedError } = require('../../llm/creditLatch');

describe('Resilience: HTTP 402 Credit Exhaustion Latch', () => {
    test('trips once on HTTP 402 and preserves partial-run degradation state', () => {
        const latch = createCreditExhaustedLatch();
        expect(latch.isTripped()).toBe(false);

        const err402 = Object.assign(new Error('Insufficient credits'), { status: 402 });
        expect(isCreditExhaustedError(err402)).toBe(true);

        latch.trip(err402);
        expect(latch.isTripped()).toBe(true);
        expect(latch.getReason()).toContain('Insufficient credits');
    });
});
