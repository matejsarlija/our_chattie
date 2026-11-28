'use strict';

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { DEFAULT_DATA_ROOT, ALLOWED_RUNS, enrichReportWithTranscriptSources } = require('./corpus');

const DEFAULT_SCRIPTS_DIR = path.resolve(__dirname, '../scripts');
const MAX_OUTPUT_CHARS = 48_000;

function redactSecrets(text) {
    const raw = String(text || '');
    const key = process.env.OPENROUTER_API_KEY;
    return key ? raw.split(key).join('[redacted]') : raw;
}

function listRuns(dataRoot = DEFAULT_DATA_ROOT) {
    if (!fs.existsSync(dataRoot)) return [];
    const runs = [];
    for (const entry of fs.readdirSync(dataRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || !ALLOWED_RUNS.test(entry.name)) continue;
        const reportPath = path.join(dataRoot, entry.name, 'report.json');
        if (!fs.existsSync(reportPath)) continue;
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
    return runs.sort((a, b) => b.runId.localeCompare(a.runId));
}

function readRunReport(runId, dataRoot = DEFAULT_DATA_ROOT) {
    if (!ALLOWED_RUNS.test(String(runId || ''))) {
        const err = new Error('Unknown benchmark run ID.');
        err.statusCode = 400;
        throw err;
    }
    const reportPath = path.join(dataRoot, runId, 'report.json');
    if (!fs.existsSync(reportPath)) {
        const err = new Error('Benchmark report not found.');
        err.statusCode = 404;
        throw err;
    }
    const raw = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    return enrichReportWithTranscriptSources(raw, dataRoot);
}

function createBenchRunner({
    dataRoot = DEFAULT_DATA_ROOT,
    scriptsDir = DEFAULT_SCRIPTS_DIR,
    sqliteStore = null,
    spawnImpl = spawn,
} = {}) {
    const jobs = new Map();
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    let activeJobId = null;

    function getActiveJobId() {
        if (activeJobId && jobs.get(activeJobId)?.state === 'running') return activeJobId;
        activeJobId = null;
        return null;
    }

    function emitJobEvent(jobId, eventName, payload) {
        emitter.emit(`job:${jobId}`, { event: eventName, data: payload });
    }

    function parseProgressLine(job, line) {
        if (!line) return;
        const docMatch = /documents\s+·\s+(\d+)\s+selected/.exec(line);
        if (docMatch) {
            job.progress.total = Number(docMatch[1]);
        }
        const cellMatch = /\[\s*(\d+)\s*\/\s*(\d+)\s*\]/.exec(line);
        if (cellMatch) {
            job.progress.done = Number(cellMatch[1]);
            job.progress.total = Number(cellMatch[2]);
        }
        const costMatch = /\$([0-9]+(?:\.[0-9]+)?)/.exec(line);
        if (costMatch) {
            job.progress.costSoFarUsd = Number(costMatch[1]);
        }
    }

    function createJob({ kind, scriptName, args = [] }) {
        const runningId = getActiveJobId();
        if (runningId) {
            const err = new Error('A bench job is already running.');
            err.statusCode = 409;
            err.activeJobId = runningId;
            throw err;
        }

        fs.mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
        const beforeDirectories = new Set(
            fs.readdirSync(dataRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name),
        );

        const id = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
        const job = {
            id,
            kind,
            state: 'running',
            output: '',
            startedAt: new Date().toISOString(),
            finishedAt: null,
            runId: null,
            goldSetId: null,
            summary: null,
            progress: {
                done: 0,
                total: 0,
                currentDoc: null,
                currentModel: null,
                costSoFarUsd: 0,
            },
            _child: null,
        };
        jobs.set(id, job);
        activeJobId = id;

        for (const [oldId, oldJob] of jobs) {
            if (jobs.size <= 40) break;
            if (oldId !== id && oldJob.state !== 'running') jobs.delete(oldId);
        }

        const scriptPath = path.join(scriptsDir, scriptName);
        const child = spawnImpl(process.execPath, [scriptPath, ...args], {
            cwd: path.resolve(scriptsDir, '..'),
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        job._child = child;

        const append = (chunk) => {
            const safe = redactSecrets(chunk.toString('utf8'));
            job.output = (job.output + safe).slice(-MAX_OUTPUT_CHARS);
            for (const line of safe.split(/\r?\n/)) {
                if (!line.trim()) continue;
                parseProgressLine(job, line);
                emitJobEvent(id, 'job.log', { line });
            }
            emitJobEvent(id, 'job.progress', { ...job.progress });
        };

        child.stdout?.on('data', append);
        child.stderr?.on('data', append);
        child.on('error', (error) => {
            job.state = 'failed';
            job.output = (job.output + `\n${redactSecrets(error.message)}`).slice(-MAX_OUTPUT_CHARS);
            job.finishedAt = new Date().toISOString();
            if (activeJobId === id) activeJobId = null;
            emitJobEvent(id, 'job.error', { error: error.message });
        });
        child.on('close', (code) => {
            if (job.state === 'canceled') {
                if (activeJobId === id) activeJobId = null;
                return;
            }
            const paths = [...job.output.matchAll(/"(?:outputDir|filePath|outputPath)":\s*"([^"]+)"/g)].map((m) => m[1]);
            let artifact = paths.map((v) => path.resolve(v)).find((v) => v.startsWith(`${dataRoot}${path.sep}`));
            if (artifact && fs.existsSync(artifact) && fs.statSync(artifact).isFile()) artifact = path.dirname(artifact);
            if (!artifact && fs.existsSync(dataRoot)) {
                const candidates = fs.readdirSync(dataRoot, { withFileTypes: true })
                    .filter((e) => e.isDirectory() && !beforeDirectories.has(e.name))
                    .map((e) => path.join(dataRoot, e.name))
                    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
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
                        job.summary = {
                            scope: report.scope || 'pilot',
                            dryRun: Boolean(report.dryRun),
                            actualCost: report.actualCost || 0,
                            estimatedParserFee: report.estimatedParserFee || 0,
                            documentCount: report.docs?.length || 0,
                            totalPages: report.totalPages || 0,
                        };
                    } catch {
                        // Malformed report ignored for summary.
                    }
                }
                if (job.kind === 'gold-template') {
                    job.goldSetId = path.basename(path.dirname(artifact));
                }
            }
            if (activeJobId === id) activeJobId = null;
            if (code === 0) {
                emitJobEvent(id, 'job.done', { jobId: id, runId: job.runId, summary: job.summary });
            } else {
                emitJobEvent(id, 'job.error', { jobId: id, code, error: `Process exited with code ${code}.` });
            }
        });

        return serializeJob(job);
    }

    function serializeJob(job) {
        if (!job) return null;
        const { _child, ...rest } = job;
        return rest;
    }

    function getJob(id) {
        return serializeJob(jobs.get(id));
    }

    function cancelJob(id) {
        const job = jobs.get(id);
        if (!job) return null;
        if (job.state === 'running') {
            job.state = 'canceled';
            job.finishedAt = new Date().toISOString();
            try {
                job._child?.kill('SIGTERM');
            } catch {
                // Process may have already exited.
            }
            if (activeJobId === id) activeJobId = null;
            emitJobEvent(id, 'job.error', { jobId: id, canceled: true, error: 'Job canceled.' });
        }
        return serializeJob(job);
    }

    function subscribeJob(id, listener) {
        emitter.on(`job:${id}`, listener);
        return () => emitter.off(`job:${id}`, listener);
    }

    function readRunTraces(runId) {
        if (!sqliteStore?.db) return [];
        return sqliteStore.db.prepare(
            'SELECT id, task_type, requested_model, actual_model, provider, latency_ms, cost_usd, finish_reason, created_at FROM llm_traces WHERE run_id = ? ORDER BY created_at DESC LIMIT 200',
        ).all(runId);
    }

    return {
        getActiveJobId,
        createJob,
        getJob,
        cancelJob,
        subscribeJob,
        listRuns: () => listRuns(dataRoot),
        readRunReport: (runId) => readRunReport(runId, dataRoot),
        readRunTraces,
    };
}

module.exports = {
    redactSecrets,
    listRuns,
    readRunReport,
    createBenchRunner,
};
