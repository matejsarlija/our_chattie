import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import DashboardShell from '../Dashboard/DashboardShell';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Callout from '../ui/Callout';
import Input from '../ui/Input';
import StatusBadge from '../ui/StatusBadge';
import { useBenchWorkspace } from '../../hooks/useBenchWorkspace';
import BenchCandidatesPanel from './BenchCandidatesPanel';

const FALLBACK_MODELS = [
  'z-ai/glm-5.3-flash',
  'google/gemini-2.5-flash',
  'google/gemma-4-31b-it',
];

const ROUTING_STAGES = [
  { key: 'extraction', label: 'Ekstrakcija (Stage A)' },
  { key: 'ocr', label: 'OCR (Stage T)' },
  { key: 'synthesis', label: 'Sinteza (Stage 2)' },
  { key: 'verify', label: 'Provjera (Verify)' },
];

const formatModelOptionLabel = (model) => {
  const parts = [model.modelId];
  const hasIn = Number.isFinite(Number(model.inputUsdPerM));
  const hasOut = Number.isFinite(Number(model.outputUsdPerM));
  if (hasIn || hasOut) {
    const inStr = hasIn ? `$${Number(model.inputUsdPerM).toFixed(2)}` : '—';
    const outStr = hasOut ? `$${Number(model.outputUsdPerM).toFixed(2)}` : '—';
    parts.push(`(${inStr}/${outStr} / 1M)`);
  }
  return parts.join(' ');
};

