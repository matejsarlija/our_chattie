'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
    OIB_CASE_DOCS,
    SMOKE_DOC_IDS,
    FULL_PILOT_MIN,
    FULL_PILOT_MAX,
    assertRunScope,
} = require('../scripts/lib/lab-documents');
const { loadDocuments, extractTranscriptProvider } = require('../scripts/benchmark-pdf-engines');
const { readCache } = require('../scripts/lib/capabilities');
const { createOpenRouterClient } = require('../llm/openrouterClient');
const { buildAnalysisPrompt } = require('../court-analysis/extraction/prompts');
const { scoreReferenceFreeExtraction } = require('./metrics');

const DEFAULT_DATA_ROOT = path.resolve(__dirname, '../data/pdf-engine-bench');
const ALLOWED_RUNS = /^[0-9TZ-]+-[a-f0-9]{8}$/;

const KERUM_SMOKE_CANDIDATES = [
    {
        id: 'kerum-zavrsni-racun-table-21-32-35',
        docName: 'Završni račun.pdf:table-21/32/35',
        triggerReasons: ['16384_token_truncation', 'total-parts-mismatch', 'smoke-calibration'],
        frozenTranscript: 'Završni račun stečajnog dužnika KERUM d.o.o. u stečaju (OIB 66124057408). Ukupno prijavljene tražbine I. i II. višeg isplatnog reda iznose 136.077.942,31 EUR.',
    },
    {
        id: 'kerum-ugovor-o-ustupu-table-8',
        docName: 'Ugovor o ustupu:table-8',
        triggerReasons: ['16384_token_truncation', 'assignment_cue', 'smoke-calibration'],
        frozenTranscript: 'Ugovor o ustupu tražbine od 30.11.2017. ADRIA RESORTS d.o.o. stječe tražbine od HETA ASSET RESOLUTION AG i H-ABDUCO d.o.o.',
    },
    {
        id: 'kerum-diobeni-popis',
        docName: 'Diobeni popis.pdf',
        triggerReasons: ['total-parts-mismatch', 'smoke-calibration'],
        frozenTranscript: 'Diobeni popis vjerovnika prvog i drugog višeg isplatnog reda u stečajnom postupku St-2/2013 nad dužnikom KERUM d.o.o.',
    },
    {
        id: 'kerum-prigovor',
        docName: 'Prigovor.pdf',
        triggerReasons: ['ungrounded:7', 'smoke-calibration'],
        frozenTranscript: 'Prigovor vjerovnika na diobeni popis u predmetu Trgovačkog suda u Splitu poslovni broj St-2/2013.',
    },
];

function getSelectedDocs(ids) {
    const maxDocs = Math.max(FULL_PILOT_MAX, OIB_CASE_DOCS.length);
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > maxDocs) {
        throw new Error(`Select between 1 and ${maxDocs} fixture documents.`);
    }
    const allowed = new Set(OIB_CASE_DOCS.map((doc) => doc.docId));
    if (ids.some((id) => !allowed.has(id)) || new Set(ids).size !== ids.length) {
        throw new Error('Document selection contains an unknown or duplicate fixture ID.');
    }
    return ids.map((id) => OIB_CASE_DOCS.find((doc) => doc.docId === id));
}

function listCorpusDocuments({ model = 'z-ai/glm-5.3-flash' } = {}) {
    const local = loadDocuments({ 'doc-id': OIB_CASE_DOCS.map((doc) => doc.docId) });
    const actualIds = new Set(local.map((doc) => doc.docId));
    const documents = OIB_CASE_DOCS
        .filter((doc) => actualIds.has(doc.docId))
        .map((doc) => ({
            ...doc,
            fileName: doc.docId.slice(doc.docId.indexOf(':') + 1),
            tableLike: /schedule|account|specification|claim totals|statement|troškovnik|distribution|table|izvod/i.test(`${doc.role} ${doc.evidence}`),
        }));
    const cached = readCache().models?.[model]?.capabilities || {};
    return {
        documents,
        smokeDocIds: SMOKE_DOC_IDS,
        pilotRange: { min: FULL_PILOT_MIN, max: FULL_PILOT_MAX },
        capabilities: { fileNative: cached.fileNative ?? null, imageInput: cached.imageInput ?? null },
    };
}

let corpusCache = null;
function corpusDocuments(docId = null) {
    if (!corpusCache) corpusCache = new Map();
    if (docId && corpusCache.has(docId)) return corpusCache;
    const targets = docId && !corpusCache.has(docId)
        ? [{ docId }]
        : OIB_CASE_DOCS.filter((doc) => !corpusCache.has(doc.docId));
    for (const target of targets) {
        try {
            const [doc] = loadDocuments({ 'doc-id': [target.docId] });
            if (doc) corpusCache.set(target.docId, doc);
        } catch {
            // Missing fixture hides page images only.
        }
    }
    return corpusCache;
}

function enrichReportWithTranscriptSources(report, dataRoot = DEFAULT_DATA_ROOT) {
    if (!report || !Array.isArray(report.rows)) return report;
    const cache = new Map();
    const readMeta = (docId) => {
        if (cache.has(docId)) return cache.get(docId);
        let meta = null;
        try {
            const txPath = path.join(dataRoot, 'fixtures', 'transcripts', `${docId}.json`);
            if (fs.existsSync(txPath)) {
                const fixture = JSON.parse(fs.readFileSync(txPath, 'utf8'));
                const sourceArm = fixture?.canonicalTranscript?.sourceArm || null;
                if (sourceArm) {
                    meta = {
                        transcriptSourceArm: sourceArm,
                        transcriptProvider: extractTranscriptProvider(fixture, sourceArm),
                    };
                }
            }
        } catch {
            // Historical enrichment is best-effort.
        }
        cache.set(docId, meta);
        return meta;
    };
    let changed = false;
    const rows = report.rows.map((row) => {
        if (!row || (row.stage !== 'A' && row.arm !== 'local-text') || row.transcriptSourceArm || !row.docId) {
            return row;
        }
        const meta = readMeta(row.docId);
        if (!meta) return row;
        changed = true;
        return {
            ...row,
            transcriptSourceArm: meta.transcriptSourceArm,
            transcriptProvider: row.transcriptProvider ?? meta.transcriptProvider ?? null,
        };
    });
    return changed ? { ...report, rows } : report;
}

