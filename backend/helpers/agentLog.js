// agentLog.js - Timestamped console output for pipeline agents.
//
// Agent-level progress lines ([Analyzer], [OCR], [Downloader], ...) are kept
// human-readable on purpose, but they previously carried no time context,
// which made long runs impossible to reconstruct ("when did OCR start?",
// "when did this file fail?"). Every line is stamped with an ISO timestamp —
// the same format as the structured logger's `ts` — so both output styles
// correlate on one wall clock. String arguments pass through secret-only
// redaction (API keys/tokens); OIBs are NOT masked — court records are public
// and the queried OIB is user-supplied, so readable logs beat scrubbing here.
// Non-string arguments (Error objects, result objects) are forwarded untouched
// so stack traces and inspect formatting survive.
//
// Volume control: routine per-file chatter (`.log`) is gated on the SAME
// `LOG_LEVEL` env var the structured logger reads — `.log` counts as the
// info tier, so `LOG_LEVEL=warn` (or higher) suppresses it while `.warn` and
// `.error` stay always-on (warnings/errors must never be silenced, only
// routine trace). Unset/unknown `LOG_LEVEL` behaves exactly as before (all
// lines print), so this is opt-in-to-quieter, not a behavior change.

const { redactSecrets } = require('./logger');

const AGENT_LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function agentLogThreshold() {
    const configured = process.env.LOG_LEVEL || 'info';
    return AGENT_LOG_LEVELS[configured] != null ? AGENT_LOG_LEVELS[configured] : AGENT_LOG_LEVELS.info;
}

function infoEnabled() {
    return AGENT_LOG_LEVELS.info >= agentLogThreshold();
}

function stamp() {
    return `[${new Date().toISOString()}]`;
}

function redactStrings(args) {
    return args.map((arg) => (typeof arg === 'string' ? redactSecrets(arg) : arg));
}

module.exports = {
    log: (...args) => {
        if (infoEnabled()) console.log(stamp(), ...redactStrings(args));
    },
    warn: (...args) => console.warn(stamp(), ...redactStrings(args)),
    error: (...args) => console.error(stamp(), ...redactStrings(args)),
};
