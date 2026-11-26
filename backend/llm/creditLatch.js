'use strict';

const logger = require('../services/logger');

const CREDIT_EXHAUSTION_TEXT_RE = /insufficient credits|credits? exhausted|payment required|more credits|can only afford|\b402\b.*credit/i;

function isCreditExhaustedError(error) {
    if (!error) return false;
    if (error.code === 'ERR_PROVIDER_CREDITS_EXHAUSTED') return true;
    const status = error.status ?? error.response?.status ?? error.response?.data?.error?.code;
    if (Number(status) === 402) return true;
    const msg = typeof error === 'string'
        ? error
        : (error.message || error.response?.data?.error?.message || '');
    return CREDIT_EXHAUSTION_TEXT_RE.test(String(msg));
}

function createCreditExhaustedError(cause = null) {
    const message = cause?.message
        ? `OpenRouter credits exhausted (HTTP 402): ${cause.message}`
        : 'OpenRouter credits exhausted (HTTP 402).';
    const err = new Error(message);
    err.status = 402;
    err.code = 'ERR_PROVIDER_CREDITS_EXHAUSTED';
    err.reasonCode = 'provider-credits-exhausted';
    if (cause) err.cause = cause;
    return err;
}

function createCreditExhaustedLatch({ runId = null, sqliteStore = null, onTrip = null } = {}) {
    let tripped = false;
    let triggeredAt = null;
    let reason = null;

    function trip(error = null) {
        if (tripped) return false;
        tripped = true;
        triggeredAt = new Date().toISOString();
        reason = error?.message || 'OpenRouter credits exhausted (HTTP 402).';
        logger.agent.warn(`[CreditLatch] Tripped HTTP 402 latch for run=${runId || 'standalone'}: ${reason}`);

        if (runId && sqliteStore?.setRunPartialReason) {
            try {
                sqliteStore.setRunPartialReason({
                    id: runId,
                    partialReason: 'provider-credits-exhausted',
                });
            } catch {
                // Non-fatal persistence failure while tripping latch.
            }
        }
        if (typeof onTrip === 'function') {
            try {
                onTrip({ runId, triggeredAt, reason, error });
            } catch {
                // Listeners must never crash the latch.
            }
        }
        return true;
    }

    function guard(error) {
        if (!isCreditExhaustedError(error)) return false;
        trip(error);
        return true;
    }

    function assertNotTripped() {
        if (tripped) {
            throw createCreditExhaustedError(reason ? new Error(reason) : null);
        }
    }

    return {
        isTripped: () => tripped,
        getTriggeredAt: () => triggeredAt,
        getReason: () => reason,
        trip,
        guard,
        assertNotTripped,
    };
}

module.exports = {
    isCreditExhaustedError,
    createCreditExhaustedError,
    createCreditExhaustedLatch,
};
