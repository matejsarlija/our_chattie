'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_MODEL, requestChat, extractAssistantText, ANALYSIS_MAX_TOKENS, DEFAULT_REQUEST_TIMEOUT_MS } = require('./lib/openrouter-client');
const { getCapabilities, fetchModelMetadata, parseCapabilityOverride, probeModel, readCache, resolveCapabilities, writeCache } = require('./lib/capabilities');
const { buildArmMatrix, makeAnalysisRegistry, analysisArmsForModel } = require('./lib/arms');
const { flattenManifest, selectSample } = require('./lib/selection');
const { computeTextMetrics, jsonValidity, summarizeTextMetrics, isEffectivelyEmpty, effectiveContentChars } = require('./lib/metrics');
const { scoreGold } = require('./lib/gold');
const { quoteGrounding } = require('./lib/grounding-metrics');
const { buildAnalysisPrompt, extractTextFromFile } = require('../court-analysis/agents/analysis-agent');
const { OIB_CASE_DOCS, SMOKE_DOC_IDS, assertRunScope } = require('./lib/lab-documents');
const { shouldBoundAnalysis, CHUNK_SIZE, CHUNK_OVERLAP } = require('./lib/bounded-analysis');
const { splitTextIntoChunks } = require('../court-analysis/reasoning/chunker');

function analysisDocumentSkipReason(arm, doc, args) {
    if (arm.id === 'local-text' && doc.textLayer === false) return 'no-text-layer';
    if (arm.id === 'local-raster' && doc.textLayer !== false) return 'not-a-scan';
    if (args.scope !== 'smoke' && args['engines-on-text-layer'] !== true
        && ['or-cloudflare', 'or-mistral-ocr'].includes(arm.id) && doc.textLayer === true) return 'text-layer';
    return null;
}

const FIXTURE_ROOT = path.resolve(__dirname, '../tests/fixtures/real-documents');
const DEFAULT_MANIFEST = path.join(FIXTURE_ROOT, '66124057408/manifest.json');
const OUTPUT_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');
const TRANSCRIPT_PROMPT = 'Transcribe the source faithfully. Preserve every word, number, date, identifier, and table row. Do not summarize.';
// USD per 1M tokens, for dry-run estimates only. Actual spend always comes from
// OpenRouter's reported `usage.cost`; these numbers must never enter a report as
// if they were measured.
//
// These are the prices of the *pinned* host, not the cheapest host advertising
// the model. GLM 5.3 Flash is listed at ~$0.03/$0.09 on the cheap fp4 hosts, but
// DEFAULT_PINS sends it to Z.AI at $0.15/$0.50 — a 5x difference that a budget
// estimate must not hide.
const MODEL_PRICES = {
    'z-ai/glm-5.3-flash': { input: 0.15, output: 0.50 },
    'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
};
// A model id is served by many hosts with different quantization (for GLM:
// relace/fp4, z-ai/fp8, wafer/nvfp4, ...). Pinning the first-party host keeps
// "the arm" from silently changing weights between runs.
const DEFAULT_PINS = {
    'z-ai/glm-5.3-flash': 'Z.AI',
    'google/gemini-2.5-flash': 'Google AI Studio',
};

function resolvePins(args = {}) {
    const pins = { ...DEFAULT_PINS };
    for (const raw of args.pin || []) {
        const index = String(raw).lastIndexOf('=');
        if (index <= 0) throw new Error(`--pin expects model=Provider, got "${raw}"`);
        pins[String(raw).slice(0, index)] = String(raw).slice(index + 1).trim();
    }
    return pins;
}

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (!match) continue;
        const key = match[1];
        if (match[2] !== undefined) {
            if (key === 'doc-id') args[key] = [...(args[key] || []), match[2]];
            else if (['models', 'docs', 'capability', 'provider', 'pin', 'arms', 'reasoning'].includes(key)) args[key] = [...(args[key] || []), ...match[2].split(',')];
            else args[key] = match[2];
        } else args[key] = true;
    }
    return args;
}

// Some challengers (GLM 5.3 Flash among them) think by default. Reasoning
// tokens are billed as completion tokens AND counted against `max_tokens`, so
// a thinking model sharing one budget with the analysis JSON truncates on
// longer documents. When reasoning is enabled, give it its own headroom so the
// answer keeps the full production budget.
const DEFAULT_REASONING_MAX_TOKENS = 8192;
const REASONING_EFFORTS = new Set(['low', 'medium', 'high']);

// Page images are expensive and slow, and production never reads more than its
// own OCR cap. The bench mirrors that cap instead of inventing a smaller one.
const RASTER_MAX_PAGES_DEFAULT = 20;

function parseReasoningArg(value) {
    if (value === undefined || value === true) return null;
    const raw = String(value).trim().toLowerCase();
    if (!raw || raw === 'default' || raw === 'provider') return null;
    if (raw === 'off' || raw === 'none' || raw === 'false') return { enabled: false };
    if (REASONING_EFFORTS.has(raw)) return { effort: raw };
    throw new Error(`--reasoning expects off|low|medium|high|default, got "${value}"`);
}

function describeReasoning(reasoning) {
    if (!reasoning) return 'provider default';
    if (reasoning.enabled === false) return 'off';
    return reasoning.effort ? `effort=${reasoning.effort}` : 'on';
}

const negative = (reasoning) => Boolean(reasoning && reasoning.enabled !== false);
const reasoningBudget = (reasoning, tokens) => (negative(reasoning) ? tokens : 0);

// A bare `--reasoning=low` sets the level for every model; a
// `--reasoning=<model>:low` form narrows it to one. The bare form is tried
// first so a typo like `hihg` still reads as a bad effort level instead of
// being silently reinterpreted as a model name.
function classifyReasoningArg(value) {
    try {
        return { model: null, reasoning: parseReasoningArg(value) };
    } catch (error) {
        const text = String(value);
        const index = text.lastIndexOf(':');
        if (index <= 0) throw error;
        return { model: text.slice(0, index), reasoning: parseReasoningArg(text.slice(index + 1)) };
    }
}

// `--reasoning=low` applies to every model; `--reasoning=<model>:low` overrides
// just that model. A model with no setting keeps its provider default, which is
// what production actually sees — so overriding the baseline by accident is
// visible in the log and recorded in run.json instead of silently changing the
// reference condition.
function resolveReasoningByModel(args, models, { baseline = null } = {}) {
    const raw = args.reasoning == null ? [] : [].concat(args.reasoning);
    let global = null;
    const overrides = new Map();
    for (const item of raw) {
        const spec = classifyReasoningArg(item);
        if (spec.model) overrides.set(spec.model, spec.reasoning);
        else global = spec.reasoning;
    }
    // A `<model>:<effort>` override for a model that is not in this run is
    // almost always a typo, and silently ignoring it would leave the model on
    // the provider default while the operator believes it was configured.
    const orphan = [...overrides.keys()].filter((model) => !models.includes(model));
    if (orphan.length) throw new Error(`--reasoning names model(s) not in this run: ${orphan.join(', ')}`);
    const byModel = {};
    for (const model of models) byModel[model] = overrides.has(model) ? overrides.get(model) : global;
    return { byModel, baseline, global, overridesBaseline: baseline ? overrides.has(baseline) : false };
}

// `usage` is where a slow call explains itself: a model that spends 12k tokens
// thinking looks identical to a stalled connection until you read this.
function usageSummary(usage) {
    const completion = Number(usage?.completion_tokens ?? usage?.completionTokens);
    if (!Number.isFinite(completion)) return '';
    const reasoning = Number(usage?.completion_tokens_details?.reasoning_tokens ?? usage?.reasoning_tokens ?? 0);
    return ` · ${completion} out tok${Number.isFinite(reasoning) && reasoning > 0 ? ` (${reasoning} reasoning)` : ''}`;
}

