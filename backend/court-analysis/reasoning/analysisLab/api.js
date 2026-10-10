// backend/court-analysis/reasoning/analysisLab/api.js
//
// LE-3 — Analysis Lab read-only API surface (spec §§4, 7).
//
// Router factory (same shape as `change-detection/api.js`) so supertest
// coverage mounts it without booting the full server:
//
//   GET  /packages            eligible frozen run/package references (summary)
//   POST /experiments         run a three-profile comparison (201, full record)
//   GET  /experiments         list experiments (summary-only, paginated)
//   GET  /experiments/:id     one full experiment (reports, traces,
//                             scorecards, snapshots, comparison view model)
//
// Boundaries (spec N2/N4, §8):
// - Creation always runs exactly the three built-in profiles from one frozen
//   evidence package. Arbitrary profile/model/prompt input is rejected; only
//   an allow-list of replay metadata (`codeRevision`, gates, retrieval/rerank
//   settings, limits, feature flags) passes through.
// - No live-case route: the package resolves from a built-in fixture or a
//   completed analysis run's persisted `clusterEvidencePackage`. There is no
// - "rerun live case" endpoint and no mutation of canonical input.
// - Auth/rate limiting mirror the analysis endpoints: the host app supplies
//   the same read/write IP limiters (this module applies them, it does not
//   invent its own policy).

const express = require('express');
const fs = require('fs');
const path = require('path');

const { PROFILE_IDS, isKnownProfile } = require('./profiles');
const {
    evidencePackageDigest,
    cloneEvidencePackage,
} = require('./evidenceIdentity');
const { validateClusterEvidencePackage } = require('../evidencePackage');
const { buildComparisonViewModel } = require('./scorecard');
const { boundExperimentForResponse } = require('./traceBounds');
const { buildInputSummary } = require('./runExperiment');
const { parsePagination } = require('../../../helpers/pagination');
const { collectContextFacts } = require('../caseContextBuilder');

const DEFAULT_FIXTURES_DIR = path.join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'replays', 'analysis-lab');

// Body keys that would smuggle arbitrary model/profile/prompt execution into
// a comparison. Rejected outright on POST /experiments.
const FORBIDDEN_CREATE_KEYS = [
    'profile',
    'model',
    'models',
    'modelRoles',
    'prompt',
    'prompts',
    'promptVersions',
    'promptVersion',
    'strategy',
    'contextStrategy',
    'budgets',
    'nodeSummaries',
];

// Replay metadata that may influence setup snapshots. Anything else in
// `runtimeMetadata` is ignored (snapshots allow-list downstream too).
const RUNTIME_METADATA_KEYS = ['codeRevision', 'gates', 'retrieval', 'rerank', 'limits', 'featureFlags'];

function badRequest(message) {
    const err = new Error(message);
    err.statusCode = 400;
    return err;
}

function sanitizeRuntimeMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out = {};
    for (const key of RUNTIME_METADATA_KEYS) {
        if (value[key] !== undefined) out[key] = value[key];
    }
    return out;
}

function validateCreateBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw badRequest('Request body must be a JSON object with evidencePackageRef.');
    }
    for (const key of FORBIDDEN_CREATE_KEYS) {
        if (body[key] !== undefined) {
            throw badRequest(`Arbitrary ${key} input is not allowed; comparisons always run the three built-in profiles.`);
        }
    }
    if (body.evidencePackage !== undefined) {
        throw badRequest('Inline evidence packages are not accepted; reference a frozen fixture or a completed analysis run.');
    }
    const { evidencePackageRef, profiles, runtimeMetadata } = body;
    if (!evidencePackageRef || typeof evidencePackageRef !== 'string') {
        throw badRequest('evidencePackageRef is required (fixture id or completed analysis-run id).');
    }
    if (profiles !== undefined) {
        if (!Array.isArray(profiles)) {
            throw badRequest('profiles must be exactly the three built-in profile ids.');
        }
        const unknown = profiles.filter((id) => !isKnownProfile(id));
        if (unknown.length > 0) {
            throw badRequest(`Unknown analysis-lab profile: ${unknown.join(', ')}. Known profiles: ${PROFILE_IDS.join(', ')}.`);
        }
        const missing = PROFILE_IDS.filter((id) => !profiles.includes(id));
        if (missing.length > 0 || profiles.length !== PROFILE_IDS.length) {
            throw badRequest(`Experiments must run all three built-in profiles; missing: ${missing.join(', ') || 'none (unexpected extras)'}.`);
        }
    }
    if (runtimeMetadata !== undefined && (typeof runtimeMetadata !== 'object' || runtimeMetadata === null || Array.isArray(runtimeMetadata))) {
        throw badRequest('runtimeMetadata must be an object when supplied.');
    }
    return {
        evidencePackageRef,
        profiles: profiles === undefined ? [...PROFILE_IDS] : [...profiles],
        runtimeMetadata: sanitizeRuntimeMetadata(runtimeMetadata),
    };
}