export default function BenchPage() {
  const {
    documents,
    smokeDocIds,
    models,
    runs,
    candidates,
    activeJobId,
    jobProgress,
    jobLogs,
    jobStatus,
    routingOverrides,
    loading,
    error,
    startRun,
    cancelActiveJob,
    seedCandidates,
    microBenchCandidate,
    saveRoutingOverrides,
    triggerSmokeGate,
  } = useBenchWorkspace();

  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [selectedModel, setSelectedModel] = useState('z-ai/glm-5.3-flash');
  const [dryRun, setDryRun] = useState(true);
  const [approved, setApproved] = useState(false);
  const [maxCost, setMaxCost] = useState('0.25');
  const [smokeGateMsg, setSmokeGateMsg] = useState(null);
  const [stageOverrides, setStageOverrides] = useState({});
  const [overrideInput, setOverrideInput] = useState('{}');
  const [overrideError, setOverrideError] = useState('');
  const [overrideSaved, setOverrideSaved] = useState(false);

  const modelOptions = useMemo(() => {
    if (Array.isArray(models) && models.length > 0) return models;
    return FALLBACK_MODELS.map((modelId) => ({ modelId }));
  }, [models]);

  const activeModelMeta = useMemo(
    () => modelOptions.find((m) => m.modelId === selectedModel) || null,
    [modelOptions, selectedModel],
  );

  useEffect(() => {
    if (selectedDocIds.length === 0 && smokeDocIds.length > 0) {
      setSelectedDocIds(smokeDocIds);
    }
  }, [smokeDocIds, selectedDocIds.length]);

  useEffect(() => {
    const normalized = routingOverrides && typeof routingOverrides === 'object' ? routingOverrides : {};
    setStageOverrides(normalized);
    setOverrideInput(JSON.stringify(normalized, null, 2));
    setOverrideError('');
  }, [routingOverrides]);

  const toggleDoc = (docId) => {
    setSelectedDocIds((prev) => (
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    ));
  };

  const handleLaunch = async (e) => {
    e.preventDefault();
    await startRun({
      docIds: selectedDocIds,
      models: [selectedModel],
      dryRun,
      approved: dryRun ? false : approved,
      maxCost: dryRun ? 0 : Number(maxCost),
      smoke: selectedDocIds.length <= 6,
    });
  };

  const handleSmokeGate = async () => {
    const res = await triggerSmokeGate({ model: selectedModel, dryRun: true });
    setSmokeGateMsg(`gbench (${selectedModel}): ${res.passed ? 'PROLAZ' : 'PAD'} · budžet $${res.budgetUsd}`);
  };

  const handleStageOverrideChange = (stageKey, modelId) => {
    setOverrideError('');
    setOverrideSaved(false);
    setStageOverrides((prev) => {
      const next = { ...prev };
      if (!modelId) {
        delete next[stageKey];
      } else {
        next[stageKey] = modelId;
      }
      setOverrideInput(JSON.stringify(next, null, 2));
      return next;
    });
  };

  const handleOverrideJsonChange = (raw) => {
    setOverrideInput(raw);
    setOverrideSaved(false);
    try {
      const parsed = JSON.parse(raw || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setOverrideError('JSON mora biti objekt (npr. {"extraction": "model-id"}).');
        return;
      }
      setOverrideError('');
      setStageOverrides(parsed);
    } catch (err) {
      setOverrideError(`Neispravan JSON: ${err.message}`);
    }
  };

  const handleSaveOverrides = async () => {
    setOverrideError('');
    setOverrideSaved(false);
    try {
      const parsed = JSON.parse(overrideInput || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setOverrideError('JSON mora biti objekt (npr. {"extraction": "model-id"}).');
        return;
      }
      await saveRoutingOverrides(parsed);
      setOverrideSaved(true);
    } catch (err) {
      setOverrideError(`Neispravan JSON: ${err.message}`);
    }
  };

  const jobDone = Number(jobProgress?.done || 0);
  const jobTotal = Number(jobProgress?.total || 0);
  const jobPct = jobTotal > 0 ? Math.min(100, Math.round((jobDone / jobTotal) * 100)) : 0;

  return (
    <DashboardShell>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Bench</h1>
            <p className="text-sm text-ink-muted">
              Programatska evaluacija ekstrakcije, OCR-a i Stage-2 izvještaja na zamrznutom korpusu.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/dashboard/bench/gold"
              className="inline-flex h-9 items-center rounded-md border border-line-control bg-surface px-3 text-sm font-medium text-ink transition-colors hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Gold editor
            </Link>
          </div>
        </div>

        {error ? <Callout tone="danger" alert title="Greška">{error}</Callout> : null}
        {smokeGateMsg ? <Callout tone="info" title="gbench provjera">{smokeGateMsg}</Callout> : null}

        <section aria-labelledby="bench-launch-heading" className="card p-5">
          <p className="eyebrow">01 · Eksperiment</p>
          <h2 id="bench-launch-heading" className="mt-1 mb-4 text-lg font-semibold text-ink">
            Novo izvođenje (Dry-run / Live)
          </h2>

          <form onSubmit={handleLaunch} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="bench-model-select" className="block text-xs font-medium text-ink-muted">
                    Model
                  </label>
                  {activeModelMeta?.gbenchGate ? (
                    <Badge
                      tone={activeModelMeta.gbenchGate.passed ? 'success' : 'danger'}
                      className="px-2 py-0.5 text-xs"
                    >
                      gbench: {activeModelMeta.gbenchGate.passed ? 'PROLAZ' : 'PAD'}
                    </Badge>
                  ) : null}
                </div>
                <select
                  id="bench-model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full rounded-md border border-line-control bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {modelOptions.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {formatModelOptionLabel(m)}
                    </option>
                  ))}
                  {!modelOptions.some((m) => m.modelId === selectedModel) ? (
                    <option value={selectedModel}>{selectedModel}</option>
                  ) : null}
                </select>
                {(Number.isFinite(Number(activeModelMeta?.inputUsdPerM))
                  || Number.isFinite(Number(activeModelMeta?.outputUsdPerM))) ? (
                  <p className="mt-1 font-mono text-xs tabular-nums text-ink-muted">
                    Cijena: ${Number(activeModelMeta?.inputUsdPerM ?? 0).toFixed(2)} ulaz / ${Number(activeModelMeta?.outputUsdPerM ?? 0).toFixed(2)} izlaz za 1M tokena
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="bench-max-cost" className="mb-1 block text-xs font-medium text-ink-muted">
                  Maksimalni trošak (USD)
                </label>
                <Input
                  id="bench-max-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={dryRun}
                  value={maxCost}
                  onChange={(e) => setMaxCost(e.target.value)}
                  className="tabular-nums"
                />
              </div>

              <div className="flex flex-col justify-end gap-2">
                <label htmlFor="bench-dry-run" className="inline-flex items-center gap-2 text-sm text-ink">
                  <input id="bench-dry-run" type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                  Dry-run ($0 procjena)
                </label>
                {!dryRun ? (
                  <label htmlFor="bench-approved" className="inline-flex items-center gap-2 text-sm text-ink">
                    <input id="bench-approved" type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
                    Odobravam OpenRouter trošak (approved)
                  </label>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink-muted">
                  Odabrani dokumenti ({selectedDocIds.length}/{documents.length})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedDocIds(smokeDocIds)}
                  className="text-xs text-accent hover:underline"
                >
                  Odaberi smoke skup
                </button>
              </div>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border border-line p-2 sm:grid-cols-2">
                {documents.map((doc) => {
                  const checkboxId = `bench-doc-${doc.docId}`;
                  return (
                    <label key={doc.docId} htmlFor={checkboxId} className="inline-flex items-center gap-2 text-xs text-ink">
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={selectedDocIds.includes(doc.docId)}
                        onChange={() => toggleDoc(doc.docId)}
                      />
                      <span className="truncate">{doc.fileName || doc.docId} ({doc.pages}p)</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={loading || selectedDocIds.length === 0 || (!dryRun && (!approved || Number(maxCost) <= 0))}
              >
                {dryRun ? 'Pokreni Dry-run' : 'Pokreni Live Bench'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSmokeGate}
              >
                gbench smoke-gate
              </Button>
              {activeJobId ? (
                <Button
                  type="button"
                  variant="danger"
                  onClick={cancelActiveJob}
                >
                  Otkaži posao
                </Button>
              ) : null}
            </div>
          </form>

          {(activeJobId || jobLogs.length > 0 || jobStatus) ? (
            <div className="mt-4 space-y-2.5 rounded-md border border-line bg-surface-muted p-3.5" data-testid="bench-active-job">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-ink">
                  Posao {activeJobId || 'zadnji'}
                  {jobTotal > 0 ? (
                    <span className="ml-1.5 font-mono tabular-nums text-ink-muted">
                      · {jobDone}/{jobTotal}
                    </span>
                  ) : null}
                  {Number.isFinite(Number(jobProgress?.costSoFarUsd)) ? (
                    <span className="ml-2 font-mono tabular-nums text-ink-muted">
                      · trošak ${Number(jobProgress.costSoFarUsd).toFixed(4)}
                    </span>
                  ) : null}
                </span>
                {jobStatus ? <StatusBadge status={jobStatus} /> : null}
              </div>

              {(jobProgress?.currentDoc || jobProgress?.currentModel) ? (
                <p className="text-xs text-ink-muted">
                  {[jobProgress.currentDoc, jobProgress.currentModel].filter(Boolean).join(' · ')}
                </p>
              ) : null}

              {jobTotal > 0 ? (
                <div
                  className="h-2 overflow-hidden rounded-full bg-surface"
                  role="progressbar"
                  aria-label="Napredak Bench posla"
                  aria-valuenow={jobDone}
                  aria-valuemin={0}
                  aria-valuemax={jobTotal}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${jobPct}%` }}
                  />
                </div>
              ) : null}

              {jobLogs.length > 0 ? (
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-mono text-xs text-ink-muted">
                  {jobLogs.join('\n')}
                </pre>
              ) : null}
            </div>
          ) : null}
        </section>

        <BenchCandidatesPanel
          candidates={candidates}
          onSeed={seedCandidates}
          onMicroBench={microBenchCandidate}
          selectedModel={selectedModel}
        />

        <section aria-labelledby="bench-runs-heading" className="card p-5">
          <p className="eyebrow">03 · Povijest</p>
          <h2 id="bench-runs-heading" className="mt-1 mb-3 text-lg font-semibold text-ink">
            Povijest Bench izvođenja
          </h2>
          {runs.length === 0 ? (
            <p className="text-sm text-ink-muted">Nema zabilježenih Bench izvođenja.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs text-ink-muted">
                    <th className="py-2 pr-3">Run ID</th>
                    <th className="py-2 pr-3">Opseg</th>
                    <th className="py-2 pr-3">Tip</th>
                    <th className="py-2 pr-3">Trošak</th>
                    <th className="py-2 text-right">Detalji</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.runId} className="border-b border-line">
                      <td className="py-2 pr-3 font-mono text-xs text-ink">{r.runId}</td>
                      <td className="py-2 pr-3 text-xs text-ink-muted">{r.scope}</td>
                      <td className="py-2 pr-3 text-xs text-ink">{r.dryRun ? 'Dry-run' : 'Live'}</td>
                      <td className="py-2 pr-3 font-mono text-xs tabular-nums text-ink">
                        ${Number(r.actualCost || r.estimatedCost || 0).toFixed(4)}
                      </td>
                      <td className="py-2 text-right">
                        <Link to={`/dashboard/bench/runs/${encodeURIComponent(r.runId)}`} className="text-xs text-accent hover:underline">
                          Otvori
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section aria-labelledby="routing-overrides-heading" className="card p-5 space-y-4">
          <div>
            <p className="eyebrow">04 · Rutiranje modela</p>
            <h2 id="routing-overrides-heading" className="mt-1 text-lg font-semibold text-ink">
              activeTaskRoutingOverrides (Engineering)
            </h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Strukturirano preusmjeravanje modela po fazi za Bench eksperimente.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ROUTING_STAGES.map(({ key, label }) => {
              const currentVal = stageOverrides?.[key] || '';
              return (
                <div key={key}>
                  <label htmlFor={`routing-${key}`} className="mb-1 block text-xs font-medium text-ink-muted">
                    {label}
                  </label>
                  <select
                    id={`routing-${key}`}
                    value={currentVal}
                    onChange={(e) => handleStageOverrideChange(key, e.target.value)}
                    className="w-full rounded-md border border-line-control bg-surface px-2.5 py-1.5 text-xs text-ink focus:border-accent"
                  >
                    <option value="">Zadano (produkcija)</option>
                    {modelOptions.map((m) => (
                      <option key={m.modelId} value={m.modelId}>{m.modelId}</option>
                    ))}
                    {currentVal && !modelOptions.some((m) => m.modelId === currentVal) ? (
                      <option value={currentVal}>{currentVal}</option>
                    ) : null}
                  </select>
                </div>
              );
            })}
          </div>

          <details className="rounded-md border border-line bg-surface-muted/40 p-3">
            <summary className="cursor-pointer text-xs font-medium text-ink">
              Napredni JSON
            </summary>
            <div className="mt-2">
              <textarea
                aria-label="activeTaskRoutingOverrides JSON"
                rows={4}
                value={overrideInput}
                onChange={(e) => handleOverrideJsonChange(e.target.value)}
                aria-invalid={Boolean(overrideError)}
                className="w-full rounded-md border border-line-control bg-surface p-2 font-mono text-xs text-ink focus:border-accent"
              />
            </div>
          </details>

          {overrideError ? (
            <p role="alert" className="text-xs text-danger">
              {overrideError}
            </p>
          ) : null}

          {overrideSaved ? (
            <p role="status" className="text-xs text-success">
              Routing overrides su spremljeni.
            </p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleSaveOverrides}
              disabled={Boolean(overrideError)}
            >
              Spremi routing overrides
            </Button>
          </div>
        </section>
      </main>
    </DashboardShell>
  );
}
