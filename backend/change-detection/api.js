// change-detection/api.js
//
// REST surface for Phase B2 (spec §8): exposes the B1 change-check service
// over HTTP. Kept as an express Router FACTORY so supertest coverage mounts it
// directly without booting the full server.
//
//   POST /api/change-detection/check          { query: { type, value } }
//   GET  /api/change-detection/history/:queryId
//
// Error contract (spec H-08 AC3): invalid input -> 400; CSV fetch/parse
// failures map through `friendlyAnalysisErrorMessage` to a transparent
// Croatian message -> 502 (the upstream e-Oglasna export failed); anything
// else -> 500.

const express = require('express');
const { parseCourtAnalysisRequest } = require('../helpers/courtAnalysisRequest');
const { friendlyAnalysisErrorMessage } = require('../helpers/friendlyAnalysisError');
const { CsvExportError } = require('../scraper/csvExportClient');

const QUERY_ID_RE = /^[0-9a-f]{40}$/;

function createChangeDetectionRouter(options = {}) {
    const service = options.service;
    if (!service || typeof service.runCheck !== 'function') {
        throw new Error('createChangeDetectionRouter requires a change-check service.');
    }

    const router = express.Router();
    const writeLimiter = options.writeLimiter || null;
    const readLimiter = options.readLimiter || null;

    router.post('/check', ...(writeLimiter ? [writeLimiter] : []), async (req, res) => {
        let parsed;
        try {
            parsed = parseCourtAnalysisRequest(req.body);
        } catch (err) {
            if (err.statusCode === 400) {
                return res.status(400).json({ error: err.message });
            }
            throw err;
        }

        try {
            const result = await service.runCheck(parsed.query);
            return res.status(200).json({
                ok: true,
                queryId: result.queryId,
                baseline: result.baseline,
                warnings: result.warnings,
                snapshot: result.snapshot,
                diff: result.diff
            });
        } catch (err) {
            if (err instanceof CsvExportError || err.name === 'CsvExportError') {
                // Transient upstream problem — report it honestly; never let it
                // look like "everything was removed".
                return res.status(502).json({
                    error: friendlyAnalysisErrorMessage(err, { stage: 'discovering' })
                });
            }
            console.error('[ChangeDetection] check failed:', err && err.stack ? err.stack : err);
            return res.status(500).json({ error: 'Provjera promjena nije uspjela zbog interne greške.' });
        }
    });

    router.get('/history/:queryId', ...(readLimiter ? [readLimiter] : []), async (req, res) => {
        const queryId = String(req.params.queryId || '').trim().toLowerCase();
        if (!QUERY_ID_RE.test(queryId)) {
            return res.status(400).json({ error: 'Invalid queryId. Expected a 40-character sha1 hex string.' });
        }

        try {
            return res.status(200).json(service.store.getHistory(queryId));
        } catch (err) {
            console.error('[ChangeDetection] history read failed:', err && err.stack ? err.stack : err);
            return res.status(500).json({ error: 'Povijest provjera nije mogla biti učitana.' });
        }
    });

    return router;
}

module.exports = { createChangeDetectionRouter };