function readParserOutput(runId, { docId, arm, model, repeat }, dataRoot = DEFAULT_DATA_ROOT) {
    if (!ALLOWED_RUNS.test(String(runId || ''))) throw new Error('Unknown benchmark run ID.');
    if (!['or-cloudflare', 'or-mistral-ocr'].includes(arm)) throw new Error('Unknown parser arm.');
    if (typeof docId !== 'string' || !docId || typeof model !== 'string' || !model) {
        throw new Error('Document and model are required.');
    }
    const repeatNumber = Number(repeat);
    if (!Number.isInteger(repeatNumber) || repeatNumber < 1) {
        throw new Error('Repeat must be a positive integer.');
    }

    const runDir = path.join(dataRoot, runId);
    const reportPath = path.join(runDir, 'report.json');
    if (!fs.existsSync(reportPath)) throw new Error('Benchmark report not found.');
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const row = report.rows?.find(
        (item) => item.docId === docId && item.arm === arm && item.model === model && item.repeat === repeatNumber,
    );
    if (!row || row.status === 'SKIPPED') {
        throw new Error('No completed parser output exists for this sample.');
    }

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
        analysisSegmentation: artifact.analysisSegmentation || row.analysisSegmentation || null,
    };
}

function seedDefaultBenchCandidates(sqliteStore) {
    if (!sqliteStore?.db) return { seeded: 0, candidates: [] };
    const existing = new Set(sqliteStore.listBenchCandidates({ limit: 200 }).map((c) => c.id));
    let seeded = 0;
    for (const item of KERUM_SMOKE_CANDIDATES) {
        if (existing.has(item.id)) continue;
        const contentHash = crypto.createHash('sha256').update(item.frozenTranscript).digest('hex');
        sqliteStore.insertBenchCandidate({
            id: item.id,
            runId: 'kerum-smoke-seed',
            contentHash,
            docName: item.docName,
            frozenTranscript: item.frozenTranscript,
            triggerReasons: item.triggerReasons,
            status: 'pending',
        });
        seeded += 1;
    }
    return { seeded, candidates: sqliteStore.listBenchCandidates({ limit: 100 }) };
}

async function runCandidateMicroBench({
    sqliteStore,
    candidateId,
    model = 'z-ai/glm-5.3-flash',
    dryRun = false,
    approved = false,
    maxCost = 0,
    clientFactory = createOpenRouterClient,
} = {}) {
    if (!sqliteStore?.db) throw new Error('SQLite store is required for micro-benching.');
    const row = sqliteStore.db.prepare('SELECT * FROM bench_candidates WHERE id = ?').get(candidateId);
    if (!row) throw new Error('Unknown bench candidate.');
    if (!dryRun) {
        if (approved !== true) throw new Error('Explicit approval is required for live micro-bench.');
        if (!Number.isFinite(Number(maxCost)) || Number(maxCost) <= 0) {
            throw new Error('Set a strict positive maxCost > 0 for live micro-bench.');
        }
    }

    const transcript = String(row.frozen_transcript || '');
    if (dryRun) {
        const baselineScore = row.prod_ai_result_json
            ? scoreReferenceFreeExtraction({ aiResult: JSON.parse(row.prod_ai_result_json), sourceText: transcript })
            : null;
        return {
            candidateId: row.id,
            docName: row.doc_name,
            model,
            dryRun: true,
            estimatedCostUsd: 0.001,
            baselineScore,
        };
    }

    const client = clientFactory({
        model,
        taskType: 'BenchMicroEval',
        runId: row.run_id || null,
        docHash: row.content_hash,
        traceStore: sqliteStore,
    });
    const prompt = buildAnalysisPrompt(row.doc_name || 'candidate.pdf', transcript, {});
    const started = Date.now();
    const response = await client.invoke(prompt);
    const latencyMs = Date.now() - started;
    let parsed = {};
    try {
        parsed = typeof response?.content === 'string' ? JSON.parse(response.content) : (response?.content || {});
    } catch {
        parsed = {};
    }
    const score = scoreReferenceFreeExtraction({ aiResult: parsed, sourceText: transcript });
    sqliteStore.db.prepare('UPDATE bench_candidates SET status = ? WHERE id = ?').run('evaluated', row.id);
    return {
        candidateId: row.id,
        docName: row.doc_name,
        model,
        dryRun: false,
        latencyMs,
        score,
        costUsd: Number(response?.usage?.costUsd || 0),
    };
}

module.exports = {
    DEFAULT_DATA_ROOT,
    ALLOWED_RUNS,
    KERUM_SMOKE_CANDIDATES,
    OIB_CASE_DOCS,
    SMOKE_DOC_IDS,
    FULL_PILOT_MIN,
    FULL_PILOT_MAX,
    assertRunScope,
    getSelectedDocs,
    listCorpusDocuments,
    corpusDocuments,
    enrichReportWithTranscriptSources,
    readParserOutput,
    seedDefaultBenchCandidates,
    runCandidateMicroBench,
};
