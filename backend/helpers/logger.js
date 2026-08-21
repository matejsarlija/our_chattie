// logger.js - Minimal structured JSON-lines logger (no dependencies).

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const DEFAULT_LEVEL = process.env.LOG_LEVEL || 'info';

const OIB_PATTERN = /\b\d{11}\b/g;
const KEY_PATTERN = /(["']?)(api[_-]?key|authorization|token|secret|password|google_api_key)(["']?)\s*[:=]\s*["']?[^\s"',;]+["']?/gi;
const KEY_REPLACEMENT = '$1$2$3:[REDACTED]';

function redactSecrets(value) {
    return String(value).replace(KEY_PATTERN, KEY_REPLACEMENT);
}

function redact(value) {
    return redactSecrets(String(value).replace(OIB_PATTERN, '[OIB]'));
}

function toJSON(entry) {
    return JSON.stringify(entry);
}

function log(level, scope, message, meta) {
    const threshold = LEVELS[DEFAULT_LEVEL] != null ? LEVELS[DEFAULT_LEVEL] : LEVELS.info;
    if (LEVELS[level] < threshold) return;

    const entry = {
        ts: new Date().toISOString(),
        level,
        scope,
        msg: redact(message),
    };
    if (meta && Object.keys(meta).length > 0) {
        entry.meta = redact(JSON.stringify(meta));
    }

    const line = toJSON(entry);
    if (level === 'error') {
        process.stderr.write(line + '\n');
    } else {
        process.stdout.write(line + '\n');
    }
}

const logger = {
    debug: (scope, message, meta) => log('debug', scope, message, meta),
    info: (scope, message, meta) => log('info', scope, message, meta),
    warn: (scope, message, meta) => log('warn', scope, message, meta),
    error: (scope, message, meta) => log('error', scope, message, meta),
    redact,
    redactSecrets,
};

module.exports = logger;