function createRunId() { return `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(4).toString('hex')}`; }

function formatSeconds(ms) {
    if (!Number.isFinite(ms)) return '?';
    return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(value) {
    return Number.isFinite(value) ? `$${value.toFixed(4)}` : 'cost unreported';
}

function shortDocLabel(docId) {
    const value = String(docId || 'document');
    const separator = value.indexOf(':');
    if (separator < 0) return value.length > 30 ? `${value.slice(0, 29)}…` : value;
    const prefix = value.slice(0, separator + 1);
    const name = value.slice(separator + 1).replace(/\.pdf$/i, '');
    const limit = Math.max(1, 30 - prefix.length);
    return `${prefix}${name.length > limit ? `${name.slice(0, limit - 1)}…` : name}`;
}

function shortModelLabel(model) {
    return String(model || 'model').split('/').pop();
}

function briefError(value) {
    if (!value) return '';
    const message = typeof value === 'string' ? value : value.message || JSON.stringify(value);
    return String(message).replace(/\s+/g, ' ').trim().slice(0, 600);
}

// Operator-facing progress goes to stderr (stdout stays machine-readable JSON)
// and to a `progress.log` inside the run folder. If a provider stalls, the last
// line says which cell and which request was in flight.
function createBenchLogger({ stream = process.stderr, debug = false, verbose = false, logFile = null } = {}) {
    const lastTerminalHeartbeat = new Map();
    const write = (message, { terminal = true } = {}) => {
        const line = `[bench ${new Date().toISOString().slice(11, 23)}] ${message}`;
        if (terminal) stream.write(`${line}\n`);
        if (logFile) {
            try { fs.appendFileSync(logFile, `${line}\n`, { mode: 0o600 }); } catch { /* Console logging still works. */ }
        }
    };
    return {
        info: write,
        debug(message) { if (debug) write(`debug · ${message}`); },
        event(event) {
            const who = event.label || event.model || 'request';
            if (event.phase === 'start') {
                write(`request → ${who} · attempt ${event.attempt} · engine=${event.engine || 'text'} · timeout=${formatSeconds(event.timeoutMs)} · providers=${(event.providerOrder || []).join(',') || 'default'} · max_tokens=${event.maxTokens ?? 'default'}`, { terminal: verbose });
            } else if (event.phase === 'heartbeat') {
                const key = `${who}:${event.attempt}`;
                const interval = Math.floor(event.elapsedMs / 30_000);
                const showInTerminal = interval > 0 && lastTerminalHeartbeat.get(key) !== interval;
                if (showInTerminal) lastTerminalHeartbeat.set(key, interval);
                write(`waiting · ${who} · attempt ${event.attempt} · ${formatSeconds(event.elapsedMs)} elapsed · stage=${event.stage || 'unknown'}`, { terminal: verbose || showInTerminal });
            } else if (event.phase === 'headers') {
                write(`response headers · ${who} · attempt ${event.attempt} · status=${event.status} · ${formatSeconds(event.elapsedMs)} · requestId=${event.requestId || 'unreported'}`, { terminal: verbose });
            } else if (event.phase === 'retry') {
                write(`retry · ${who} · attempt ${event.attempt} · status=${event.status ?? 'transport'} · in ${event.delayMs}ms · ${event.error}`);
                if (event.diagnostics) write(`transport diagnostics · ${who} · attempt ${event.attempt} · ${JSON.stringify(event.diagnostics)}`, { terminal: verbose });
            } else if (event.phase === 'end') {
                const suffix = event.error ? ` · error=${event.error}` : ` · provider=${event.provider || 'unknown'} · ${formatCost(event.cost)}${event.finishReason ? ` · finish=${event.finishReason}` : ''}`;
                write(`request ← ${who} · attempt ${event.attempt} · ${formatSeconds(event.latencyMs)}${suffix}`, { terminal: verbose });
                if (event.diagnostics) write(`transport diagnostics · ${who} · attempt ${event.attempt} · ${JSON.stringify(event.diagnostics)}`, { terminal: true });
                lastTerminalHeartbeat.delete(`${who}:${event.attempt}`);
            }
        },
    };
}

function loadDocuments(args) {
    const requested = [...(args['doc-id'] || []), ...(args.docs || [])];
    const manifestPath = path.resolve(args.manifest || DEFAULT_MANIFEST);
    if (!fs.existsSync(manifestPath)) {
        if (!requested.length) throw new Error(`Fixture manifest missing: ${manifestPath}; use --docs=<local.pdf,...> or --manifest=...`);
        return requested.map((item) => {
            const resolved = path.resolve(item);
            if (!fs.existsSync(resolved) || path.extname(resolved).toLowerCase() !== '.pdf') throw new Error(`Missing local PDF: ${item}`);
            return { docId: path.basename(resolved), title: path.basename(resolved), filePath: resolved, pages: null, extraction: {} };
        });
    }
    const fixtureRoot = path.dirname(manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const docs = flattenManifest(manifest, fixtureRoot);
    if (!docs.length) throw new Error('Manifest contains no available local PDF documents');
    if (!requested.length) return docs;
    const byId = new Map(docs.flatMap((doc) => [[doc.docId, doc], [doc.entryName, doc], [path.basename(doc.filePath), doc]]));
    return requested.map((item) => {
        const found = byId.get(item);
        if (found) return found;
        const resolved = path.resolve(item);
        if (!fs.existsSync(resolved) || path.extname(resolved).toLowerCase() !== '.pdf') throw new Error(`Unknown --docs document or missing local PDF: ${item}`);
        return { docId: path.basename(resolved), title: path.basename(resolved), filePath: resolved, pages: null, extraction: {} };
    });
}

function resolveRunDocuments(args = {}, scope = 'pilot') {
    const explicitSelection = Boolean(args.docs?.length || args['doc-id']?.length || (args.manifest && path.resolve(args.manifest) !== DEFAULT_MANIFEST));
    const corpus = explicitSelection
        ? loadDocuments(args)
        : loadDocuments({ ...args, 'doc-id': OIB_CASE_DOCS.map((doc) => doc.docId) });
    const docs = explicitSelection
        ? corpus
        : scope === 'smoke'
            ? SMOKE_DOC_IDS.map((id) => corpus.find((d) => d.docId === id)).filter(Boolean)
            : args.sample
                ? selectSample(corpus, Number(args.sample), Number(args.seed || 1))
                : corpus;
    if (!docs.length) throw new Error('No documents selected');
    return docs;
}

async function inspectPdfPages(doc, extractText = extractTextFromFile) {
    if (Number.isInteger(doc.pages) && doc.pages > 0) return doc.pages;
    const extraction = await extractText(doc.filePath);
    const pages = Number(extraction?.pages);
    if (!Number.isInteger(pages) || pages < 1) throw new Error(`Could not verify a positive page count for ${doc.filePath}; refusing to bypass the live page cap.`);
    return pages;
}

function capDocuments(docs, args) {
    const maxDocs = args['max-docs'] != null ? Number(args['max-docs']) : Infinity;
    if (docs.length > maxDocs) throw new Error(`Document cap exceeded: ${docs.length} > ${maxDocs}`);
    return docs;
}

async function resolveRunCapabilities(model, { dryRun, overrides = [], apiKey, dependencies = {} } = {}) {
    const resolve = dependencies.resolveCapabilities || resolveCapabilities;
    if (dryRun) {
        const cache = (dependencies.readCache || readCache)();
        let metadata = null;
        try { metadata = await (dependencies.fetchModelMetadata || fetchModelMetadata)(model, { apiKey }); } catch { /* Metadata is a hint, not a blocker. */ }
        return resolve(model, { overrides, cached: cache, metadata: metadata || {} });
    }
    return (dependencies.getCapabilities || getCapabilities)(model, { overrides, probe: false, apiKey });
}

function summarizeExtractionRows(rows) {
    const cells = new Map();
    for (const row of rows) {
        if (row.planned || row.status === 'SKIPPED') continue;
        const arm = row.arm || row.transcriptArm;
        const model = row.model || row.extractionModel;
        const key = `${arm} | ${model} | ${row.documentType}`;
        if (!cells.has(key)) cells.set(key, {
            arm, model, engine: row.engine || null, documentType: row.documentType,
            N: 0, answered: 0, errors: 0, validJson: 0, truncated: 0,
            ownGrounded: 0, ownQuotes: 0,
            goldScored: 0, goldPending: 0, goldReason: null, gold: {},
        });
        const cell = cells.get(key);
        const failed = row.failedCall != null
            ? row.failedCall === true
            // Older artifacts have no failedCall flag; an invalid-JSON message is
            // a model failure, anything else is a transport/provider failure.
            : (row.errors || []).length > 0 && !/^Invalid JSON/i.test(row.errors[0]);
        cell.N += 1;
        cell.errors += failed ? 1 : 0;
        // An earlier OCR request may fail even when the final analysis answers.
        // Track request reliability independently from answer/JSON quality.
        const answered = !failed || row.json?.valid === true || row.json?.truncated === true
            || row.textLength > 0 || Boolean(String(row.text || '').trim());
        cell.answered += answered ? 1 : 0;
        cell.validJson += answered && row.json?.valid ? 1 : 0;
        cell.truncated += answered && row.json?.truncated ? 1 : 0;
        cell.ownGrounded += row.quoteGroundingOwn?.grounded || 0;
        cell.ownQuotes += row.quoteGroundingOwn?.total || 0;
        if (row.goldAccuracy?.complete !== true) {
            // Distinguish "no gold folder", "gold exists but not verified" and
            // "scored", so the UI never prints 0% for an unmeasured document.
            if (row.goldAccuracy) {
                cell.goldPending += 1;
                cell.goldReason = cell.goldReason || row.goldAccuracy.reason || null;
            }
            continue;
        }
        cell.goldScored += 1;
        for (const [field, metric] of Object.entries(row.goldAccuracy || {})) {
            if (field === 'complete') continue;
            if (!cell.gold[field]) cell.gold[field] = { truePositive: 0, predicted: 0, reference: 0, N: 0 };
            const counts = metric.counts || {};
            cell.gold[field].truePositive += counts.truePositive || 0;
            cell.gold[field].predicted += counts.predicted || 0;
            cell.gold[field].reference += counts.reference || 0;
            cell.gold[field].N += 1;
        }
    }
    return [...cells.values()].map((cell) => ({
        ...cell,
        goldStatus: cell.goldScored ? 'scored' : cell.goldPending ? 'incomplete' : 'none',
        goldAccuracy: Object.fromEntries(Object.entries(cell.gold).map(([field, counts]) => [field, {
            ...counts,
            precision: counts.predicted ? counts.truePositive / counts.predicted : counts.reference === 0 ? 1 : 0,
            recall: counts.reference ? counts.truePositive / counts.reference : counts.N ? 1 : null,
        }])),
        validRate: cell.answered ? cell.validJson / cell.answered : null,
        ownGroundingRate: cell.ownQuotes ? cell.ownGrounded / cell.ownQuotes : null,
        gold: undefined,
    }));
}
function summarizeRows(rows) {
    const groups = new Map();
    for (const row of rows) {
        if (row.planned || row.status === 'SKIPPED') continue;
        const key = `${row.arm} | ${row.model || 'model-independent'} | ${row.documentType}`;
        if (!groups.has(key)) groups.set(key, { arm: row.arm, model: row.model || null, documentType: row.documentType, N: 0, errors: 0, pages: 0, costedCells: 0, costedPages: 0, costs: [], latencies: [], providers: new Set() });
        const group = groups.get(key);
        group.N += 1;
        group.errors += row.errors?.length ? 1 : 0;
        group.pages += row.pages || 0;
        if (row.costIncomplete || !Number.isFinite(row.cost)) group.incompleteCostCells = (group.incompleteCostCells || 0) + 1;
        if (Number.isFinite(row.cost) && !row.costIncomplete) {
            group.costs.push(row.cost);
            group.costedCells += 1;
            group.costedPages += row.pages || 0;
        }
        if (Number.isFinite(row.latency)) group.latencies.push(row.latency);
        if (row.provider) group.providers.add(row.provider);
    }
    return [...groups.values()].map((group) => ({
        ...group,
        providers: [...group.providers],
        reportedCostCells: group.costedCells,
        incompleteCostCells: group.incompleteCostCells || 0,
        costPerPage: group.costedPages ? group.costs.reduce((a, b) => a + b, 0) / group.costedPages : null,
        costPerCell: group.costedCells ? group.costs.reduce((a, b) => a + b, 0) / group.costedCells : null,
        latencyN: group.latencies.length,
        p50Latency: percentile(group.latencies, 0.5),
        minLatency: group.latencies.length ? Math.min(...group.latencies) : null,
        maxLatency: group.latencies.length ? Math.max(...group.latencies) : null,
        // Three repeats are the minimum requested for a tail estimate; at n=3
        // nearest-rank p95 is the maximum, so reports expose the sample count.
        p95Latency: group.latencies.length >= MIN_SAMPLES_FOR_P95 ? percentile(group.latencies, 0.95) : null,
        errorRate: group.N ? group.errors / group.N : 0,
    }));
}

// With fewer than three observations, p95 is too unstable to report.
const MIN_SAMPLES_FOR_P95 = 3;

function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.ceil(p * sorted.length) - 1];
}

