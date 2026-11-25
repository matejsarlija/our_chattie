'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSqliteStore } = require('../services/sqliteStore');
const {
    isCreditExhaustedError,
    createCreditExhaustedLatch,
} = require('../llm/creditLatch');
const { shouldRetry } = require('../llm/retry');

describe('CreditExhaustedLatch', () => {
    let tmpDir;
    let sqliteStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-latch-'));
        sqliteStore = createSqliteStore({ dataDir: tmpDir });
    });

    afterEach(() => {
        sqliteStore?.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('identifies HTTP 402 and credit messages and never retries them', () => {
        const err402 = Object.assign(new Error('OpenRouter request failed (402): Insufficient credits'), { status: 402 });
        expect(isCreditExhaustedError(err402)).toBe(true);
        expect(shouldRetry(err402)).toBe(false);
    });

    test('trips once on first HTTP 402, persists runs.partial_reason, and blocks subsequent calls', async () => {
        const run = await sqliteStore.createAnalysisRun({
            queryType: 'oib',
            queryValue: '12345678901',
            scanDepth: 'balanced',
        });

        const onTrip = jest.fn();
        const latch = createCreditExhaustedLatch({
            runId: run.id,
            sqliteStore,
            onTrip,
        });

        expect(latch.isTripped()).toBe(false);
        expect(latch.guard(new Error('Random 500 timeout'))).toBe(false);
        expect(latch.isTripped()).toBe(false);

        const err402 = Object.assign(new Error('OpenRouter request failed (402): Payment Required'), { status: 402 });
        expect(latch.guard(err402)).toBe(true);
        expect(latch.isTripped()).toBe(true);
        expect(onTrip).toHaveBeenCalledTimes(1);

        // Idempotent second guard
        expect(latch.guard(err402)).toBe(true);
        expect(onTrip).toHaveBeenCalledTimes(1);

        const persisted = await sqliteStore.getAnalysisRun({ id: run.id });
        expect(persisted.partial_reason).toBe('provider_credits_exhausted');

        expect(() => latch.assertNotTripped()).toThrow(/credits exhausted/i);
    });
});
