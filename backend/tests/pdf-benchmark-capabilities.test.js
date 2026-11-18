'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveCapabilities, getCapabilities, probeModel, probeVerdict } = require('../scripts/lib/capabilities');
const { buildArmMatrix } = require('../scripts/lib/arms');

test('capabilities resolve manual override over probe over metadata hint', () => {
    const cached = { models: { 'vendor/model': { capabilities: { fileNative: false, imageInput: true } } } };
    const metadata = { architecture: { input_modalities: ['file', 'image'] } };
    expect(resolveCapabilities('vendor/model', { cached, metadata }).fileNative).toBe(false);
    expect(resolveCapabilities('vendor/model', { cached, metadata, overrides: ['vendor/model:fileNative:true'] })).toMatchObject({ fileNative: true, sources: { fileNative: 'manual' } });
    expect(resolveCapabilities('other/model', { metadata }).sources).toMatchObject({ fileNative: 'metadata-hint', imageInput: 'metadata-hint' });
});

test('matrix skips false and unknown capabilities but retains supported arms', () => {
    const arms = [{ id: 'text', requires: 'nothing' }, { id: 'raster', requires: 'imageInput' }, { id: 'native', requires: 'fileNative' }];
    const matrix = buildArmMatrix(['unsupported', 'supported', 'unknown'], arms, {
        unsupported: { fileNative: false, imageInput: false },
        supported: { fileNative: true, imageInput: true },
        unknown: {},
    });
    expect(matrix.filter((row) => row.model === 'unsupported' && row.status === 'SKIPPED')).toHaveLength(2);
    expect(matrix.filter((row) => row.model === 'supported' && row.status === 'READY')).toHaveLength(3);
    expect(matrix.filter((row) => row.model === 'unknown' && row.status === 'SKIPPED')).toHaveLength(2);
});