function documentType(doc) { return `${doc.textLayer ? 'text-layer' : 'scan'} / ${doc.pageBucket || 'unknown-pages'} / ${doc.tableHeavy ? 'table-heavy' : 'other'}`; }

function buildExtractionBody(model, promptOrText, prompt) {
    const content = prompt !== undefined ? prompt : promptOrText;
    return {
        model,
        messages: [{ role: 'user', content }],
        max_tokens: 12288,
        stream: false,
    };
}

function createCostGuard(limit) {
    let actual = 0;
    let estimated = 0;
    return {
        add(reportedCost, estimatedParserFee = 0) {
            if (Number.isFinite(reportedCost)) actual += reportedCost;
            else if (Number.isFinite(estimatedParserFee)) estimated += estimatedParserFee;
            const total = actual + estimated;
            if (total > limit) {
                const error = new Error(`Cost cap basis exceeded: $${total.toFixed(4)} > $${limit}`);
                error.code = 'COST_CAP_EXCEEDED';
                return error;
            }
            return null;
        },
        total() { return actual; },
        estimated() { return estimated; },
        // Actual spend plus the per-page parser fees the provider did not
        // report. This is the honest total, not just the part that came back
        // itemized, so it is named for what it is.
        spendTotal() { return actual + estimated; },
    };
}

function loadGoldByDoc(directory) {
    if (!directory) return new Map();
    const resolved = path.resolve(directory);
    const files = fs.statSync(resolved).isDirectory()
        ? fs.readdirSync(resolved).filter((name) => name.endsWith('.json')).map((name) => path.join(resolved, name))
        : [resolved];
    return new Map(files.map((file) => {
        const gold = JSON.parse(fs.readFileSync(file, 'utf8'));
        return [gold.document?.docId || gold.docId, gold];
    }).filter(([docId]) => docId));
}

