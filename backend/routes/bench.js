'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const {
    DEFAULT_DATA_ROOT,
    ALLOWED_RUNS,
    assertRunScope,
    getSelectedDocs,
    listCorpusDocuments,
    readParserOutput,
    seedDefaultBenchCandidates,
    runCandidateMicroBench,
} = require('../bench/corpus');
const { createBenchRunner } = require('../bench/runner');
const {
    listGoldSets,
    getGoldTemplate,
    saveGoldTemplate,
    renderGoldPage,
    suggestGoldForTemplate,
    DEFAULT_GOLD_MODEL,
} = require('../bench/goldEditor');
const { getBlindedReviewPayload, submitBlindedReviewVerdicts } = require('../bench/review');
const { listBenchModels, syncOpenRouterModels, runCroatianSmokeGate } = require('../bench/gbench');
const { runStage2ReportBench } = require('../bench/reportBench');
const { readCache } = require('../scripts/lib/capabilities');

const ALLOWED_MODELS = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

function passThroughLimiter(_req, _res, next) {
    next();
}

function sendSseEvent(res, eventName, data) {
    res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

function createBenchRouter({
    analysisStore = null,
    dataRoot = DEFAULT_DATA_ROOT,
    runner = null,
    readLimiter = passThroughLimiter,
    writeLimiter = passThroughLimiter,
} = {}) {
    const router = express.Router();
    const benchRunner = runner || createBenchRunner({ dataRoot, sqliteStore: analysisStore });
    let activeGoldSuggestion = false;

    router.get('/documents', readLimiter, (req, res) => {
        try {
            const model = String(req.query.model || 'z-ai/glm-5.3-flash');
            return res.json(listCorpusDocuments({ model }));
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.get('/capabilities', readLimiter, (req, res) => {
        const model = String(req.query.model || '');
        const cached = readCache().models?.[model]?.capabilities || {};
        return res.json({ fileNative: cached.fileNative ?? null, imageInput: cached.imageInput ?? null });
    });

    router.get('/models', readLimiter, (_req, res) => {
        try {
            return res.json(listBenchModels({ sqliteStore: analysisStore }));
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.post('/models/sync', writeLimiter, async (req, res) => {
        try {
            if (req.body?.approved !== true) {
                return res.status(400).json({ error: 'Explicit approval is required to sync OpenRouter models.' });
            }
            const result = await syncOpenRouterModels({ sqliteStore: analysisStore });
            return res.json(result);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.post('/gbench/gate', writeLimiter, async (req, res) => {
        try {
            const { model, dryRun = false, approved = false, maxCost = 0 } = req.body || {};
            if (model && !ALLOWED_MODELS.test(model)) {
                return res.status(400).json({ error: 'Invalid model slug.' });
            }
            const result = await runCroatianSmokeGate({
                model: model || 'z-ai/glm-5.3-flash',
                dryRun: Boolean(dryRun),
                approved: approved === true,
                maxCost: Number(maxCost || 0),
                sqliteStore: analysisStore,
            });
            return res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.get('/candidates', readLimiter, (req, res) => {
        try {
            const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
            const runId = req.query.runId ? String(req.query.runId) : null;
            const candidates = analysisStore ? analysisStore.listBenchCandidates({ runId, limit }) : [];
            return res.json({ candidates });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.post('/candidates/seed', writeLimiter, (_req, res) => {
        try {
            const result = seedDefaultBenchCandidates(analysisStore);
            return res.json(result);
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    });

    router.post('/candidates/:id/micro-bench', writeLimiter, async (req, res) => {
        try {
            const { model, dryRun = false, approved = false, maxCost = 0 } = req.body || {};
            const result = await runCandidateMicroBench({
                sqliteStore: analysisStore,
                candidateId: req.params.id,
                model: model || 'z-ai/glm-5.3-flash',
                dryRun: Boolean(dryRun),
                approved: approved === true,
                maxCost: Number(maxCost || 0),
            });
            return res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.get('/runs', readLimiter, (_req, res) => {
        return res.json({ runs: benchRunner.listRuns(), activeJobId: benchRunner.getActiveJobId() });
    });

    router.get('/runs/:runId/report', readLimiter, (req, res) => {
        try {
            return res.json(benchRunner.readRunReport(req.params.runId));
        } catch (error) {
            return res.status(error.statusCode || 404).json({ error: error.message });
        }
    });

    router.get('/runs/:runId/traces', readLimiter, (req, res) => {
        if (!ALLOWED_RUNS.test(String(req.params.runId || ''))) {
            return res.status(400).json({ error: 'Unknown benchmark run ID.' });
        }
        return res.json({ traces: benchRunner.readRunTraces(req.params.runId) });
    });

    router.get('/runs/:runId/parser-output', readLimiter, (req, res) => {
        try {
            return res.json(readParserOutput(req.params.runId, {
                docId: req.query.docId,
                arm: req.query.arm,
                model: req.query.model,
                repeat: req.query.repeat,
            }, dataRoot));
        } catch (error) {
            return res.status(404).json({ error: error.message });
        }
    });

    router.get('/runs/:runId/review', readLimiter, (req, res) => {
        try {
            const payload = getBlindedReviewPayload(req.params.runId, {
                sample: req.query.sample,
                seed: req.query.seed,
                dataRoot,
            });
            return res.json(payload);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.post('/runs/:runId/review', writeLimiter, (req, res) => {
        try {
            const result = submitBlindedReviewVerdicts(req.params.runId, req.body, { dataRoot });
            return res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.get('/gold/sets', readLimiter, (_req, res) => {
        return res.json({ sets: listGoldSets(dataRoot) });
    });

    router.get('/gold/template', readLimiter, (req, res) => {
        try {
            return res.json(getGoldTemplate({
                set: req.query.set,
                file: req.query.file,
                dataRoot,
            }));
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.get('/gold/page', readLimiter, async (req, res) => {
        try {
            const { buffer, etag, totalPages } = await renderGoldPage({
                set: req.query.set,
                file: req.query.file,
                page: req.query.page,
                dataRoot,
            });
            res.set({
                ETag: etag,
                'Cache-Control': 'private, max-age=3600',
                'X-Total-Pages': String(totalPages),
            });
            if (req.headers['if-none-match'] === etag) {
                return res.status(304).end();
            }
            return res.type('image/jpeg').send(buffer);
        } catch (error) {
            return res.status(404).json({ error: error.message });
        }
    });

    router.post('/gold/save', writeLimiter, (req, res) => {
        try {
            const result = saveGoldTemplate({
                set: req.body?.set,
                file: req.body?.file,
                facts: req.body?.facts,
                factsComplete: req.body?.factsComplete,
                reviewedCategories: req.body?.reviewedCategories,
                dataRoot,
            });
            return res.json(result);
        } catch (error) {
            return res.status(error.statusCode || 400).json({ error: error.message, errors: error.errors });
        }
    });

    router.post('/gold/suggest', writeLimiter, async (req, res) => {
        try {
            if (req.body?.approved !== true) {
                return res.status(400).json({ error: 'Explicit approval is required before sending this PDF to OpenRouter.' });
            }
            if (activeGoldSuggestion) {
                return res.status(409).json({ error: 'A gold suggestion request is already running.' });
            }
            if (!process.env.OPENROUTER_API_KEY) {
                return res.status(400).json({ error: 'Set OPENROUTER_API_KEY in the server environment first.' });
            }
            activeGoldSuggestion = true;
            try {
                const suggestion = await suggestGoldForTemplate({
                    set: req.body?.set,
                    file: req.body?.file,
                    model: req.body?.model || DEFAULT_GOLD_MODEL,
                    apiKey: process.env.OPENROUTER_API_KEY,
                    dataRoot,
                });
                return res.json(suggestion);
            } finally {
                activeGoldSuggestion = false;
            }
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.post('/gold/generate', writeLimiter, (req, res) => {
        try {
            const docs = getSelectedDocs(req.body?.docIds);
            const args = [...docs.map((doc) => `--doc-id=${doc.docId}`), `--max-docs=${docs.length}`];
            if (req.body?.carryFrom && ALLOWED_RUNS.test(String(req.body.carryFrom))) {
                args.push(`--carry-from=${req.body.carryFrom}`);
            } else if (req.body?.carryLatest !== false) {
                args.push('--carry-latest');
            }
            if (req.body?.prefillDrafts !== false) {
                args.push('--prefill-drafts');
            }
            const job = benchRunner.createJob({ kind: 'gold-template', scriptName: 'build-gold-template.js', args });
            return res.status(202).json({ jobId: job.id });
        } catch (error) {
            if (error.statusCode === 409) {
                return res.status(409).json({ error: error.message, activeJobId: error.activeJobId });
            }
            return res.status(400).json({ error: error.message });
        }
    });

    router.post('/probe', writeLimiter, (req, res) => {
        try {
            if (req.body?.approved !== true) {
                return res.status(400).json({ error: 'Explicit probe approval required.' });
            }
            if (!process.env.OPENROUTER_API_KEY) {
                return res.status(400).json({ error: 'Set OPENROUTER_API_KEY in the server environment first.' });
            }
            const models = Array.isArray(req.body?.models) ? req.body.models : [req.body?.model];
            if (!models.length || models.length > 4 || models.some((model) => !ALLOWED_MODELS.test(model || ''))) {
                return res.status(400).json({ error: 'Enter 1–4 valid provider/model slugs.' });
            }
            const job = benchRunner.createJob({
                kind: 'probe',
                scriptName: 'benchmark-pdf-engines.js',
                args: [`--models=${models.join(',')}`, '--probe', '--approved'],
            });
            return res.status(202).json({ jobId: job.id });
        } catch (error) {
            if (error.statusCode === 409) {
                return res.status(409).json({ error: error.message, activeJobId: error.activeJobId });
            }
            return res.status(400).json({ error: error.message });
        }
    });

    function handleLaunchRun(req, res) {
        try {
            const body = req.body || {};
            const docs = getSelectedDocs(body.docIds);
            const smokeRun = body.smoke === true;
            const dryRun = body.dryRun === true;
            assertRunScope({ docs, smokeRun, dryRun });
            const models = Array.isArray(body.models) ? [...body.models] : [];
            if (!models.length || models.length > 4 || models.some((model) => !ALLOWED_MODELS.test(model))) {
                return res.status(400).json({ error: 'Enter 1–4 valid provider/model slugs.' });
            }
            const baseline = body.baseline === false ? null : String(body.baseline || 'google/gemini-2.5-flash');
            if (baseline) {
                if (!ALLOWED_MODELS.test(baseline)) {
                    return res.status(400).json({ error: 'Enter a valid baseline provider/model slug.' });
                }
                if (!models.includes(baseline)) {
                    if (models.length >= 4) {
                        return res.status(400).json({ error: 'Select at most 3 challenger models so the baseline fits.' });
                    }
                    models.push(baseline);
                }
            }
            const analysisMode = body.analysisMode === undefined ? 'bounded' : body.analysisMode;
            if (!['bounded', 'single'].includes(analysisMode)) {
                return res.status(400).json({ error: 'Analysis mode must be bounded or single.' });
            }
            const maxCost = Number(body.maxCost);
            if (!Number.isFinite(maxCost) || maxCost < 0) {
                return res.status(400).json({ error: 'Set a finite non-negative hard cost cap.' });
            }
            if (!dryRun) {
                if (body.approved !== true) {
                    return res.status(400).json({ error: 'Live benchmark approval is required.' });
                }
                if (maxCost <= 0) {
                    return res.status(400).json({ error: 'Live benchmark requires maxCost > 0.' });
                }
                if (!process.env.OPENROUTER_API_KEY) {
                    return res.status(400).json({ error: 'Set OPENROUTER_API_KEY in the server environment first.' });
                }
            }
            const goldDir = body.goldDir ? path.resolve(body.goldDir) : null;
            if (goldDir && (!goldDir.startsWith(`${dataRoot}${path.sep}`) || !fs.existsSync(goldDir) || !fs.statSync(goldDir).isDirectory())) {
                return res.status(400).json({ error: 'Gold facts must be a local folder under backend/data/pdf-engine-bench.' });
            }
            const args = [
                `--models=${models.join(',')}`,
                ...docs.map((doc) => `--doc-id=${doc.docId}`),
                `--max-docs=${docs.length}`,
                `--max-pages=${docs.reduce((sum, doc) => sum + doc.pages, 0)}`,
                `--max-cost=${maxCost}`,
                `--repeats=${Math.max(1, Math.min(5, Number(body.repeats) || 1))}`,
                `--scope=${smokeRun ? 'smoke' : 'pilot'}`,
            ];
            if (baseline) args.push(`--baseline=${baseline}`);
            args.push(`--analysis-mode=${analysisMode}`);
            if (body.analysisCondition && ['both', 'structured_mode'].includes(body.analysisCondition)) {
                args.push(`--analysis-condition=${body.analysisCondition}`);
            }
            if (goldDir) args.push(`--gold-dir=${goldDir}`);
            if (body.approved === true && !dryRun) args.push('--approved');
            const job = benchRunner.createJob({
                kind: dryRun ? 'dry-run' : 'benchmark',
                scriptName: 'benchmark-pdf-engines.js',
                args,
            });
            return res.status(202).json({ jobId: job.id });
        } catch (error) {
            if (error.statusCode === 409) {
                return res.status(409).json({ error: error.message, activeJobId: error.activeJobId });
            }
            return res.status(400).json({ error: error.message });
        }
    }

    router.post('/runs', writeLimiter, handleLaunchRun);
    router.post('/run', writeLimiter, handleLaunchRun);

    router.post('/report-bench', writeLimiter, async (req, res) => {
        try {
            const result = await runStage2ReportBench(req.body || {});
            return res.json(result);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    });

    router.get('/jobs/:id', readLimiter, (req, res) => {
        const job = benchRunner.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Unknown bench job.' });
        return res.json(job);
    });

    router.get('/jobs/:id/stream', readLimiter, (req, res) => {
        const job = benchRunner.getJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Unknown bench job.' });

        res.set({
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
        });
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        sendSseEvent(res, 'job.progress', job.progress);
        if (job.output) {
            sendSseEvent(res, 'job.log', { line: job.output.slice(-2000) });
        }
        if (job.state === 'done') {
            sendSseEvent(res, 'job.done', { jobId: job.id, runId: job.runId, summary: job.summary });
            return res.end();
        }
        if (job.state === 'failed' || job.state === 'canceled') {
            sendSseEvent(res, 'job.error', { jobId: job.id, error: `Job ${job.state}.` });
            return res.end();
        }

        const unsubscribe = benchRunner.subscribeJob(job.id, ({ event, data }) => {
            sendSseEvent(res, event, data);
            if (event === 'job.done' || event === 'job.error') {
                unsubscribe();
                res.end();
            }
        });

        req.on('close', () => {
            unsubscribe();
        });
        return undefined;
    });

    router.post('/jobs/:id/cancel', writeLimiter, (req, res) => {
        const job = benchRunner.cancelJob(req.params.id);
        if (!job) return res.status(404).json({ error: 'Unknown bench job.' });
        return res.json(job);
    });

    return router;
}

module.exports = {
    createBenchRouter,
};