function loadFixturePackage(fixturesDir, ref) {
    const file = path.join(fixturesDir, `${ref}.json`);
    let raw;
    try {
        raw = fs.readFileSync(file, 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
    return JSON.parse(raw);
}

function listFixturePackages(fixturesDir) {
    let files = [];
    try {
        files = fs.readdirSync(fixturesDir).filter((name) => name.endsWith('.json'));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
    const packages = [];
    for (const file of files) {
        try {
            const pkg = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), 'utf8'));
            if (validateClusterEvidencePackage(pkg).valid) {
                const ref = path.basename(file, '.json');
                packages.push({
                    ref,
                    kind: 'fixture',
                    caseNumber: pkg.clusterId || pkg.primaryCaseNumber || null,
                    evidencePackageHash: evidencePackageDigest(pkg),
                    inputSummary: buildInputSummary(pkg),
                    createdAt: null,
                });
            }
        } catch (err) {
            // Skip unreadable fixture files; the comparison path validates.
        }
    }
    return packages;
}

function summarizeExperiment(experiment) {
    const variants = experiment?.variants && typeof experiment.variants === 'object' ? experiment.variants : {};
    const variantStatus = {};
    for (const profileId of experiment?.profiles || []) {
        variantStatus[profileId] = variants[profileId]?.status || 'missing';
    }
    return {
        id: experiment.id,
        createdAt: experiment.createdAt,
        completedAt: experiment.completedAt || null,
        updatedAt: experiment.updatedAt || null,
        status: experiment.status,
        evidencePackageRef: experiment.evidencePackageRef,
        evidencePackageHash: experiment.evidencePackageHash,
        inputSummary: experiment.inputSummary || null,
        profiles: experiment.profiles,
        sharedUpstream: experiment.sharedUpstream || null,
        sharedUsage: experiment.sharedUsage || null,
        executionSnapshot: experiment.executionSnapshot || null,
        variantStatus,
    };
}