async function runExtraction({ model, transcript, referenceText = '', goldDocument = null, requestOptions = {}, costGuard = { add() {} }, chat = requestChat }) {
    const prompt = buildAnalysisPrompt('Participant information was not available from the source page.', transcript.text || '');
    const extractionRow = { docId: transcript.docId, transcriptArm: transcript.arm, extractionModel: model, repeat: transcript.repeat, stage: 'E', documentType: transcript.documentType };
    try {
        const result = await chat(buildExtractionBody(model, prompt), requestOptions);
        costGuard.add(result.cost);
        const text = result.error ? '' : extractAssistantText(result.response);
        let parsed = null;
        const stripped = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        try { parsed = JSON.parse(stripped); } catch { /* invalid JSON */ }
        return {
            ...extractionRow, text, parsed, json: jsonValidity(text),
            goldAccuracy: goldDocument ? scoreGold(goldDocument, parsed) : null,
            quoteGroundingOwn: quoteGrounding(parsed, transcript.text || ''),
            quoteGroundingReference: quoteGrounding(parsed, referenceText),
            usage: result.usage, cost: result.cost, latency: result.latencyMs,
            provider: result.provider, retries: result.retries,
            costIncomplete: !Number.isFinite(result.cost),
            failedCall: Boolean(result.error),
            errors: result.error ? [result.error] : parsed ? [] : ['Invalid JSON or truncation'],
        };
    } catch (error) {
        if (error.code === 'COST_CAP_EXCEEDED') throw error;
        return { ...extractionRow, text: '', errors: [error.message] };
    }
}

