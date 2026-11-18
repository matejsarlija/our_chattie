'use strict';

require('dotenv').config();
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { OIB_CASE_DOCS, SMOKE_DOC_IDS, assertRunScope } = require('./lib/lab-documents');
const { loadDocuments, inspectPdfPages } = require('./benchmark-pdf-engines');
const { readCache } = require('./lib/capabilities');
const { renderPdfPage } = require('./lib/arms');
const { DEFAULT_GOLD_MODEL, suggestGoldFacts } = require('./lib/gold-assist');
const { normalizeGoldFacts, normalizeReviewedCategories, summarizeGold, factCount, resolveGoldTarget, GOLD_CATEGORIES } = require('./lib/gold-editor');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PDF_BENCH_LAB_PORT || 4178);
const DATA_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');
const HTML_PATH = path.join(__dirname, 'pdf-bench-lab.html');
const GOLD_HTML_PATH = path.join(__dirname, 'pdf-bench-gold.html');
const CSS_PATH = path.join(__dirname, 'pdf-bench-lab.css');
const JOBS = new Map();
const ALLOWED_MODELS = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const ALLOWED_RUNS = /^[0-9TZ-]+-[a-f0-9]{8}$/;
const MAX_BODY_BYTES = 1024 * 1024;
let activeJob = null;
let activeGoldSuggestion = false;

function respond(res, status, value, type = 'application/json; charset=utf-8') {
    const body = Buffer.isBuffer(value) || typeof value === 'string'
        ? value
        : JSON.stringify(value);
    res.writeHead(status, {
        'Content-Type': type,
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    });
    res.end(body);
}

function isLoopback(req) {
    const address = req.socket.remoteAddress || '';
    const host = String(req.headers.host || '').split(':')[0].toLowerCase();
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
        && ['127.0.0.1', 'localhost'].includes(host);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let content = '';
        let bytes = 0;
        req.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_BODY_BYTES) { reject(new Error('Request body exceeds 1 MiB')); req.destroy(); return; }
            content += chunk.toString('utf8');
        });
        req.on('end', () => {
            try { resolve(content ? JSON.parse(content) : {}); } catch { reject(new Error('Request body must be JSON')); }
        });
        req.on('error', reject);
    });
}

function getSelectedDocs(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20) throw new Error('Select between 1 and 20 fixture documents.');
    const allowed = new Set(OIB_CASE_DOCS.map((doc) => doc.docId));
    if (ids.some((id) => !allowed.has(id)) || new Set(ids).size !== ids.length) throw new Error('Document selection contains an unknown or duplicate fixture ID.');
    return ids.map((id) => OIB_CASE_DOCS.find((doc) => doc.docId === id));
}

