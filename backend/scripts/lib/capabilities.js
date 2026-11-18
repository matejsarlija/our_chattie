'use strict';

const fs = require('fs');
const path = require('path');
const { buildPdfMessage, buildImageMessage, requestChat, extractAssistantText, DEFAULT_MODEL } = require('./openrouter-client');

const DEFAULT_CACHE_PATH = path.resolve(__dirname, '../../data/pdf-engine-bench/capabilities.json');
const TINY_PDF = Buffer.from('%PDF-1.1\n1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n2 0 obj<< /Type /Pages /Kids [] /Count 0 >>endobj\ntrailer<< /Root 1 0 R >>\n%%EOF\n');
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pS8AAAAASUVORK5CYII=';

function parseCapabilityOverride(value) {
    const match = /^([^:]+):(fileNative|imageInput):(true|false)$/i.exec(String(value || '').trim());
    if (!match) throw new Error(`Invalid --capability ${value}; expected <model>:fileNative|imageInput:true|false`);
    return { model: match[1], capability: match[2], value: match[3].toLowerCase() === 'true' };
}

function applyOverrides(model, values = []) {
    const result = {};
    for (const raw of values) {
        const item = typeof raw === 'string' ? parseCapabilityOverride(raw) : raw;
        if (item.model === model) result[item.capability] = item.value;
    }
    return result;
}

function capabilitiesFromMetadata(modelInfo = {}) {
    const modalities = modelInfo.architecture?.input_modalities;
    if (!Array.isArray(modalities)) return { fileNative: null, imageInput: null };
    return {
        fileNative: modalities.includes('file') ? true : null,
        imageInput: modalities.includes('image') ? true : null,
    };
}

function resolveCapabilities(model, { overrides = [], cached = {}, metadata = {} } = {}) {
    const probes = cached?.models?.[model]?.capabilities || cached?.[model]?.capabilities || {};
    // A probe that could not run (billing, auth, rate limit, transport) stores
    // null. Null means "unknown", so it must not shadow a metadata hint and
    // must not claim to be a probe result.
    const probed = (value) => (value === true || value === false ? value : null);
    const hints = capabilitiesFromMetadata(metadata);
    const manual = applyOverrides(model, overrides);
    return {
        fileNative: Object.hasOwn(manual, 'fileNative') ? manual.fileNative
            : probed(probes.fileNative) ?? hints.fileNative,
        imageInput: Object.hasOwn(manual, 'imageInput') ? manual.imageInput
            : probed(probes.imageInput) ?? hints.imageInput,
        sources: {
            fileNative: Object.hasOwn(manual, 'fileNative') ? 'manual' : probed(probes.fileNative) !== null ? 'probe' : hints.fileNative !== null ? 'metadata-hint' : 'unknown',
            imageInput: Object.hasOwn(manual, 'imageInput') ? 'manual' : probed(probes.imageInput) !== null ? 'probe' : hints.imageInput !== null ? 'metadata-hint' : 'unknown',
        },
    };
}

function readCache(filePath = DEFAULT_CACHE_PATH) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return { version: 1, models: {} }; }
}

function writeCache(cache, filePath = DEFAULT_CACHE_PATH) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

async function fetchModelMetadata(model, options = {}) {
    const url = `${options.baseUrl || 'https://openrouter.ai/api/v1'}/models`;
    const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 20000;
    const signal = timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(timeoutMs)
        : undefined;
    const response = await (options.fetchImpl || global.fetch)(url, {
        headers: options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {},
        ...(signal ? { signal } : {}),
    });
    if (!response.ok) throw new Error(`OpenRouter model metadata HTTP ${response.status}`);
    const body = await response.json();
    return (body.data || []).find((entry) => entry.id === model) || null;
}

// A probe only proves a capability *absent* when the provider actually answered
// about the input. Auth, billing, rate-limit, timeout and transport failures
// say nothing about the model, so they must stay unknown — recording them as
// "no PDF support" quietly hides a real blocker and mislabels the model for
// every later run that reads the cache.
const INDETERMINATE_STATUSES = new Set([401, 402, 403, 408, 409, 429]);

function probeVerdict(result) {
    if (!result?.error) return { capability: true, indeterminate: false };
    const status = result.status == null ? NaN : Number(result.status);
    const indeterminate = !Number.isFinite(status) || status >= 500 || INDETERMINATE_STATUSES.has(status);
    return { capability: indeterminate ? null : false, indeterminate };
}