async function execute({ args, documents, models, capabilitiesByModel, outputDir, dryRun, registry = makeAnalysisRegistry(), logger = null }) {
    const costGuard = createCostGuard(args['max-cost'] != null ? Number(args['max-cost']) : Infinity);
    const goldByDoc = loadGoldByDoc(args['gold-dir']);
    const pins = resolvePins(args);
    const providerFor = (model) => ({
        ...(pins[model] ? { order: [pins[model]] } : args.provider ? { order: args.provider } : {}),
        allow_fallbacks: args['allow-fallbacks'] === true,
        data_collection: 'deny',
    });
    const parserRecovery = args['parser-recovery'] || 'auto';
    if (!['auto', 'off'].includes(parserRecovery)) throw new Error('--parser-recovery must be auto or off.');
    const analysisMode = args['analysis-mode'] || 'bounded';
    if (!['bounded', 'single'].includes(analysisMode)) throw new Error('--analysis-mode must be bounded or single.');
    const timeoutMs = args['timeout-ms'] != null ? Number(args['timeout-ms']) : DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error('--timeout-ms must be a non-negative number of milliseconds.');
    const requestOptions = {
        apiKey: process.env.OPENROUTER_API_KEY,
        timeoutMs,
        ...(logger ? { onEvent: (event) => logger.event(event) } : {}),
    };
    const reasoningTokensArg = args['reasoning-tokens'] != null ? Number(args['reasoning-tokens']) : DEFAULT_REASONING_MAX_TOKENS;
    if (!Number.isFinite(reasoningTokensArg) || reasoningTokensArg < 0) throw new Error('--reasoning-tokens must be a non-negative number of tokens.');
    const analysisMaxTokens = Number(args['analysis-tokens'] || ANALYSIS_MAX_TOKENS);
    const baselineModel = args.baseline || null;
    const reasoning = resolveReasoningByModel(args, models, { baseline: baselineModel });
    const budgetFor = (model) => analysisMaxTokens + reasoningBudget(reasoning.byModel[model], reasoningTokensArg);
    const context = {
        requestOptions, capabilitiesByModel,
        parserRecovery,
        analysisMode,
        knownParties: args['known-parties'] || 'Participant information was not available from the source page.',
        reasoning: null,
        analysisMaxTokens,
        analysisAnswerTokens: analysisMaxTokens,
        maxPages: Number(args['max-pages'] || Infinity),
        // Page images are bounded by the same cap production OCR uses, so the
        // bench cannot render more pages than a real run would ever read.
        rasterMaxPages: Number(args['raster-max-pages'] || process.env.OCR_MAX_PAGES || RASTER_MAX_PAGES_DEFAULT),
        mistralPageRate: args['us-region'] ? 2.2 : 2,
    };
    const baselineArm = args['baseline-arm'] || 'or-native';
    // `--arms` exists so a single cell can be re-run as a cheap diagnostic
    // instead of paying for a whole matrix.
    const onlyArms = args.arms ? new Set(args.arms) : null;
    const knownArms = new Set();
    const armsByModel = {};
    for (const model of models) {
        const arms = analysisArmsForModel(model, { baselineModel, baselineArm });
        arms.forEach((arm) => knownArms.add(arm.id));
        armsByModel[model] = onlyArms ? arms.filter((arm) => onlyArms.has(arm.id)) : arms;
    }
    if (onlyArms) {
        const unknown = [...onlyArms].filter((id) => !knownArms.has(id));
        if (unknown.length) throw new Error(`--arms: unknown arm(s) ${unknown.join(', ')} (available: ${[...knownArms].join(', ')})`);
        if (!Object.values(armsByModel).some((arms) => arms.length)) throw new Error(`--arms: none of ${[...onlyArms].join(', ')} applies to the selected models`);
    }
    const matrix = models.flatMap((model) => buildArmMatrix([model], armsByModel[model], capabilitiesByModel));
    const skipped = matrix.filter((item) => item.status === 'SKIPPED');
    const rows = [];
    const parserRows = [];
    const fallbackRows = [];

    // Some arms only make sense on some documents. The rules are stated here,
    // once, so the dry-run plan, the progress denominator and the live loop
    // cannot disagree about what was actually going to run.
    //
    //  - the text control needs text; on a scan pdf.js returns nothing, and
    //    scoring "" would be a fake failure.
    //  - a page-image arm reads a scan; a born-digital PDF already has text,
    //    and rasterizing it would measure OCR against itself.
    //  - the file-parser arms are a *diagnostic* on a text layer (that is the
    //    only place parser fidelity can be scored at all), but they are also
    //    paid calls. Smoke keeps them on; the paid pilot turns them off unless
    //    `--engines-on-text-layer` asks for them.
    const documentSkipReason = (arm, doc) => analysisDocumentSkipReason(arm, doc, args);
    const plannedCells = documents.reduce((total, doc) => total + models.reduce((sum, model) => sum + armsByModel[model]
        .filter((arm) => matrix.find((item) => item.model === model && item.arm === arm.id)?.status === 'READY')
        .filter((arm) => !documentSkipReason(arm, doc)).length, 0), 0);
    const repeats = Math.max(1, Number(args.repeats || 1));
    const concurrency = args.concurrency == null ? 1 : Number(args.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) {
        throw new Error('--concurrency must be an integer from 1 to 4.');
    }
    const log = typeof logger?.info === 'function' ? logger.info : () => {};
    const totalCells = plannedCells * repeats;
    let startedCells = 0;
    log(`plan · ${documents.length} document(s) · ${totalCells} analysis cell(s)${repeats > 1 ? ` (${repeats} repeats)` : ''} · concurrency=${concurrency} · timeout=${formatSeconds(timeoutMs)}${dryRun ? ' · dry run' : ''}`);
    if (!dryRun && concurrency > 1) {
        log(`warning · cost cap stops new cells after completion; up to ${concurrency} cells may already be in flight (a raster cell contains multiple page calls)`);
    }
    log(`reasoning · ${models.map((model) => `${model}=${describeReasoning(reasoning.byModel[model])} (max_tokens ${budgetFor(model)})`).join(' · ')}`);
    log(`parser recovery · ${parserRecovery} · lossless rewrite, then adaptive same-engine page parsing · no downsampling`);
    log(`analysis policy · ${analysisMode} · dense/long text up to ${CHUNK_SIZE} characters per segment; native/parser PDFs one page per request`);
    if (reasoning.global && baselineModel && models.includes(baselineModel) && !reasoning.overridesBaseline) {
        log(`warning · --reasoning=${describeReasoning(reasoning.global)} also applies to the baseline ${baselineModel}, which no longer represents production. Pass --reasoning=${baselineModel}:default to keep the reference condition.`);
    }
    if (skipped.length) log(`unsupported cells: ${skipped.map((item) => `${item.arm}/${item.model}`).join(', ')}`);

    // pdf.js is free, so the embedded text layer is read once per document and
    // reused as both the `local-text` input and the reference for scoring what
    // the OpenRouter parsers actually returned.
    const localTextByDoc = new Map();
    const readLocalText = async (doc) => {
        if (!localTextByDoc.has(doc.docId)) {
            localTextByDoc.set(doc.docId, (async () => {
                try {
                    const extraction = doc.benchExtraction || await extractTextFromFile(doc.filePath);
                    return { text: String(extraction.text || ''), pages: extraction.pages };
                } catch (error) {
                    return { text: '', pages: null, error: error.message };
                }
            })());
        }
        return localTextByDoc.get(doc.docId);
    };

    // Stop assigning cells after a cost breach. Already-running workers finish
    // and retain their results in the partial report.
    let aborted = null;
    const recordCapBreach = (error) => {
        if (error?.code !== 'COST_CAP_EXCEEDED' || aborted) return false;
        aborted = { reason: 'cost-cap', message: error.message };
        return true;
    };
    const rowByOrder = [];
    const parserRowByOrder = [];
    const runnable = [];
    let order = 0;

    for (let repeat = 1; repeat <= repeats; repeat += 1) {
        for (const doc of documents) {
            for (const model of models) {
                for (const arm of armsByModel[model]) {
                    const cellOrder = order++;
                    const entry = matrix.find((item) => item.model === model && item.arm === arm.id);
                    const base = { docId: doc.docId, title: doc.title, arm: arm.id, model, engine: arm.engine || null, repeat, stage: 'A', documentType: documentType(doc), pages: doc.pages || null };
                    if (entry?.status !== 'READY') {
                        rowByOrder[cellOrder] = { row: { ...base, status: 'SKIPPED', reason: entry?.reason || 'skipped:unsupported-capability' } };
                        continue;
                    }
                    const docSkip = documentSkipReason(arm, doc);
                    if (docSkip) {
                        rowByOrder[cellOrder] = { row: { ...base, status: 'SKIPPED', reason: `skipped:${docSkip}` } };
                        continue;
                    }
                    if (dryRun) {
                        if (arm.id === 'local-text') {
                            const local = await readLocalText(doc);
                            if (!String(local.text || '').trim()) {
                                rowByOrder[cellOrder] = { row: { ...base, status: 'SKIPPED', reason: 'skipped:no-text-layer' } };
                                continue;
                            }
                        }
                        rowByOrder[cellOrder] = { row: { ...base, planned: true } };
                        continue;
                    }
                    runnable.push({ order: cellOrder, base, arm, doc, model, repeat });
                }
            }
        }
    }

    const runCell = async (cell, cellNumber) => {
        const { order: cellOrder, base, arm, doc, model, repeat } = cell;
        const label = `${arm.id} · ${shortModelLabel(model)} · ${shortDocLabel(doc.docId)}${repeats > 1 ? ` · r${repeat}` : ''}`;
        const cellStarted = Date.now();
        log(`[${cellNumber}/${totalCells}] ▶ ${label} · ${doc.pages || '?'}p`);
        const cellContext = {
            ...context,
            provider: providerFor(model),
            capabilities: capabilitiesByModel[model],
            reasoning: reasoning.byModel[model],
            analysisMaxTokens: budgetFor(model),
            label,
            beforeRequest: () => !aborted,
            recordRequest: (request, estimatedParserFee = 0) => {
                if (request.requestRejection === 'pdf-parser-size-limit') return !aborted;
                const breach = costGuard.add(request.cost, estimatedParserFee);
                if (recordCapBreach(breach)) log(`stopped · cost cap reached between requests: ${breach.message}`);
                if (!Number.isFinite(request.cost) && !aborted) {
                    aborted = { reason: 'cost-unknown', message: 'Provider request did not report cost; stopping before another request.' };
                    log('stopped · provider request cost is unknown; no further segment or recovery requests will start');
                }
                return !aborted;
            },
        };

        try {
            const result = await registry[arm.id](model, doc, cellContext);
            let fallback = null;
            if (result.requestRejection === 'pdf-parser-size-limit' && parserRecovery === 'off' && arm.engine && !aborted) {
                const fallbackArm = doc.textLayer === true ? 'local-text' : doc.textLayer === false ? 'local-raster' : null;
                if (!fallbackArm) {
                    fallback = { docId: doc.docId, sourceArm: arm.id, arm: null, model, repeat, status: 'unavailable', reason: 'unknown-text-layer' };
                } else if (fallbackArm === 'local-raster' && capabilitiesByModel[model]?.imageInput !== true) {
                    fallback = { docId: doc.docId, sourceArm: arm.id, arm: fallbackArm, model, repeat, status: 'unavailable', reason: 'image-input-unsupported' };
                } else if (typeof registry[fallbackArm] !== 'function') {
                    fallback = { docId: doc.docId, sourceArm: arm.id, arm: fallbackArm, model, repeat, status: 'unavailable', reason: 'fallback-arm-unavailable' };
                } else {
                    try {
                        const fallbackResult = await registry[fallbackArm](model, doc, {
                            ...cellContext,
                            label: `${label} · fallback ${fallbackArm}`,
                        });
                        const fallbackCostError = costGuard.add(fallbackResult.cost, fallbackResult.estimatedParserFee);
                        const fallbackCapBreached = recordCapBreach(fallbackCostError);
                        const fallbackCostIncomplete = fallbackResult.costIncomplete === true || !Number.isFinite(fallbackResult.cost);
                        if (fallbackCostIncomplete && !aborted) {
                            aborted = { reason: 'cost-unknown', message: 'Fallback did not report call cost; stopping before scheduling another call.' };
                            log('stopped · fallback provider did not report cost; already-running cells may still finish');
                        }
                        fallback = {
                            docId: doc.docId, sourceArm: arm.id, arm: fallbackArm, model, repeat,
                            status: fallbackResult.skipped ? 'skipped' : fallbackResult.failedCall ? 'failed' : 'completed',
                            cost: fallbackResult.cost ?? null, costIncomplete: fallbackCostIncomplete,
                            latency: fallbackResult.latency ?? null, parsed: fallbackResult.parsed ?? null,
                            json: fallbackResult.json ?? null, errors: fallbackResult.errors || [],
                            provider: fallbackResult.provider || null,
                        };
                        if (fallbackCapBreached) log(`stopped · cost cap reached: ${fallbackCostError.message}`);
                    } catch (error) {
                        fallback = {
                            docId: doc.docId, sourceArm: arm.id, arm: fallbackArm, model, repeat,
                            status: 'failed', cost: null, costIncomplete: true, errors: [error.message],
                        };
                        if (!aborted) {
                            aborted = { reason: 'cost-unknown', message: 'Fallback failed before reporting its cost; stopping before scheduling another call.' };
                            log('stopped · fallback cost is unknown; already-running cells may still finish');
                        }
                    }
                }
                fallbackRows.push(fallback);
                log(`  ↳ local fallback · ${fallback.arm || 'unavailable'} · ${fallback.status}${fallback.reason ? ` · ${fallback.reason}` : ''}`);
            }
            const costCapError = result.costAccounted ? null : costGuard.add(result.cost, result.estimatedParserFee);
            const capBreached = recordCapBreach(costCapError);
            if (result.costIncomplete && result.requestRejection !== 'pdf-parser-size-limit' && !aborted) {
                aborted = { reason: 'cost-unknown', message: 'OpenRouter did not report this call cost; stopping before scheduling another call.' };
                log('stopped · provider did not report cost; already-running cells may still finish');
            }
            if (result.skipped) {
                rowByOrder[cellOrder] = {
                    row: { ...base, ...result, status: 'SKIPPED', reason: `skipped:${result.skipped}` },
                };
                log(`[${cellNumber}/${totalCells}] — ${label} · ${result.skipped} · ${formatSeconds(Date.now() - cellStarted)}`);
                if (capBreached) log(`stopped · cost cap reached: ${costCapError.message}`);
                return;
            }

            const reportedBase = result.parserRecovery
                ? { ...base, documentType: `${base.documentType} / ${result.parserRecovery.status === 'completed' ? `${result.parserRecovery.mode}-parser` : 'recovery-failed'}` }
                : { ...base };
            if (result.analysisSegmentation) {
                reportedBase.documentType += result.analysisSegmentation.status === 'completed' ? ' / bounded-analysis' : ' / bounded-analysis-failed';
            }
            const { text, parserText, groundingText, ...rest } = result;
            const safeName = crypto.createHash('sha256').update(`${doc.docId}:${arm.id}:${model}:${repeat}`).digest('hex').slice(0, 16);
            fs.writeFileSync(path.join(outputDir, `analysis-${safeName}.json`), JSON.stringify({ ...reportedBase, text, parserText, parsed: result.parsed, json: result.json, usage: result.usage, finishReason: result.finishReason ?? null, latency: result.latency, cost: result.cost, costIncomplete: result.costIncomplete, requestRejection: result.requestRejection ?? null, httpStatus: result.httpStatus ?? null, diagnostics: result.diagnostics ?? null, parserRecovery: result.parserRecovery ?? null, analysisSegmentation: result.analysisSegmentation ?? null, errors: result.errors, failedCall: result.failedCall, provider: result.provider }, null, 2), { mode: 0o600 });
            const gold = goldByDoc.get(doc.docId) || null;
            const ownGrounding = String(groundingText || '').trim() ? quoteGrounding(result.parsed, groundingText) : null;
            const row = {
                ...reportedBase,
                ...rest,
                textLength: String(text || '').length,
                parserTextLength: String(parserText || '').length,
                parserEffectiveChars: effectiveContentChars(parserText),
                parsed: result.parsed,
                goldAccuracy: gold ? scoreGold(gold, result.parsed) : null,
                quoteGroundingOwn: ownGrounding,
            };
            let parserRow = null;
            if (arm.engine && arm.engine !== 'native') {
                const local = await readLocalText(doc);
                parserRow = {
                    docId: doc.docId, arm: arm.id, model, documentType: reportedBase.documentType, pages: doc.pages,
                    empty: isEffectivelyEmpty(parserText),
                    emptyRaw: !String(parserText || '').trim(),
                    metrics: computeTextMetrics(local.text, parserText || '', null),
                };
            }
            rowByOrder[cellOrder] = { row };
            if (parserRow) parserRowByOrder[cellOrder] = parserRow;

            const answerState = result.failedCall ? 'failed' : result.json?.valid ? 'JSON ✓' : 'JSON ✗';
            const groundingState = ownGrounding ? `${ownGrounding.grounded}/${ownGrounding.total} grounded` : 'quotes n/a';
            log(`[${cellNumber}/${totalCells}] ✓ ${label} · ${formatSeconds(Date.now() - cellStarted)} · ${formatCost(result.cost)} · ${result.provider || 'unknown'} · ${answerState} · ${groundingState}${usageSummary(result.usage)}`);
            if (result.parserRecovery) log(`  ↳ PDF recovery · ${result.parserRecovery.mode} · ${result.parserRecovery.status} · ${result.parserRecovery.requests.length} request(s) · ${result.parserRecovery.chunks.length} accepted page range(s)`);
            if (result.analysisSegmentation) log(`  ↳ bounded analysis · ${result.analysisSegmentation.status} · ${result.analysisSegmentation.requests.length} segment operation(s) · ${result.analysisSegmentation.segments.length} source segment(s)`);
            if (result.failedCall && result.errors?.length) {
                log(`  ↳ ${result.errors.map(briefError).join(' · ')}`);
            }
            if (result.requestRejection === 'pdf-parser-size-limit') {
                log('  ↳ OpenRouter rejected this PDF at the parser size limit (HTTP 400); the parser result remains failed and any local fallback is reported separately.');
            }
            if (!result.parsed && result.finishReason === 'length') {
                log(`  ↳ output hit max_tokens (${cellContext.analysisMaxTokens}); raise --analysis-tokens or lower --reasoning. finish=length`);
            }
            if (capBreached) log(`stopped · cost cap reached: ${costCapError.message}`);
        } catch (error) {
            if (recordCapBreach(error)) {
                log(`stopped · cost cap reached: ${error.message}`);
                return;
            }
            rowByOrder[cellOrder] = { row: { ...base, text: '', errors: [error.message] } };
            log(`[${cellNumber}/${totalCells}] ✗ ${label} · ${formatSeconds(Date.now() - cellStarted)} · ${briefError(error)}`);
            logger?.debug?.(error?.stack || String(error));
        }
    };

    let nextCell = 0;
    const worker = async () => {
        while (!aborted && nextCell < runnable.length) {
            const cell = runnable[nextCell++];
            await runCell(cell, ++startedCells);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, runnable.length) }, worker));
    rows.push(...rowByOrder.filter(Boolean).map((entry) => entry.row));
    parserRows.push(...parserRowByOrder.filter(Boolean));

    return {
        matrix, skipped, rows, aborted, plannedCells: totalCells,
        skippedCells: rows.filter((row) => row.status === 'SKIPPED'),
        summary: summarizeRows(rows),
        extractionSummary: summarizeExtractionRows(rows),
        textMetricSummary: summarizeTextMetrics(parserRows),
        parserMetrics: parserRows,
        fallbacks: fallbackRows,
        actualCost: costGuard.total(),
        estimatedParserFee: costGuard.estimated(),
        spendTotal: costGuard.spendTotal(),
        costMissingCalls: rows.filter((row) => row.costIncomplete).length + fallbackRows.filter((row) => row.costIncomplete).length,
        interpretation: 'Descriptive comparison only; no automatic winner is selected.',
    };
}

