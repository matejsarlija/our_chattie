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

const { redactSecrets } = require('./logger');

function stamp() {
    return `[${new Date().toISOString()}]`;
}

function redactStrings(args) {
    return args.map((arg) => (typeof arg === 'string' ? redactSecrets(arg) : arg));
}

module.exports = {
    log: (...args) => console.log(stamp(), ...redactStrings(args)),
    warn: (...args) => console.warn(stamp(), ...redactStrings(args)),
    error: (...args) => console.error(stamp(), ...redactStrings(args)),
};