function createAnalysisLabRouter(options = {}) {
    const labStore = options.labStore;
    if (!labStore || typeof labStore.createExperiment !== 'function') {
        throw new Error('createAnalysisLabRouter requires a labStore (analysisLabStore).');
    }
    const analysisStore = options.analysisStore || null;
    const runExperimentFn = options.runExperimentFn || require('./runExperiment').runExperiment;
    const fixturesDir = options.fixturesDir || DEFAULT_FIXTURES_DIR;
    const readLimiter = options.readLimiter || null;
    const writeLimiter = options.writeLimiter || null;

    const router = express.Router();

    async function resolveFrozenPackage(ref) {
        const fixture = loadFixturePackage(fixturesDir, ref);
        if (fixture) {
            const validation = validateClusterEvidencePackage(fixture);
            if (!validation.valid) {
                throw badRequest(`Fixture ${ref} is not a valid frozen evidence package (${validation.error}).`);
            }
            return { evidencePackage: fixture, kind: 'fixture' };
        }
        if (!analysisStore || typeof analysisStore.getAnalysisRunFull !== 'function') {
            const notFound = new Error(`Unknown evidence package ref: ${ref}.`);
            notFound.statusCode = 400;
            notFound.code = 'unknown-package-ref';
            throw notFound;
        }
        let full;
        try {
            full = await analysisStore.getAnalysisRunFull({ id: ref });
        } catch (err) {
            const notFound = new Error(`Unknown evidence package ref: ${ref}.`);
            notFound.statusCode = 400;
            notFound.code = 'unknown-package-ref';
            throw notFound;
        }
        const pkg = full?.run?.result_json?.clusterEvidencePackage || null;
        if (!pkg) {
            const err = new Error(`Analysis run ${ref} has no persisted frozen evidence package (clusterEvidencePackage).`);
            err.statusCode = 400;
            err.code = 'no-frozen-package';
            throw err;
        }
        const validation = validateClusterEvidencePackage(pkg);
        if (!validation.valid) {
            throw badRequest(`Analysis run ${ref} carries an invalid evidence package (${validation.error}).`);
        }
        return { evidencePackage: pkg, kind: 'analysis-run' };
    }
    function safeSourceUrl(value) {
        try {
            const url = new URL(value);
            if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null;
            return url.href;
        } catch {
            return null;
        }
    }

    function buildSourceDocuments(evidencePackage) {
        const linksById = new Map(
            (Array.isArray(evidencePackage?.documentLinks) ? evidencePackage.documentLinks : [])
                .filter((link) => link?.id)
                .map((link) => [link.id, link])
        );
        return (Array.isArray(evidencePackage?.analyses) ? evidencePackage.analyses : [])
            .filter((analysis) => analysis?.id)
            .map((analysis) => {
                const link = linksById.get(analysis.sourceDocumentLinkId);
                const rawName = analysis.fileName || link?.text || 'Izvorni dokument';
                return {
                    analysisId: String(analysis.id),
                    sourceDocumentLinkId: link?.id || null,
                    fileName: String(rawName).split(/[\\/]/).pop(),
                    url: safeSourceUrl(link?.url),
                };
            });
    }

    function addUngroundedFactDetails(experiment, evidencePackage) {
        const factsById = new Map(collectContextFacts(evidencePackage).map((fact) => [fact.factId, fact]));
        const variants = experiment?.variants && typeof experiment.variants === 'object'
            ? experiment.variants
            : {};
        for (const variant of Object.values(variants)) {
            const fragments = variant?.trace?.fragments?.contextNodes;
            if (!Array.isArray(fragments)) continue;
            for (const fragment of fragments) {
                const gaps = Array.isArray(fragment?.coverage?.gaps) ? fragment.coverage.gaps : [];
                const factIds = [...new Set(gaps
                    .filter((gap) => typeof gap === 'string' && gap.startsWith('ungrounded:'))
                    .map((gap) => gap.slice('ungrounded:'.length)))];
                const ungroundedFacts = factIds.slice(0, 12).flatMap((factId) => {
                    const fact = factsById.get(factId);
                    if (!fact) return [];
                    const quote = typeof fact.quote === 'string' && fact.quote.trim() ? fact.quote : null;
                    return [{
                        factId,
                        sourceId: fact.analysisId || null,
                        fileName: fact.fileName || null,
                        quoteProvided: Boolean(quote),
                        excerpt: String(quote || fact.description || '').slice(0, 600),
                    }];
                });
                fragment.ungroundedFactCount = factIds.length;
                fragment.ungroundedFacts = ungroundedFacts;
                fragment.ungroundedFactDetailsOmittedCount = Math.max(0, factIds.length - ungroundedFacts.length);
            }
        }
    }


    // List eligible frozen packages: built-in fixtures + completed analysis
    // runs that persisted a `clusterEvidencePackage`. Summary-only.
    router.get('/packages', ...(readLimiter ? [readLimiter] : []), async (req, res) => {
        try {
            const packages = listFixturePackages(fixturesDir);
            if (analysisStore && typeof analysisStore.listAnalysisRuns === 'function') {
                try {
                    // includeResults: the catalogue is built from each run's
                    // evidence package, which lives in the heavy result_json.
                    // The list route strips that by default to keep the
                    // dashboard page small, so ask for it explicitly here.
                    const { data } = await analysisStore.listAnalysisRuns({ limit: 100, offset: 0, includeResults: true });
                    for (const run of Array.isArray(data) ? data : []) {
                        const pkg = run?.result_json?.clusterEvidencePackage || null;
                        if (!pkg || validateClusterEvidencePackage(pkg).valid !== true) continue;
                        packages.push({
                            ref: run.id,
                            kind: 'analysis-run',
                            caseNumber: run.query_value || run.oib || pkg.clusterId || null,
                            evidencePackageHash: evidencePackageDigest(pkg),
                            inputSummary: buildInputSummary(pkg),
                            createdAt: run.created_at || null,
                        });
                    }
                } catch (err) {
                    return res.status(500).json({ error: 'Failed to list analysis runs.' });
                }
            }
            res.json({ packages, count: packages.length });
        } catch (err) {
            res.status(500).json({ error: 'Failed to list frozen packages.' });
        }
    });

    // Run a comparison. Always all three built-in profiles, one frozen hash.
    // A candidate failure still yields a `partial` record (201), never an
    // empty 500 — the failure stays inspectable via GET /experiments/:id.
    router.post('/experiments', ...(writeLimiter ? [writeLimiter] : []), async (req, res) => {
        let parsed;
        try {
            parsed = validateCreateBody(req.body);
        } catch (err) {
            return res.status(err.statusCode === 400 ? 400 : 500).json({ error: err.message, code: 'invalid-lab-request' });
        }
        let frozen;
        try {
            frozen = await resolveFrozenPackage(parsed.evidencePackageRef);
        } catch (err) {
            return res.status(err.statusCode === 400 ? 400 : 500).json(
                err.code ? { error: err.message, code: err.code } : { error: err.message }
            );
        }
        try {
            const experiment = await runExperimentFn({
                evidencePackage: cloneEvidencePackage(frozen.evidencePackage),
                evidencePackageRef: parsed.evidencePackageRef,
                profiles: parsed.profiles,
                runtimeMetadata: parsed.runtimeMetadata,
                store: labStore,
                production: true,
            });
            return res.status(201).json({
                experiment: summarizeExperiment(experiment),
                comparison: buildComparisonViewModel(experiment),
            });
        } catch (err) {
            const status = err.statusCode === 400 ? 400 : 500;
            return res.status(status).json(
                err.code ? { error: err.message, code: err.code } : { error: err.message, code: 'experiment-failed' }
            );
        }
    });

    // List experiments, summary-only (reports/traces never travel here).
    router.get('/experiments', ...(readLimiter ? [readLimiter] : []), async (req, res) => {
        try {
            const { limit, offset } = parsePagination(req.query);
            const result = await labStore.listExperiments({ limit, offset });
            res.json({
                experiments: result.data.map(summarizeExperiment),
                count: result.count,
                limit,
                offset,
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to load experiments.' });
        }
    });

    // Full experiment: reports, bounded traces/fragments, scorecards,
    // profile snapshots, plus the deterministic comparison view model.
    // Traces are response-bounded (see traceBounds.js); the persisted record
    // stays complete for audit.
    router.get('/experiments/:id', ...(readLimiter ? [readLimiter] : []), async (req, res) => {
        try {
            const experiment = await labStore.getExperiment({ id: req.params.id });
            const bounded = boundExperimentForResponse(experiment);
            let sourceDocuments = [];
            let sourceDocumentsStatus = 'unavailable';
            try {
                const frozen = await resolveFrozenPackage(experiment.evidencePackageRef);
                if (evidencePackageDigest(frozen.evidencePackage) === experiment.evidencePackageHash) {
                    addUngroundedFactDetails(bounded, frozen.evidencePackage);
                    sourceDocuments = buildSourceDocuments(frozen.evidencePackage);
                    sourceDocumentsStatus = sourceDocuments.some((document) => document.url)
                        ? 'available'
                        : 'no-links';
                } else {
                    sourceDocumentsStatus = 'package-changed';
                }
            } catch {
                sourceDocumentsStatus = 'unavailable';
            }
            res.json({
                experiment: { ...bounded, sourceDocuments, sourceDocumentsStatus },
                comparison: buildComparisonViewModel(bounded),
            });
        } catch (err) {
            res.status(404).json({ error: 'Analysis Lab experiment not found.', code: 'experiment-not-found' });
        }
    });

    return router;
}

module.exports = {
    createAnalysisLabRouter,
    validateCreateBody,
    summarizeExperiment,
    FORBIDDEN_CREATE_KEYS,
};