function assertLiveCaps(args, dryRun) {
    if (dryRun) return;
    for (const flag of ['max-docs', 'max-pages', 'max-cost']) {
        const value = Number(args[flag]);
        if (args[flag] == null || !Number.isFinite(value) || value < 0 || (flag !== 'max-cost' && value < 1)) {
            throw new Error(`Live runs require a finite --${flag} cap; inspect a dry run first.`);
        }
    }
}

// Dry-run estimate. Parser pages are billed per page; the model completion is
// estimated from a conservative token budget per cell. Real spend always comes
// from OpenRouter's reported `usage.cost`.
function estimateRunCost({ models, pages, documents = [], repeats = 1, args = {} }) {
    const rate = args['us-region'] ? 2.2 : 2;
    const baselineModel = args.baseline || null;
    const baselineArm = args['baseline-arm'] || 'or-native';
    // Reasoning is billed as completion tokens, so a thinking model costs more
    // than the answer alone. Estimate it instead of pretending it is free.
    const reasoning = resolveReasoningByModel(args, models, { baseline: baselineModel });
    const reasoningTokensArg = Number(args['reasoning-tokens'] != null ? args['reasoning-tokens'] : DEFAULT_REASONING_MAX_TOKENS);
    const answerTokens = Number(args['analysis-tokens'] || ANALYSIS_MAX_TOKENS);
    let parserUsd = 0;
    let analysisUsd = 0;
    let analysisRequests = 0;
    const perModel = {};
    for (const model of models) {
        const selected = analysisArmsForModel(model, { baselineModel, baselineArm });
        const arms = args.arms ? selected.filter((arm) => args.arms.includes(arm.id)) : selected;
        const price = MODEL_PRICES[model] || { input: 1, output: 4 };
        // A thinking model can spend its whole budget on hidden reasoning before
        // it writes any JSON, so unless reasoning is off, budget the full output
        // cap per cell. Under-estimating a cap is worse than over-estimating.
        const mayReason = negative(reasoning.byModel[model]);
        const analysisMaxTokens = answerTokens + reasoningBudget(reasoning.byModel[model], reasoningTokensArg);
        let modelUsd = 0;
        for (const arm of arms) {
            for (const [index, pageCount] of pages.entries()) {
                const doc = documents[index];
                if (doc && analysisDocumentSkipReason(arm, doc, args)) continue;
                const bounded = args['analysis-mode'] !== 'single' && (doc?.tableHeavy === true || pageCount > 4 || doc?.analysisPlan?.textSegments > 1);
                const segments = bounded
                    ? arm.kind === 'pdf' ? pageCount : arm.kind === 'text'
                        ? doc?.analysisPlan?.textSegments || Math.max(1, Math.ceil(pageCount * 900 / 3150))
                        : Math.max(1, Math.ceil(Math.min(pageCount, Number(args['raster-max-pages'] || RASTER_MAX_PAGES_DEFAULT)) * 8192 / 3150))
                    : 1;
                analysisRequests += segments * repeats;
                const inputTokens = 3000 * segments + pageCount * 900;
                const outputTokens = segments * (mayReason ? analysisMaxTokens : Math.min(analysisMaxTokens, 4000 + Math.ceil(pageCount / segments) * 600));
                modelUsd += ((inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output) * repeats;
                // A page-image arm makes one transcription call per page before
                // the analysis call above, so it is not a single-request cell.
                if (arm.kind === 'image') {
                    const ocrInput = 1200;
                    const ocrOutput = 900;
                    modelUsd += ((ocrInput / 1e6) * price.input + (ocrOutput / 1e6) * price.output) * pageCount * repeats;
                }
                if (arm.engine === 'mistral-ocr') parserUsd += pageCount * rate / 1000 * repeats;
                // Allow one accepted chunk per page before whole-document analysis.
                // Confirmed size rejects do not reach model inference.
                if (['cloudflare-ai', 'mistral-ocr'].includes(arm.engine) && args['parser-recovery'] !== 'off') {
                    modelUsd += ((pageCount * 1000 / 1e6) * price.input + (pageCount / 1e6) * price.output) * repeats;
                }
            }
        }
        perModel[model] = Number(modelUsd.toFixed(4));
        analysisUsd += modelUsd;
    }
    return { parserUsd: Number(parserUsd.toFixed(4)), analysisUsd: Number(analysisUsd.toFixed(4)), totalUsd: Number((parserUsd + analysisUsd).toFixed(4)), perModel, analysisRequests };
}

function assertEstimatedCostCap(estimatedCost, maxCost, dryRun, ignoreCostEstimate = false) {
    const capExceeded = estimatedCost > maxCost;
    if (capExceeded && !dryRun && ignoreCostEstimate !== true) {
        throw new Error(`Estimated run cost exceeds cap: $${estimatedCost.toFixed(4)} > $${maxCost}. Use --ignore-cost-estimate to bypass only this preflight check; the runtime spend guard remains active.`);
    }
    return capExceeded;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const models = [...new Set(args.models || [DEFAULT_MODEL])];
    // The baseline is a model in the matrix, not a side channel: selecting it
    // must actually add it to the run.
    if (args.baseline && !models.includes(args.baseline)) {
        if (models.length >= 4) throw new Error('Select at most 3 challenger models so the baseline fits in the 4-model cap.');
        models.push(args.baseline);
    }
    const scope = args.scope == null ? 'pilot' : String(args.scope);
    if (!['pilot', 'smoke'].includes(scope)) throw new Error('--scope must be pilot or smoke');
    const overrides = (args.capability || []).map(parseCapabilityOverride);
    const dryRun = Boolean(args['dry-run'] || !args.approved);
    if (!args.probe) assertLiveCaps(args, dryRun);
    const runId = createRunId();
    const outputDir = path.join(OUTPUT_ROOT, runId);
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const logger = createBenchLogger({ debug: Boolean(args.debug), verbose: Boolean(args.verbose), logFile: path.join(outputDir, 'progress.log') });
    logger.info(`run ${runId} · scope=${scope} · dryRun=${dryRun} · models=${models.join(',')} · output=${outputDir}`);
    if (args.probe) {
        if (!args.approved) throw new Error('--probe requires --approved; it sends tiny local PDF/PNG payloads to OpenRouter');
        if (args['dry-run']) throw new Error('--probe cannot be combined with --dry-run');
        const reports = [];
        for (const model of models) {
            try {
                logger.info(`probe → ${model}`);
                let metadata = null;
                try { metadata = await fetchModelMetadata(model, { apiKey: process.env.OPENROUTER_API_KEY }); } catch { /* Note stays generic. */ }
                const result = await probeModel(model, { apiKey: process.env.OPENROUTER_API_KEY, metadata: metadata || {} });
                reports.push({ model, ...result });
                const cache = readCache();
                cache.models[model] = { model, ...result };
                writeCache(cache);
                logger.info(`probe ← ${model} · fileNative=${result.capabilities?.fileNative ?? 'unknown'} · imageInput=${result.capabilities?.imageInput ?? 'unknown'}`);
            } catch (error) {
                logger.info(`probe ← ${model} · failed: ${briefError(error)}`);
                // The probe threw before it could ask the provider anything (for
                // example a missing key). Unknown, not unsupported.
                reports.push({
                    model,
                    date: new Date().toISOString(),
                    capabilities: { fileNative: null, imageInput: null },
                    details: { error: error.message, note: 'Probe did not run; capability remains unknown.' },
                });
            }
        }
        fs.writeFileSync(path.join(outputDir, 'probe.json'), JSON.stringify(reports, null, 2), { mode: 0o600 });
        console.log(JSON.stringify(reports.map(({ model, capabilities, details }) => ({ model, capabilities, details })), null, 2));
        return;
    }
    const docs = resolveRunDocuments(args, scope);
    assertRunScope({ docs, smokeRun: scope === 'smoke', dryRun });
    capDocuments(docs, args);
    logger.info(`documents · ${docs.length} selected`);
    const pages = [];
    for (const doc of docs) {
        logger.debug(`inspecting ${doc.docId}`);
        pages.push(await inspectPdfPages(doc));
    }
    docs.forEach((doc, index) => { doc.pages = pages[index]; });
    if (args['analysis-mode'] !== 'single') {
        for (const doc of docs) {
            doc.benchExtraction = await extractTextFromFile(doc.filePath);
            const text = String(doc.benchExtraction.text || '');
            doc.analysisPlan = {
                textSegments: shouldBoundAnalysis(doc, { analysisMode: 'bounded' }, text)
                    ? Math.max(1, splitTextIntoChunks(text, { chunkSize: CHUNK_SIZE, chunkOverlap: CHUNK_OVERLAP, docId: doc.docId }).length) : 1,
            };
        }
    }
    const totalPages = pages.reduce((sum, count) => sum + count, 0);
    logger.info(`pages · ${totalPages} total · ${docs.map((doc) => `${doc.docId}=${doc.pages}`).join(' · ')}`);
    const maxPages = args['max-pages'] != null ? Number(args['max-pages']) : Infinity;
    if (totalPages > maxPages) throw new Error(`Page cap exceeded: ${totalPages} > ${maxPages}`);
    const maxCost = args['max-cost'] != null ? Number(args['max-cost']) : Infinity;
    const repeats = Math.max(1, Number(args.repeats || 1));
    const estimate = estimateRunCost({ models, pages, documents: docs, repeats, args });
    logger.info(`estimate · parser ${formatCost(estimate.parserUsd)} + analysis ${formatCost(estimate.analysisUsd)} = ${formatCost(estimate.totalUsd)} allowance · ${estimate.analysisRequests} analysis request(s) · cap ${formatCost(maxCost)}`);
    const ignoreCostEstimate = args['ignore-cost-estimate'] === true;
    const capExceeded = assertEstimatedCostCap(estimate.totalUsd, maxCost, dryRun, ignoreCostEstimate);
    if (ignoreCostEstimate) {
        logger.info(`WARNING · --ignore-cost-estimate bypasses only the estimate gate · runtime spend cap ${formatCost(maxCost)} remains active · in-flight calls may overshoot · unknown costs still stop scheduling`);
    } else if (capExceeded) {
        logger.info('dry-run warning · estimate exceeds cost cap; live execution remains blocked until the plan or cap changes');
    }
    const capabilitiesByModel = {};
    logger.info('capabilities · resolving from cache, metadata and manual overrides');
    for (const model of models) {
        capabilitiesByModel[model] = await resolveRunCapabilities(model, { dryRun, overrides, apiKey: process.env.OPENROUTER_API_KEY });
        logger.info(`capabilities · ${model} · fileNative=${capabilitiesByModel[model].fileNative ?? 'unknown'} · imageInput=${capabilitiesByModel[model].imageInput ?? 'unknown'}`);
    }
    const pins = resolvePins(args);
    const reasoning = resolveReasoningByModel(args, models, { baseline: args.baseline || null });
    const reasoningTokens = Number(args['reasoning-tokens'] != null ? args['reasoning-tokens'] : DEFAULT_REASONING_MAX_TOKENS);
    const answerTokens = Number(args['analysis-tokens'] || ANALYSIS_MAX_TOKENS);
    logger.info(`pins · ${models.map((model) => `${model}→${pins[model] || 'any'}`).join(' · ')} · allowFallbacks=${args['allow-fallbacks'] === true}`);
    const context = {
        runId, scope, models, baseline: args.baseline || null, baselineArm: args['baseline-arm'] || 'or-native',
        pins, allowFallbacks: args['allow-fallbacks'] === true,
        parserRecovery: args['parser-recovery'] || 'auto',
        analysisMode: args['analysis-mode'] || 'bounded',
        estimatedAnalysisRequests: estimate.analysisRequests,
        reasoning: reasoning.byModel, reasoningTokens,
        concurrency: args.concurrency == null ? 1 : Number(args.concurrency),
        repeats, docs: docs.map((doc, index) => ({ docId: doc.docId, pages: pages[index], textLayer: doc.textLayer === true, analysisPlan: doc.analysisPlan || null })),
        totalPages, estimatedCost: estimate.totalUsd, estimatedParserUsd: estimate.parserUsd, estimatedAnalysisUsd: estimate.analysisUsd, estimatedPerModel: estimate.perModel,
        maxCost: Number.isFinite(maxCost) ? maxCost : null, capExceeded, ignoreCostEstimate,
        analysisMaxTokens: answerTokens + reasoningBudget(reasoning.global, reasoningTokens),
        analysisMaxTokensByModel: Object.fromEntries(models.map((model) => [model, answerTokens + reasoningBudget(reasoning.byModel[model], reasoningTokens)])),
        dryRun, capabilitiesByModel,
    };
    fs.writeFileSync(path.join(outputDir, 'run.json'), JSON.stringify(context, null, 2), { mode: 0o600 });
    if (dryRun) logger.info(`dry run · no provider calls · run.json written to ${path.join(outputDir, 'run.json')}`);
    logger.info(`executing analysis cells · concurrency=${context.concurrency} · detailed request traces in progress.log${args.verbose ? ' and terminal' : ''}`);
    const report = await execute({ args, documents: docs, models, capabilitiesByModel, outputDir, dryRun, logger });
    fs.writeFileSync(path.join(outputDir, 'report.json'), JSON.stringify({ ...context, ...report }, null, 2), { mode: 0o600 });
    logger.info(`report written · ${path.join(outputDir, 'report.json')}`);
    // Exactly one JSON document on stdout: the run result. Progress, plans and
    // the request lifecycle all go to stderr (and progress.log), so `| jq` and
    // the lab server never have to guess which blob is the answer.
    console.log(JSON.stringify({
        runId, scope, outputDir, dryRun,
        analysisMode: context.analysisMode, estimatedAnalysisRequests: estimate.analysisRequests,
        capExceeded: context.capExceeded, maxCost: context.maxCost, ignoreCostEstimate: context.ignoreCostEstimate,
        ...(dryRun ? {
            plannedModels: models,
            baseline: context.baseline,
            repeats,
            documents: context.docs,
            totalPages,
            estimatedMistralOcrUsd: estimate.parserUsd,
            estimatedAnalysisUsd: estimate.analysisUsd,
            estimatedTotalUsd: estimate.totalUsd,
            estimatedPerModel: estimate.perModel,
            capabilitiesByModel,
            plannedCalls: 'Document × model × arm cells; bounded analysis can issue multiple segment requests per cell. Raster adds OCR calls, and parser-size recovery can add parsing requests. Inspect estimatedAnalysisRequests and per-source plans.',
        } : {}),
        costAndLatency: report.summary,
        parserFidelity: report.textMetricSummary,
        analysisQuality: report.extractionSummary,
        skipped: report.skipped,
        plannedCells: report.plannedCells,
        skippedCells: (report.skippedCells || []).length,
        actualCost: report.actualCost,
        ...(dryRun ? { estimatedCost: estimate.totalUsd } : { estimatedParserFee: report.estimatedParserFee }),
        spendTotal: dryRun ? estimate.totalUsd : report.spendTotal,
        costMissingCalls: report.costMissingCalls, aborted: report.aborted,
        interpretation: report.interpretation,
    }, null, 2));
}

if (require.main === module) {
    main().catch((error) => {
        console.error(`[pdf-engine-benchmark] ${error.message}`);
        if (process.argv.includes('--debug') && error.stack) console.error(error.stack);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, loadDocuments, resolveRunDocuments, inspectPdfPages, capDocuments, resolveRunCapabilities, assertLiveCaps, assertEstimatedCostCap, summarizeRows, summarizeExtractionRows, percentile, buildExtractionBody, runExtraction, execute, estimateRunCost, resolvePins, createBenchLogger, parseReasoningArg, resolveReasoningByModel, usageSummary, main };
