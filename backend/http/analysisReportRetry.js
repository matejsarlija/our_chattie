const { friendlyAnalysisErrorMessage } = require('./friendlyAnalysisError');

function parseStoredResultJson(run) {
  const raw = run?.result_json ?? run?.resultJson ?? null;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function createAnalysisReportRetryHandler({ store, regenerate, composeNarrative }) {
  const compose = typeof composeNarrative === 'function' ? composeNarrative : () => '';

  return async (req, res) => {
    let run;
    try {
      run = await store.getAnalysisRun({ id: req.params.id });
    } catch (error) {
      return res.status(404).json({ error: 'Analysis run not found.' });
    }

    if (String(run?.status || '').toLowerCase() === 'running') {
      return res.status(409).json({ error: 'Analiza je još u tijeku. Ponovni pokušaj dostupan je po završetku.' });
    }

    const stored = parseStoredResultJson(run);
    const evidencePackage = stored?.clusterEvidencePackage || null;
    if (!evidencePackage) {
      return res.status(409).json({ error: 'Nema sačuvanih dokaza za ponovnu izradu izvještaja.' });
    }
    if (stored.report && stored.report.generationMode !== 'deterministic_fallback') {
      return res.status(409).json({ error: 'Stručni izvještaj već postoji.' });
    }

    let hydratedPackage = evidencePackage;
    if (!Array.isArray(evidencePackage.factLedger) && typeof store.listRunFacts === 'function') {
      try {
        const listed = store.listRunFacts({ runId: run.id, limit: 5000, offset: 0 });
        if (Array.isArray(listed?.facts) && listed.facts.length > 0) {
          hydratedPackage = { ...evidencePackage, factLedger: listed.facts };
        }
      } catch {
        // Non-fatal: continue with stored evidencePackage
      }
    }

    try {
      const report = await regenerate(hydratedPackage, { runId: run.id, analysisStore: store });
      const narrative = compose(report);
      const updated = await store.updateAnalysisRunReport({
        analysisId: run.id,
        resultText: narrative,
        resultJson: { report, comparativeAnalysis: narrative, reportError: null },
      });
      await store.appendAnalysisEvent({
        analysisId: run.id,
        eventType: 'report-retry',
        message: 'Stručni izvještaj je naknadno izrađen.',
        metadata: {},
      }).catch(() => {});
      return res.json({ run: updated });
    } catch (error) {
      const message = friendlyAnalysisErrorMessage(error, { stage: 'reasoning', hasPartial: true });
      await store.updateAnalysisRunReport({
        analysisId: run.id,
        resultJson: { reportError: error?.message || String(error) },
      }).catch(() => {});
      await store.appendAnalysisEvent({
        analysisId: run.id,
        eventType: 'report-retry',
        message,
        metadata: { failed: true },
      }).catch(() => {});
      return res.status(500).json({ error: message });
    }
  };
}

module.exports = {
  createAnalysisReportRetryHandler,
  parseStoredResultJson,
};