function createJob({ kind, script, args, beforeDirectories }) {
    if (activeJob && JOBS.get(activeJob)?.state === 'running') throw new Error('A lab job is already running.');
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    const job = { id, kind, state: 'running', output: '', startedAt: new Date().toISOString(), runId: null, goldSetId: null, summary: null, reviewUrl: null, reportUrl: null, answerKeyPath: null, goldDir: null, sourceRunId: null };
    JOBS.set(id, job);
    activeJob = id;
    // Keep the in-memory job list bounded: drop the oldest finished jobs,
    // never the active one.
    for (const [oldId, oldJob] of JOBS) {
        if (JOBS.size <= 40) break;
        if (oldId !== id && oldJob.state !== 'running') JOBS.delete(oldId);
    }
    const child = spawn(process.execPath, [script, ...args], { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = (chunk) => {
        const text = chunk.toString('utf8');
        const key = process.env.OPENROUTER_API_KEY;
        job.output = (job.output + (key ? text.split(key).join('[redacted]') : text)).slice(-48_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
        job.state = 'failed';
        job.output += `\n${error.message}`;
        job.finishedAt = new Date().toISOString();
        activeJob = null;
    });
    child.on('close', (code) => {
        const paths = [...job.output.matchAll(/\"(?:outputDir|htmlPath|filePath|outputPath)\":\s*\"([^\"]+)\"/g)].map((match) => match[1]);
        let artifact = paths.map((value) => path.resolve(value)).find((value) => value.startsWith(`${DATA_ROOT}${path.sep}`));
        if (artifact && fs.existsSync(artifact) && fs.statSync(artifact).isFile()) artifact = path.dirname(artifact);
        if (!artifact) {
            const candidates = fs.readdirSync(DATA_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !beforeDirectories.has(entry.name)).map((entry) => path.join(DATA_ROOT, entry.name));
            candidates.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
            artifact = candidates[0] || null;
        }
        job.state = code === 0 ? 'done' : 'failed';
        job.finishedAt = new Date().toISOString();
        if (artifact) {
            job.runId = path.basename(artifact);
            const reportFile = path.join(artifact, 'report.json');
            if (fs.existsSync(reportFile)) {
                try {
                    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
                    job.summary = { scope: report.scope || 'pilot', dryRun: Boolean(report.dryRun), stageT: report.summary || [], textMetricSummary: report.textMetricSummary || [], extractionSummary: report.extractionSummary || [], skipped: report.skipped || [], skippedCells: (report.skippedCells || []).length, actualCost: report.actualCost || 0, estimatedParserFee: report.estimatedParserFee || 0, costMissingCalls: report.costMissingCalls || 0, documentCount: report.docs?.length || 0, totalPages: report.totalPages || 0, cellCount: (report.rows || []).filter((row) => row.status !== 'SKIPPED').length, plannedCells: (report.rows || []).filter((row) => row.planned).length, aborted: report.aborted || null };
                    job.reportUrl = `/api/artifact/${encodeURIComponent(job.runId)}/report.json`;
                } catch { /* Keep process output; malformed artifacts are not served as summaries. */ }
            }
            const probeFile = path.join(artifact, 'probe.json');
            if (fs.existsSync(probeFile)) {
                try { job.summary = { capabilities: JSON.parse(fs.readFileSync(probeFile, 'utf8'))[0]?.capabilities || {} }; } catch { /* Keep raw output. */ }
            }
            if (job.kind === 'gold-template') {
                job.goldDir = artifact;
                job.goldSetId = path.basename(path.dirname(artifact));
            }
            const reviewFile = path.join(artifact, 'review.html');
            if (fs.existsSync(reviewFile)) {
                job.reviewUrl = `/api/artifact/${encodeURIComponent(job.runId)}/review.html`;
                const keyFile = path.join(artifact, 'answer-key.json');
                job.answerKeyPath = fs.existsSync(keyFile) ? keyFile : null;
            }
        }
        if (code !== 0) job.output += `\nProcess exited with code ${code}.`;
        activeJob = null;
    });
    return job;
}

function outputDirectories() {
    fs.mkdirSync(DATA_ROOT, { recursive: true, mode: 0o700 });
    return new Set(fs.readdirSync(DATA_ROOT, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name));
}

function launch(kind, script, args) {
    return createJob({ kind, script: path.join(__dirname, script), args, beforeDirectories: outputDirectories() });
}

// --- Gold facts editor -----------------------------------------------------
// Templates are the ground truth the extraction stage is scored against, so the
// editor reads the corpus PDFs directly and never touches provider APIs.

const PAGE_CACHE = new Map();
const PAGE_CACHE_LIMIT = 80;
let corpusById = null;

function corpusDocuments() {
    if (corpusById) return corpusById;
    corpusById = new Map();
    for (const { docId } of OIB_CASE_DOCS) {
        try {
            const [doc] = loadDocuments({ 'doc-id': [docId] });
            if (doc) corpusById.set(docId, doc);
        } catch { /* A missing fixture only hides its page images, never the editor. */ }
    }
    return corpusById;
}

async function renderCachedPage(doc, pageNumber) {
    const key = `${doc.docId}#${pageNumber}`;
    if (PAGE_CACHE.has(key)) return PAGE_CACHE.get(key);
    const image = await renderPdfPage(doc.filePath, pageNumber);
    if (PAGE_CACHE.size >= PAGE_CACHE_LIMIT) PAGE_CACHE.delete(PAGE_CACHE.keys().next().value);
    PAGE_CACHE.set(key, image);
    return image;
}

function readGoldTemplate(dir, file) {
    const template = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const summary = summarizeGold(template);
    return {
        file,
        docId: template.document?.docId || null,
        title: template.document?.title || null,
        pages: template.document?.pages || null,
        summary: { ...summary, facts: factCount(summary) },
        template,
    };
}

function listGoldSets() {
    if (!fs.existsSync(DATA_ROOT)) return [];
    const sets = [];
    for (const entry of fs.readdirSync(DATA_ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[0-9TZ-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
        const dir = path.join(DATA_ROOT, entry.name, 'gold');
        if (!fs.existsSync(dir)) continue;
        const documents = [];
        for (const file of fs.readdirSync(dir).filter((name) => /^[a-f0-9]{16}\.json$/.test(name))) {
            try { documents.push(readGoldTemplate(dir, file)); } catch { /* Skip unreadable templates. */ }
        }
        if (!documents.length) continue;
        documents.sort((a, b) => String(a.docId).localeCompare(String(b.docId), 'hr'));
        sets.push({ setId: entry.name, documents: documents.map(({ template, ...rest }) => rest) });
    }
    return sets.sort((a, b) => b.setId.localeCompare(a.setId));
}

function listRuns() {
    if (!fs.existsSync(DATA_ROOT)) return [];
    const runs = [];
    for (const entry of fs.readdirSync(DATA_ROOT, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[0-9TZ-]+-[a-f0-9]{8}$/.test(entry.name)) continue;
        const reportPath = path.join(DATA_ROOT, entry.name, 'report.json');
        if (fs.existsSync(reportPath)) {
            try {
                const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
                runs.push({
                    runId: entry.name,
                    scope: report.scope || 'pilot',
                    dryRun: Boolean(report.dryRun),
                    actualCost: report.actualCost || 0,
                    estimatedCost: report.estimatedCost || 0,
                    estimatedParserFee: report.estimatedParserFee || 0,
                    totalPages: report.totalPages || 0,
                    docsCount: report.docs?.length || 0,
                });
            } catch {
                runs.push({ runId: entry.name, scope: 'unknown', dryRun: false });
            }
        }
    }
    return runs.sort((a, b) => b.runId.localeCompare(a.runId));
}


function readParserOutput(runId, { docId, arm, model, repeat }, dataRoot = DATA_ROOT) {
    if (!ALLOWED_RUNS.test(String(runId || ''))) throw new Error('Unknown benchmark run ID.');
    if (!['or-cloudflare', 'or-mistral-ocr'].includes(arm)) throw new Error('Unknown parser arm.');
    if (typeof docId !== 'string' || !docId || typeof model !== 'string' || !model) throw new Error('Document and model are required.');
    const repeatNumber = Number(repeat);
    if (!Number.isInteger(repeatNumber) || repeatNumber < 1) throw new Error('Repeat must be a positive integer.');

    const runDir = path.join(dataRoot, runId);
    const reportPath = path.join(runDir, 'report.json');
    if (!fs.existsSync(reportPath)) throw new Error('Benchmark report not found.');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const row = report.rows?.find((item) => item.docId === docId && item.arm === arm && item.model === model && item.repeat === repeatNumber);
    if (!row || row.status === 'SKIPPED') throw new Error('No completed parser output exists for this sample.');

    const hash = crypto.createHash('sha256').update(`${docId}:${arm}:${model}:${repeatNumber}`).digest('hex').slice(0, 16);
    const artifactPath = path.join(runDir, `analysis-${hash}.json`);
    if (!fs.existsSync(artifactPath)) throw new Error('Parser output artifact not found.');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    if (artifact.docId !== docId || artifact.arm !== arm || artifact.model !== model || artifact.repeat !== repeatNumber) {
        throw new Error('Parser output does not match the requested sample.');
    }
    return {
        parserText: String(artifact.parserText || ''),
        analysisText: String(artifact.text || ''),
        provider: row.provider || artifact.provider || null,
        cost: Number.isFinite(row.cost) ? row.cost : (Number.isFinite(artifact.cost) ? artifact.cost : null),
        estimatedParserFee: Number.isFinite(row.estimatedParserFee) ? row.estimatedParserFee : 0,
        costIncomplete: row.costIncomplete === true,
        parserRecovery: artifact.parserRecovery || row.parserRecovery || null,
        analysisSegmentation: artifact.analysisSegmentation || row.analysisSegmentation || null,
    };
}

async function route(req, res) {
    if (!isLoopback(req)) return respond(res, 403, { error: 'Loopback access only.' });
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/lab')) {
        return respond(res, 200, fs.readFileSync(HTML_PATH), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/gold') {
        return respond(res, 200, fs.readFileSync(GOLD_HTML_PATH), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/lab.css') {
        return respond(res, 200, fs.readFileSync(CSS_PATH), 'text/css; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/capabilities') {
        const model = String(url.searchParams.get('model') || '');
        const cached = readCache().models?.[model]?.capabilities || {};
        return respond(res, 200, { fileNative: cached.fileNative ?? null, imageInput: cached.imageInput ?? null });
    }
    if (req.method === 'GET' && url.pathname === '/api/documents') {
        try {
            const local = loadDocuments({ 'doc-id': OIB_CASE_DOCS.map((doc) => doc.docId) });
            const actualIds = new Set(local.map((doc) => doc.docId));
            const documents = OIB_CASE_DOCS.filter((doc) => actualIds.has(doc.docId)).map((doc) => ({ ...doc, fileName: doc.docId.slice(doc.docId.indexOf(':') + 1), tableLike: /schedule|account|specification|claim totals|statement|troškovnik|distribution/i.test(`${doc.role} ${doc.evidence}`) }));
            const model = String(url.searchParams.get('model') || 'z-ai/glm-5.3-flash');
            const cached = readCache().models?.[model]?.capabilities || {};
            return respond(res, 200, { documents, smokeDocIds: SMOKE_DOC_IDS, capabilities: { fileNative: cached.fileNative ?? null, imageInput: cached.imageInput ?? null } });
        } catch (error) { return respond(res, 500, { error: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/gold/sets') {
        return respond(res, 200, { sets: listGoldSets() });
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') {
        return respond(res, 200, { runs: listRuns() });
    }
    const parserOutputMatch = /^\/api\/parser-output\/([0-9TZ-]+-[a-f0-9]{8})$/.exec(url.pathname);
    if (req.method === 'GET' && parserOutputMatch) {
        try {
            return respond(res, 200, readParserOutput(parserOutputMatch[1], {
                docId: url.searchParams.get('docId'),
                arm: url.searchParams.get('arm'),
                model: url.searchParams.get('model'),
                repeat: url.searchParams.get('repeat'),
            }));
        } catch (error) {
            return respond(res, 404, { error: error.message });
        }
    }
    if (req.method === 'GET' && url.pathname === '/api/gold/template') {
        try {
            const { filePath } = resolveGoldTarget(DATA_ROOT, url.searchParams.get('set'), url.searchParams.get('file'));
            if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
            const template = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            return respond(res, 200, { template, summary: { ...summarizeGold(template), facts: factCount(summarizeGold(template)) } });
        } catch (error) { return respond(res, 400, { error: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/gold/page') {
        try {
            const { filePath } = resolveGoldTarget(DATA_ROOT, url.searchParams.get('set'), url.searchParams.get('file'));
            if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
            const template = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const docId = template.document?.docId;
            const doc = corpusDocuments().get(docId);
            if (!doc) throw new Error('No local PDF is available for this template.');
            const page = Number(url.searchParams.get('page'));
            if (!Number.isInteger(page) || page < 1 || page > 200) throw new Error('Page must be a whole number between 1 and 200.');
            const image = await renderCachedPage(doc, page);
            return respond(res, 200, image, 'image/jpeg');
        } catch (error) { return respond(res, 404, { error: error.message }); }
    }
    const jobMatch = /^\/api\/jobs\/([A-Za-z0-9-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && jobMatch) {
        const job = JOBS.get(jobMatch[1]);
        if (!job) return respond(res, 404, { error: 'Unknown lab job.' });
        return respond(res, 200, { ...job, reportRunId: ['dry-run', 'benchmark'].includes(job.kind) ? job.runId : job.sourceRunId });
    }
    const artifactMatch = /^\/api\/artifact\/([0-9TZ-]+-[a-f0-9]{8})\/(report\.json|review\.html|probe\.json|judge-triage\.json|gold-scores\.json)$/.exec(url.pathname);
    if (req.method === 'GET' && artifactMatch) {
        const filePath = path.join(DATA_ROOT, artifactMatch[1], artifactMatch[2]);
        if (!fs.existsSync(filePath)) return respond(res, 404, { error: 'Artifact not found.' });
        const type = artifactMatch[2].endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8';
        return respond(res, 200, fs.readFileSync(filePath), type);
    }
    if (req.method !== 'POST') return respond(res, 404, { error: 'Not found.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return respond(res, 403, { error: 'Same-origin requests only.' });
    let body;
    try { body = await readBody(req); } catch (error) { return respond(res, 400, { error: error.message }); }
    try {
        if (url.pathname === '/api/gold/save') {
            const { filePath } = resolveGoldTarget(DATA_ROOT, body.set, body.file);
            if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
            const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const { facts, errors } = normalizeGoldFacts(body.facts);
            if (errors.length) return respond(res, 400, { error: errors[0], errors });
            const complete = body.factsComplete === true;
            const reviewedCategories = normalizeReviewedCategories(body.reviewedCategories);
            const missingReviews = GOLD_CATEGORIES.filter((category) => !reviewedCategories.includes(category));
            if (complete && missingReviews.length) {
                return respond(res, 400, { error: 'Review every fact category against the source before marking complete.', errors: missingReviews.map((category) => `Review ${category}.`) });
            }
            const next = { ...existing, facts, reviewedCategories, factsComplete: complete };
            const temp = `${filePath}.tmp`;
            fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
            fs.renameSync(temp, filePath);
            const summary = summarizeGold(next);
            return respond(res, 200, { ok: true, summary: { ...summary, facts: factCount(summary) } });
        }
        if (url.pathname === '/api/gold/suggest') {
            if (body.approved !== true) throw new Error('Explicit approval is required before sending this PDF to OpenRouter.');
            if (activeGoldSuggestion) return respond(res, 409, { error: 'A gold suggestion request is already running.' });
            if (!process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY in the server environment first.');
            const { filePath } = resolveGoldTarget(DATA_ROOT, body.set, body.file);
            if (!fs.existsSync(filePath)) throw new Error('Unknown gold template.');
            const template = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const docId = template.document?.docId;
            if (!docId) throw new Error('The gold template has no source document ID.');
            const [doc] = loadDocuments({ 'doc-id': [docId] });
            if (!doc) throw new Error('The local PDF for this gold template is unavailable.');
            activeGoldSuggestion = true;
            try {
                const suggestion = await suggestGoldFacts({
                    filePath: doc.filePath,
                    filename: path.basename(doc.filePath),
                    pages: await inspectPdfPages(doc),
                    model: body.model || DEFAULT_GOLD_MODEL,
                    apiKey: process.env.OPENROUTER_API_KEY,
                });
                return respond(res, 200, { ...suggestion, docId, set: body.set, file: body.file });
            } finally {
                activeGoldSuggestion = false;
            }
        }
        if (url.pathname === '/api/probe') {
            if (body.approved !== true) throw new Error('Explicit probe approval required.');
            if (!process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY in the server environment first.');
            const models = Array.isArray(body.models) ? body.models : [body.model];
            if (!models.length || models.length > 4 || models.some((model) => !ALLOWED_MODELS.test(model || ''))) throw new Error('Enter 1–4 valid provider/model slugs.');
            const job = launch('probe', 'benchmark-pdf-engines.js', [`--models=${models.join(',')}`, '--probe', '--approved']);
            return respond(res, 202, { jobId: job.id });
        }
        if (url.pathname === '/api/run') {
            const docs = getSelectedDocs(body.docIds);
            const smokeRun = body.smoke === true;
            const dryRun = body.dryRun === true;
            assertRunScope({ docs, smokeRun, dryRun });
            const models = Array.isArray(body.models) ? [...body.models] : [];
            if (!models.length || models.length > 4 || models.some((model) => !ALLOWED_MODELS.test(model))) throw new Error('Enter 1–4 valid provider/model slugs.');
            // The incumbent is measured by default: a comparison without it only
            // says whether GLM produced JSON, not whether quality held.
            const baseline = body.baseline === false ? null : String(body.baseline || 'google/gemini-2.5-flash');
            if (baseline) {
                if (!ALLOWED_MODELS.test(baseline)) throw new Error('Enter a valid baseline provider/model slug.');
                if (!models.includes(baseline)) {
                    if (models.length >= 4) throw new Error('Select at most 3 challenger models so the baseline fits.');
                    models.push(baseline);
                }
            }
            const parserRecovery = body.parserRecovery === undefined ? 'auto' : body.parserRecovery;
            if (!['auto', 'off'].includes(parserRecovery)) throw new Error('Parser recovery must be auto or off.');
            const analysisMode = body.analysisMode === undefined ? 'bounded' : body.analysisMode;
            if (!['bounded', 'single'].includes(analysisMode)) throw new Error('Analysis mode must be bounded or single.');
            const maxCost = Number(body.maxCost);
            if (!Number.isFinite(maxCost) || maxCost < 0) throw new Error('Set a finite non-negative hard cost cap.');
            if (!dryRun && body.approved !== true) throw new Error('Live benchmark approval is required.');
            if (!dryRun && !process.env.OPENROUTER_API_KEY) throw new Error('Set OPENROUTER_API_KEY in the server environment first.');
            const goldDir = body.goldDir ? path.resolve(body.goldDir) : null;
            if (goldDir && (!goldDir.startsWith(`${DATA_ROOT}${path.sep}`) || !fs.existsSync(goldDir) || !fs.statSync(goldDir).isDirectory())) throw new Error('Gold facts must be a local folder under backend/data/pdf-engine-bench.');
            const args = [`--models=${models.join(',')}`, ...docs.map((doc) => `--doc-id=${doc.docId}`), `--max-docs=${docs.length}`, `--max-pages=${docs.reduce((sum, doc) => sum + doc.pages, 0)}`, `--max-cost=${maxCost}`, `--repeats=${Math.max(1, Math.min(5, Number(body.repeats) || 1))}`, `--scope=${smokeRun ? 'smoke' : 'pilot'}`];
            if (baseline) args.push(`--baseline=${baseline}`);
            args.push(`--parser-recovery=${parserRecovery}`);
            args.push(`--analysis-mode=${analysisMode}`);
            if (goldDir) args.push(`--gold-dir=${goldDir}`);
            if (body.reference === true) throw new Error('The Gemini reference arm is gone: the incumbent is measured as the pinned native-PDF baseline (google/gemini-2.5-flash), not as a separate OCR arm.');
            if (body.approved === true && !dryRun) args.push('--approved');
            const job = launch(dryRun ? 'dry-run' : 'benchmark', 'benchmark-pdf-engines.js', args);
            return respond(res, 202, { jobId: job.id });
        }
        if (url.pathname === '/api/gold') {
            const docs = getSelectedDocs(body.docIds);
            const args = [...docs.map((doc) => `--doc-id=${doc.docId}`), `--max-docs=${docs.length}`];
            const job = launch('gold-template', 'build-gold-template.js', args);
            return respond(res, 202, { jobId: job.id });
        }
        if (url.pathname === '/api/review') {
            if (!ALLOWED_RUNS.test(body.runId || '')) throw new Error('Unknown benchmark run ID.');
            const report = path.join(DATA_ROOT, body.runId, 'report.json');
            if (!fs.existsSync(report)) throw new Error('This run has no completed report to review.');
            const sample = Math.max(0, Math.min(20, Number(body.sample) || 3));
            const seed = Math.trunc(Number(body.seed) || 7);
            const job = launch('review-sheet', 'build-review-sheet.js', [`--report=${report}`, `--sample=${sample}`, `--seed=${seed}`]);
            job.sourceRunId = body.runId;
            return respond(res, 202, { jobId: job.id });
        }
        if (url.pathname === '/api/score-review') {
            const reviewJob = JOBS.get(body.reviewJobId);
            if (!reviewJob || reviewJob.kind !== 'review-sheet' || reviewJob.state !== 'done' || !reviewJob.answerKeyPath || !reviewJob.sourceRunId) throw new Error('Build a blinded review sheet for a completed benchmark before scoring verdicts.');
            if (!body.verdicts || !Array.isArray(body.verdicts.verdicts) || body.verdicts.verdicts.length > 100) throw new Error('The imported file does not contain a valid review verdict list.');
            const verdictPath = path.join(path.dirname(reviewJob.answerKeyPath), 'human-verdicts.json');
            fs.writeFileSync(verdictPath, JSON.stringify(body.verdicts), { mode: 0o600 });
            const keyPath = reviewJob.answerKeyPath;
            const reportPath = path.join(DATA_ROOT, reviewJob.sourceRunId, 'report.json');
            const job = launch('review-score', 'score-review.js', [`--verdicts=${verdictPath}`, `--answer-key=${keyPath}`, `--report=${reportPath}`]);
            return respond(res, 202, { jobId: job.id });
        }
        return respond(res, 404, { error: 'Not found.' });
    } catch (error) { return respond(res, 400, { error: error.message }); }
}

const server = http.createServer((req, res) => { route(req, res).catch((error) => respond(res, 500, { error: error.message })); });
if (require.main === module) server.listen(PORT, HOST, () => console.log(`Court PDF Benchmark Lab: http://${HOST}:${PORT}`));
server.on('error', (error) => { console.error(`[pdf-bench-lab] ${error.message}`); process.exitCode = 1; });

module.exports = { route, getSelectedDocs, createJob, listRuns, readParserOutput };