test('unknown model probes native and image before returning the capability matrix inputs', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-capability-test-'));
    const cachePath = path.join(tempDir, 'capabilities.json');
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
        requests.push({ url: String(url), body: options.body && JSON.parse(options.body) });
        if (String(url).endsWith('/models')) {
            const body = { data: [{ id: 'vendor/unknown', architecture: { input_modalities: ['text'] } }] };
            return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
        }
        const body = { model: 'vendor/unknown', provider: 'mock', choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }], usage: { total_tokens: 1 } };
        return { ok: true, json: async () => body, text: async () => JSON.stringify(body) };
    };
    try {
        const resolved = await getCapabilities('vendor/unknown', { cachePath, probe: true, fetchImpl, apiKey: 'mock-key' });
        expect(resolved.fileNative).toBe(true);
        expect(resolved.imageInput).toBe(true);
        const chatBodies = requests.filter((item) => item.body).map((item) => item.body);
        expect(chatBodies[0].plugins[0].pdf.engine).toBe('native');
        expect(chatBodies[1].messages[0].content.some((part) => part.type === 'image_url')).toBe(true);
        expect(JSON.parse(fs.readFileSync(cachePath, 'utf8')).models['vendor/unknown'].date).toBeTruthy();
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('a failed probe only counts as negative when the provider answered about the input', () => {
    expect(probeVerdict({ error: null })).toMatchObject({ capability: true, indeterminate: false });
    // Model/provider rejected the payload: that is a real negative.
    expect(probeVerdict({ error: { message: 'unsupported input' }, status: 400 })).toMatchObject({ capability: false, indeterminate: false });
    expect(probeVerdict({ error: { message: 'no such model' }, status: 404 })).toMatchObject({ capability: false, indeterminate: false });
    // Billing, auth, rate limit, upstream and transport failures teach us nothing.
    for (const status of [401, 402, 403, 408, 429, 500, 503]) {
        expect(probeVerdict({ error: { message: 'nope' }, status })).toMatchObject({ capability: null, indeterminate: true });
    }
    expect(probeVerdict({ error: 'fetch failed', status: null })).toMatchObject({ capability: null, indeterminate: true });
});

test('a billing-blocked probe is stored as unknown, not as missing capability', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-capability-test-'));
    const cachePath = path.join(tempDir, 'capabilities.json');
    const fetchImpl = async (url) => {
        if (String(url).endsWith('/models')) {
            const body = { data: [{ id: 'vendor/broke', architecture: { input_modalities: ['file', 'image'] } }] };
            return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
        }
        const body = { error: { message: 'Insufficient credits. This account never purchased credits.', code: 402 } };
        return { ok: false, status: 402, json: async () => body, text: async () => JSON.stringify(body) };
    };
    try {
        const probed = await probeModel('vendor/broke', { fetchImpl, apiKey: 'mock-key' });
        expect(probed.capabilities).toEqual({ fileNative: null, imageInput: null });
        expect(probed.details.fileNative).toMatchObject({ accepted: false, status: 402 });
        expect(probed.details.fileNative.note).toMatch(/capability unknown/i);
        expect(probed.details.fileNative.error.code).toBe(402);

        const resolved = await getCapabilities('vendor/broke', { cachePath, probe: true, fetchImpl, apiKey: 'mock-key' });
        // Unknown probe results must not shadow the metadata hint or claim a probe source.
        expect(resolved).toMatchObject({
            fileNative: true,
            imageInput: true,
            sources: { fileNative: 'metadata-hint', imageInput: 'metadata-hint' },
        });
        // Nulls are cached so the next run knows to probe again rather than trusting a false negative.
        expect(JSON.parse(fs.readFileSync(cachePath, 'utf8')).models['vendor/broke'].capabilities).toEqual({ fileNative: null, imageInput: null });
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test('a cached null capability never overrides a manual override or metadata hint', () => {
    const cached = { models: { 'vendor/model': { capabilities: { fileNative: null, imageInput: null } } } };
    const metadata = { architecture: { input_modalities: ['image'] } };
    expect(resolveCapabilities('vendor/model', { cached, metadata })).toMatchObject({
        fileNative: null, imageInput: true, sources: { fileNative: 'unknown', imageInput: 'metadata-hint' },
    });
    expect(resolveCapabilities('vendor/model', { cached, metadata, overrides: ['vendor/model:fileNative:true'] })).toMatchObject({
        fileNative: true, sources: { fileNative: 'manual' },
    });
});

test('a rejection is explained by declared modalities, not guessed at', () => {
    const { interpretProbe } = require('../scripts/lib/capabilities');
    const providerError = {
        error: { message: 'Provider returned error', code: 400, metadata: { provider_name: 'Relace', provider_error_code: 'json_parse_error' } },
        status: 400,
    };

    // Metadata says the model has no file modality: the rejection is expected.
    const noFile = interpretProbe(providerError, 'file', { architecture: { input_modalities: ['text', 'image', 'video'] } });
    expect(noFile.capability).toBe(false);
    expect(noFile.note).toMatch(/no file support/);

    // Metadata says the model does take files, but one provider could not parse
    // the body: that is a routing artifact, so the capability stays unknown.
    const routingArtifact = interpretProbe(providerError, 'file', { architecture: { input_modalities: ['text', 'file'] } });
    expect(routingArtifact.capability).toBeNull();
    expect(routingArtifact.note).toMatch(/pin a provider/i);

    // Same metadata, but a plain rejection with no provider fingerprint: trust it.
    const plain = interpretProbe({ error: { message: 'unsupported' }, status: 400 }, 'file', { architecture: { input_modalities: ['text', 'file'] } });
    expect(plain.capability).toBe(false);

    // No metadata at all: keep the negative, with the generic note.
    const blind = interpretProbe(providerError, 'file', {});
    expect(blind.capability).toBe(false);
    expect(blind.note).toMatch(/may reflect unsupported model input/i);

    // Accepted input is never annotated.
    expect(interpretProbe({ error: null }, 'image', {})).toEqual({ capability: true, note: null });
});

test('live benchmark capability resolution does not silently issue paid probes', async () => {
    const { resolveRunCapabilities } = require('../scripts/benchmark-pdf-engines');
    const getCapabilitiesMock = jest.fn().mockResolvedValue({ fileNative: null, imageInput: true });
    await resolveRunCapabilities('vendor/model', {
        dryRun: false,
        overrides: [],
        apiKey: 'mock-key',
        dependencies: { getCapabilities: getCapabilitiesMock },
    });
    expect(getCapabilitiesMock).toHaveBeenCalledWith('vendor/model', {
        overrides: [],
        probe: false,
        apiKey: 'mock-key',
    });
});
