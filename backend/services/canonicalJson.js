// court-analysis/reasoning/analysisLab/evidenceIdentity.js
//
// LA-0 — canonical identity for frozen Lab evidence packages.
//
// A stable JSON serializer (object keys sorted, array order preserved) plus a
// SHA-256 digest, so all three Lab profiles can prove they ran from the exact
// same immutable input. Also exports an isolation clone helper so each variant
// gets its own mutable copy of the frozen package.
//
// Conventions:
// - Plain JSON values only (objects, arrays, strings, numbers, booleans,
//   null). `undefined` follows `JSON.stringify` semantics: omitted in objects,
//   `null` in arrays. Functions, symbols, and class instances are rejected.
// - Object key order is insignificant; array order is meaningful (claim lists,
//   timelines, and selected-evidence order all carry semantics).
// - No acquisition/model calls; no mutation of the input.

const crypto = require('crypto');

function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    // Realm-agnostic: `structuredClone` under Jest (vm sandbox) yields objects
    // whose prototype is another realm's `Object.prototype`, so identity
    // comparison against this realm's `Object.prototype` is unreliable.
    // A plain object has a prototype chain of depth 0 (`Object.create(null)`)
    // or depth 1 (some realm's `Object.prototype`); class instances and
    // built-in exotics (Date, Map, ...) always run deeper.
    const proto = Object.getPrototypeOf(value);
    if (proto === null) return true;
    return Object.getPrototypeOf(proto) === null;
}

function assertJsonValue(value, path) {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error(`evidenceIdentity: non-finite number at ${path}.`);
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
        return;
    }
    if (isPlainObject(value)) {
        for (const key of Object.keys(value)) {
            assertJsonValue(value[key], path ? `${path}.${key}` : key);
        }
        return;
    }
    throw new Error(`evidenceIdentity: non-JSON value at ${path || '$'} (${typeof value}).`);
}

/**
 * Serializes a JSON value to canonical form: object keys sorted
 * lexicographically (by UTF-16 code unit, as `Array.prototype.sort`
 * compares strings), array order preserved, no whitespace.
 *
 * @param {*} value - Plain JSON value.
 * @returns {string} Canonical JSON string.
 */
function stableStringify(value) {
    assertJsonValue(value, '$');
    return canonicalize(value);
}

function canonicalize(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'null'; // array slots only; object props skip
    switch (typeof value) {
        case 'string':
            return JSON.stringify(value);
        case 'number':
            return JSON.stringify(value);
        case 'boolean':
            return value ? 'true' : 'false';
        case 'object': {
            if (Array.isArray(value)) {
                return `[${value.map((item) => (item === undefined ? 'null' : canonicalize(item))).join(',')}]`;
            }
            const keys = Object.keys(value)
                .filter((key) => value[key] !== undefined)
                .sort();
            return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
        }
        default:
            throw new Error(`evidenceIdentity: non-JSON value (${typeof value}).`);
    }
}

/**
 * SHA-256 hex digest of the canonical serialization of an evidence package.
 *
 * @param {*} evidencePackage - Frozen evidence package object.
 * @returns {string} 64-char lowercase hex digest.
 */
function evidencePackageDigest(evidencePackage) {
    if (!evidencePackage || typeof evidencePackage !== 'object' || Array.isArray(evidencePackage)) {
        throw new Error('evidencePackageDigest: evidence package must be a plain object.');
    }
    return crypto.createHash('sha256').update(stableStringify(evidencePackage), 'utf8').digest('hex');
}

/**
 * Deep, isolated clone of an evidence package. Uses `structuredClone` when
 * available, otherwise a JSON round-trip. Either way the result shares no
 * references with the input.
 *
 * @param {*} evidencePackage - Frozen evidence package object.
 * @returns {*} Independent deep copy.
 */
function cloneEvidencePackage(evidencePackage) {
    if (evidencePackage === null || evidencePackage === undefined) return evidencePackage;
    if (typeof structuredClone === 'function') {
        return structuredClone(evidencePackage);
    }
    return JSON.parse(JSON.stringify(evidencePackage));
}

module.exports = {
    stableStringify,
    evidencePackageDigest,
    cloneEvidencePackage,
};