function probeNote(verdict) {
    if (!verdict.indeterminate) return 'Native-engine rejection may reflect unsupported model input or provider availability; capability remains probe-negative pending review.';
    return 'Capability unknown: the probe never got an answer about the input (auth, billing, rate limit, timeout, or transport failure). Add credits or retry; do not treat this as a missing capability.';
}

// A rejection is only a statement about the model when we can tell it apart from
// a single provider's request-shape bug. OpenRouter routes to whichever provider
// it likes unless one is pinned, so a 400 carrying a provider_error_code means
// "this endpoint could not parse our body" — not "this model cannot take files".
function isProviderShapeError(result) {
    const meta = result?.error?.metadata;
    return Boolean(meta && (meta.provider_error_code || meta.provider_name));
}

/**
 * Decide what a failed probe actually tells us, cross-checking the model's
 * declared input modalities. Returns { capability, note }.
 */
function interpretProbe(result, modality, metadata) {
    const verdict = probeVerdict(result);
    if (verdict.capability === true) return { capability: true, note: null };
    if (verdict.indeterminate) return { capability: null, note: probeNote(verdict) };

    const modalities = metadata?.architecture?.input_modalities;
    const declared = Array.isArray(modalities) ? modalities.includes(modality) : null;

    if (declared === false) {
        return {
            capability: false,
            note: `Model metadata declares ${modalities.join(', ')} input, with no ${modality} support. The rejection is expected, not a routing artifact.`,
        };
    }
    if (declared === true && isProviderShapeError(result)) {
        return {
            capability: null,
            note: `Model metadata declares ${modality} input, but the routed provider (${result.error.metadata.provider_name || 'unnamed'}) rejected the request body. Pin a provider and re-probe before treating this as a model limitation.`,
        };
    }
    return { capability: false, note: probeNote(verdict) };
}

async function probeModel(model, options = {}) {
    const result = { date: new Date().toISOString(), capabilities: {}, details: {} };
    const provider = { allow_fallbacks: false, data_collection: 'deny' };
    const nativeBody = buildPdfMessage({
        model, filename: 'probe.pdf', bytes: TINY_PDF,
        prompt: 'Reply with the single word OK.', engine: 'native', maxTokens: 2, provider,
    });
    const native = await requestChat(nativeBody, { ...options, allowNativeProbe: true });
    const nativeVerdict = interpretProbe(native, 'file', options.metadata);
    result.capabilities.fileNative = nativeVerdict.capability;
    result.details.fileNative = {
        accepted: nativeVerdict.capability === true,
        status: native.status ?? null,
        provider: native.provider,
        error: native.error,
        note: nativeVerdict.note,
    };
    const image = await requestChat(buildImageMessage({ model, prompt: 'Reply OK.', imageDataUrl: TINY_PNG, maxTokens: 2, provider }), options);
    const imageVerdict = interpretProbe(image, 'image', options.metadata);
    result.capabilities.imageInput = imageVerdict.capability;
    result.details.imageInput = {
        accepted: imageVerdict.capability === true,
        status: image.status ?? null,
        provider: image.provider,
        error: image.error,
        note: imageVerdict.note,
    };
    return result;
}

async function getCapabilities(model, { overrides = [], cachePath = DEFAULT_CACHE_PATH, probe = false, ...options } = {}) {
    const cache = readCache(cachePath);
    let metadata = null;
    try { metadata = await fetchModelMetadata(model, options); } catch { /* Metadata is a hint, not a blocker. */ }
    let record = cache.models[model] || {};
    if (probe) {
        const probed = await probeModel(model, { ...options, metadata: metadata || {} });
        record = { ...probed, model };
        cache.models[model] = record;
        writeCache(cache, cachePath);
    }
    return { ...resolveCapabilities(model, { overrides, cached: cache, metadata: metadata || {} }), metadataAvailable: Boolean(metadata), probe: record.details || null };
}

module.exports = {
    DEFAULT_CACHE_PATH, TINY_PDF, TINY_PNG, parseCapabilityOverride,
    capabilitiesFromMetadata, resolveCapabilities, readCache, writeCache,
    fetchModelMetadata, probeModel, probeVerdict, interpretProbe, getCapabilities,
};
